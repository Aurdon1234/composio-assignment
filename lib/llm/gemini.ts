import { GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import { htmlToText, safeFetch } from "../pipeline/safeFetch";
import type { AgentResult, LlmProvider, RetrievedUrl, StructuredOpts, WebAgentOpts } from "./types";
import { extractJsonBlock, normUrl, safeJson, sleep } from "./util";

/**
 * Gemini adapter (free tier friendly). Gemini's Google Search grounding returns
 * citations but not page text, so a "web agent" run is three phases:
 *   1. search-grounded call -> which pages are worth reading
 *   2. our own SSRF-guarded fetcher downloads those pages
 *   3. model writes the answer from the real page text (search still enabled)
 * The retrieved-URL set is exactly what we searched up or fetched ourselves.
 */
export function geminiProvider(): LlmProvider {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const PAGE_CHARS = Number(process.env.GEMINI_PAGE_CHARS || 15000);

  async function generate(contents: string, config: GenerateContentConfig): Promise<GenerateContentResponse> {
    let delay = 8000;
    for (let attempt = 1; ; attempt++) {
      try {
        return await ai.models.generateContent({ model, contents, config });
      } catch (e) {
        const status = (e as { status?: number }).status;
        const msg = e instanceof Error ? e.message : String(e);
        const retryable = status === 429 || status === 500 || status === 503 || /RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i.test(msg);
        if (!retryable || attempt >= 6) throw e;
        const hinted = msg.match(/retry(?:Delay)?["\s:]+(\d+(?:\.\d+)?)s/i);
        const wait = hinted ? Math.ceil(Number(hinted[1]) * 1000) + 1000 : delay;
        console.warn(`[gemini] ${status ?? ""} rate-limited/unavailable, retrying in ${Math.round(wait / 1000)}s (attempt ${attempt})`);
        await sleep(wait);
        delay = Math.min(delay * 2, 60000);
      }
    }
  }

  /** Resolve grounding redirect links (vertexaisearch.cloud.google.com/...) to real URLs. */
  async function groundedSources(res: GenerateContentResponse, retrieved: Map<string, RetrievedUrl>, onProgress?: (m: string) => void) {
    const gm = res.candidates?.[0]?.groundingMetadata;
    for (const q of gm?.webSearchQueries ?? []) onProgress?.(`search: ${q}`);
    const chunks = gm?.groundingChunks ?? [];
    const now = new Date().toISOString();
    const out: string[] = [];
    await Promise.all(
      chunks.map(async (c) => {
        const uri = c.web?.uri;
        if (!uri) return;
        let real = uri;
        if (uri.includes("grounding-api-redirect")) {
          const r = await safeFetch(uri, { method: "HEAD", timeoutMs: 8000 });
          real = r.redirects.length ? r.redirects[r.redirects.length - 1] : r.finalUrl;
          if (real.includes("grounding-api-redirect")) return;
        }
        out.push(real);
        if (!retrieved.has(normUrl(real))) {
          retrieved.set(normUrl(real), { url: real, title: c.web?.title || real, retrieval: "search_result", retrieved_at: now });
        }
      }),
    );
    return out;
  }

  async function runWebAgent(opts: WebAgentOpts): Promise<AgentResult> {
    const retrieved = new Map<string, RetrievedUrl>();
    const fetchedText = new Map<string, string>();
    const maxFetch = opts.maxFetches ?? 8;

    // Phase 1: search for the right pages.
    const p1 = await generate(
      `${opts.user}\n\nTask context:\n${opts.system}\n\n---\nRight now, do NOT do the task. Use Google Search to find the ${maxFetch} most useful pages for it (official provider documentation first, then community pages only if needed for things like review wait times). Reply with one fenced JSON block: {"urls": ["https://..."]}. List only URLs you found in search results.`,
      { tools: [{ googleSearch: {} }] },
    );
    const grounded = await groundedSources(p1, retrieved, opts.onProgress);
    const proposed = z.object({ urls: z.array(z.string()) }).safeParse(extractJsonBlock(p1.text ?? ""));
    const startUrls = [...(opts.user.match(/https:\/\/[^\s)"'\]]+/g) ?? [])];
    const candidates = uniqByNorm([...startUrls, ...(proposed.success ? proposed.data.urls : []), ...grounded]).slice(0, maxFetch + 4);

    // Phase 2: fetch pages ourselves.
    const pages: { url: string; title: string; text: string }[] = [];
    await Promise.all(
      candidates.map(async (u) => {
        if (pages.length >= maxFetch) return;
        opts.onProgress?.(`fetch: ${u}`);
        const r = await safeFetch(u, { timeoutMs: 12000, accept: "text/html,text/plain,*/*" });
        if (!r.ok) return;
        const text = r.contentType?.includes("html") ? htmlToText(r.body) : r.body;
        if (text.length < 400 || pages.length >= maxFetch) return;
        const title = r.body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || r.finalUrl;
        pages.push({ url: r.finalUrl, title, text });
        const now = new Date().toISOString();
        // Record both the requested URL and where it landed, so either citation form validates.
        for (const key of [u, r.finalUrl]) retrieved.set(normUrl(key), { url: r.finalUrl, title, retrieval: "fetched", retrieved_at: now });
        fetchedText.set(normUrl(r.finalUrl), text);
      }),
    );

    // Phase 3: do the task from the real page text.
    const corpus = pages
      .map((p, i) => `<page index="${i + 1}" url="${p.url}" title="${p.title.replace(/"/g, "'")}">\n${p.text.slice(0, PAGE_CHARS)}\n</page>`)
      .join("\n\n");
    const p3 = await generate(
      `${opts.user}\n\n# Pages we fetched for you (cite these URLs exactly as given)\n${corpus || "(no pages could be fetched)"}`,
      { systemInstruction: opts.system, tools: [{ googleSearch: {} }] },
    );
    await groundedSources(p3, retrieved, opts.onProgress);
    return { text: p3.text ?? "", retrieved, fetchedText };
  }

  return {
    name: "gemini",
    model,
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

    // Gemini's URL context tool does not return raw page text, so no fallback reader.
    fetchPageText: async () => null,
  };
}

function uniqByNorm(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (!/^https:\/\//.test(u)) continue;
    const k = normUrl(u);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}
