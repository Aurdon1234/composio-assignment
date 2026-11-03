import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import { z } from "zod";
import { readPage, search } from "./browse";
import type { AgentResult, LlmProvider, RetrievedUrl, StructuredOpts, WebAgentOpts } from "./types";
import { normUrl, safeJson, sleep } from "./util";

/**
 * Gemini adapter (free tier). Google Search grounding has no free quota, so the
 * agent browses with our own tools via function calling:
 *   web_search(query) -> Tavily (if key) or DuckDuckGo
 *   fetch_page(url)   -> our SSRF-guarded fetch; returns text + links to follow
 * The retrieved-URL set is exactly what these tools returned.
 */
export function geminiProvider(): LlmProvider {
  // Free tier quotas are per model per day (20 req/day on flash models when we tested),
  // so we rotate through models: when one is exhausted or overloaded, move to the next.
  const primary = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const models = [
    primary,
    ...(
      process.env.GEMINI_FALLBACK_MODELS ??
      "gemini-3.6-flash,gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest"
    )
      .split(",")
      .map((s) => s.trim())
      .filter((m) => m && m !== primary),
  ];
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const PAGE_CHARS = Number(process.env.GEMINI_PAGE_CHARS || 14000);
  const exhaustedUntil = new Map<string, number>(); // model -> epoch ms
  const usedModels = new Set<string>();
  let mi = 0;

  function currentModel(): string {
    for (let i = 0; i < models.length; i++) {
      const m = models[(mi + i) % models.length];
      if ((exhaustedUntil.get(m) ?? 0) < Date.now()) {
        mi = (mi + i) % models.length;
        return m;
      }
    }
    throw new Error("All Gemini free-tier models have hit their daily quota. Try again tomorrow or set another key.");
  }

  class PinnedModelUnavailable extends Error {}

  async function generate(contents: string | Content[], config: GenerateContentConfig, pinModel?: string): Promise<GenerateContentResponse & { usedModel: string }> {
    let delay = 5000;
    for (let attempt = 1; ; attempt++) {
      const m = pinModel ?? currentModel();
      try {
        const r = await ai.models.generateContent({ model: m, contents, config });
        usedModels.add(m);
        return Object.assign(r, { usedModel: m });
      } catch (e) {
        const status = (e as { status?: number }).status;
        const msg = e instanceof Error ? e.message : String(e);
        const daily = status === 429 && /PerDay/i.test(msg);
        const overloaded = status === 503 || status === 500 || /UNAVAILABLE|overloaded|high demand/i.test(msg);
        const rateLimited = status === 429 || /RESOURCE_EXHAUSTED/i.test(msg);
        if (daily || (overloaded && attempt >= 2)) {
          // Daily quota gone (or model persistently busy): stop using this model.
          exhaustedUntil.set(m, Date.now() + (daily ? 12 * 3600_000 : 5 * 60_000));
          console.warn(`[gemini] ${m} ${daily ? "daily quota exhausted" : "overloaded"}; rotating models`);
          if (pinModel) throw new PinnedModelUnavailable(m);
          continue;
        }
        if ((!overloaded && !rateLimited) || attempt >= 8) throw e;
        const hinted = msg.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i);
        const wait = hinted ? Math.min(Math.ceil(Number(hinted[1]) * 1000) + 1000, 90_000) : overloaded ? 3000 : delay;
        console.warn(`[gemini] ${status ?? ""} on ${m}; ${overloaded ? "overloaded" : "per-minute limit"}, waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        if (!overloaded) delay = Math.min(delay * 2, 60000);
      }
    }
  }

  const TOOLS: FunctionDeclaration[] = [
    {
      name: "web_search",
      description: "Search the web. Returns result URLs, titles and snippets. Snippets are not reliable evidence; fetch pages you rely on.",
      parametersJsonSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    {
      name: "fetch_page",
      description: "Fetch a public https page. Returns its text (truncated) and the links on it, so you can follow them.",
      parametersJsonSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
  ];

  async function runWebAgent(opts: WebAgentOpts): Promise<AgentResult> {
    const retrieved = new Map<string, RetrievedUrl>();
    const fetchedText = new Map<string, string>();
    let searchesLeft = opts.maxSearches ?? 6;
    let fetchesLeft = opts.maxFetches ?? 8;
    // Each turn is one request against a ~20/day quota, so keep turns low and push for parallel calls.
    const maxTurns = 3 + Math.ceil(((opts.maxSearches ?? 6) + (opts.maxFetches ?? 8)) / 3);
    const transcript: string[] = []; // plain-text tool log, used if we must switch models mid-loop

    const system = `${opts.system}

## Tools
You can call web_search(query) and fetch_page(url). Budget: ${searchesLeft} searches and ${fetchesLeft} page fetches. Call several tools in parallel in one turn when you can. fetch_page returns the page's links, so follow them to reach the right docs. Only cite URLs that you fetched or saw in search results. When you have enough, stop calling tools and write your final answer.`;

    let contents: Content[] = [{ role: "user", parts: [{ text: opts.user }] }];
    let pinned: string | undefined; // keep one model for the whole tool loop (thought signatures are model-specific)

    for (let turn = 0; turn < maxTurns; turn++) {
      const lastTurn = turn === maxTurns - 1 || (searchesLeft <= 0 && fetchesLeft <= 0);
      let res: Awaited<ReturnType<typeof generate>>;
      try {
        res = await generate(
          contents,
          {
            systemInstruction: system,
            tools: [{ functionDeclarations: TOOLS }],
            toolConfig: { functionCallingConfig: { mode: lastTurn ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO } },
          },
          pinned,
        );
      } catch (e) {
        if (!(e instanceof PinnedModelUnavailable)) throw e;
        // Switch models: replay the research so far as plain text (no model-specific thought signatures).
        opts.onProgress?.(`model ${e.message} unavailable; continuing on another model`);
        contents = [
          {
            role: "user",
            parts: [{ text: `${opts.user}\n\n# Tool results gathered so far (continue from here)\n${transcript.join("\n\n")}` }],
          },
        ];
        pinned = undefined;
        turn--;
        continue;
      }
      pinned = res.usedModel;
      const content = res.candidates?.[0]?.content;
      const calls = res.functionCalls ?? [];
      if (!content || calls.length === 0) return { text: res.text ?? "", retrieved, fetchedText };
      contents.push(content);

      const now = new Date().toISOString();
      const responses: Part[] = await Promise.all(
        calls.map(async (call): Promise<Part> => {
          const args = (call.args ?? {}) as Record<string, string>;
          let response: Record<string, unknown>;
          try {
            if (call.name === "web_search") {
              if (searchesLeft-- <= 0) response = { error: "search budget exhausted; write your answer from what you have" };
              else {
                opts.onProgress?.(`search: ${args.query}`);
                const hits = await search(String(args.query ?? ""));
                for (const h of hits) {
                  if (!retrieved.has(normUrl(h.url))) retrieved.set(normUrl(h.url), { url: h.url, title: h.title, retrieval: "search_result", retrieved_at: now });
                }
                response = { results: hits };
                transcript.push(`web_search(${JSON.stringify(args.query)}):\n${hits.map((h) => `- ${h.url} | ${h.title} | ${h.snippet}`).join("\n")}`);
              }
            } else if (call.name === "fetch_page") {
              if (fetchesLeft-- <= 0) response = { error: "fetch budget exhausted; write your answer from what you have" };
              else {
                const url = String(args.url ?? "");
                opts.onProgress?.(`fetch: ${url}`);
                const page = await readPage(url, PAGE_CHARS);
                if ("error" in page) response = { url, error: page.error };
                else {
                  for (const key of [url, page.url]) retrieved.set(normUrl(key), { url: page.url, title: page.title, retrieval: "fetched", retrieved_at: now });
                  fetchedText.set(normUrl(page.url), page.text);
                  response = { url: page.url, title: page.title, text: page.text, links: page.links };
                  transcript.push(`fetch_page(${page.url}) title="${page.title}":\n${page.text}\nLINKS:\n${page.links.slice(0, 40).join("\n")}`);
                }
              }
            } else response = { error: `unknown tool ${call.name}` };
          } catch (e) {
            response = { error: e instanceof Error ? e.message : String(e) };
          }
          return { functionResponse: { id: call.id, name: call.name, response } };
        }),
      );
      contents.push({ role: "user", parts: responses });
    }
    // Turn budget exhausted without a final answer: force one (plain text, any model).
    const final = await generate(
      `${opts.user}\n\n# Tool results gathered\n${transcript.join("\n\n")}\n\nStop researching. Write your final answer now from what you have.`,
      { systemInstruction: system },
    );
    return { text: final.text ?? "", retrieved, fetchedText };
  }

  return {
    get name() {
      return "gemini";
    },
    get model() {
      return usedModels.size ? [...usedModels].join("+") : primary;
    },
    verifyConcurrency: Number(process.env.GEMINI_CONCURRENCY || 1),
    runWebAgent,

    async structured<S extends z.ZodType>(opts: StructuredOpts<S>): Promise<z.infer<S>> {
      const schema = z.toJSONSchema(opts.schema, { target: "draft-2020-12" }) as Record<string, unknown>;
      delete schema.$schema;
      let lastErr = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await generate(opts.user + (lastErr ? `\n\nYour previous output failed validation: ${lastErr}` : ""), {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        });
        const parsed = opts.schema.safeParse(safeJson(res.text ?? ""));
        if (parsed.success) return parsed.data;
        lastErr = parsed.error.message.slice(0, 1500);
      }
      throw new Error(`Structured output failed schema validation twice: ${lastErr.slice(0, 300)}`);
    },

    // No separate page reader: verify.ts already fetched the page directly.
    fetchPageText: async () => null,
  };
}
