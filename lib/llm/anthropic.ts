import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { AgentResult, LlmProvider, ProgressFn, RetrievedUrl, StructuredOpts, WebAgentOpts } from "./types";
import { normUrl, safeJson } from "./util";

/**
 * Anthropic adapter: server-side web_search / web_fetch tools in an agentic loop.
 * Requires ANTHROPIC_API_KEY (paid).
 */
export function anthropicProvider(): LlmProvider {
  const model = process.env.GUIDE_MODEL || "claude-sonnet-5-5";
  // Server-side refusal fallback; disable with GUIDE_FALLBACKS=off.
  const fallback =
    process.env.GUIDE_FALLBACKS !== "off" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
  const client = new Anthropic({ maxRetries: 3 });

  async function runAgent(opts: WebAgentOpts & { allowSearch?: boolean }): Promise<AgentResult> {
    const tools: Anthropic.Beta.BetaToolUnion[] = [];
    if (opts.allowSearch !== false) {
      tools.push({ type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 8 });
    }
    tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: opts.maxFetches ?? 10, max_content_tokens: 20000 });

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.user }];
    const retrieved = new Map<string, RetrievedUrl>();
    const fetchedText = new Map<string, string>();
    let text = "";

    for (let turn = 0; turn < 8; turn++) {
      const msg = await client.beta.messages
        .stream({
          model,
          max_tokens: 32000,
          system: opts.system,
          tools,
          messages,
          output_config: { effort: opts.effort ?? "medium" },
          ...fallback,
        })
        .finalMessage();
      collect(msg.content, retrieved, fetchedText, opts.onProgress);
      for (const b of msg.content) if (b.type === "text") text += b.text;
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      if (msg.stop_reason === "refusal") throw new Error("Model declined the request");
      break;
    }
    return { text, retrieved, fetchedText };
  }

  return {
    name: "anthropic",
    model,
    verifyConcurrency: 4,
    runWebAgent: (opts) => runAgent(opts),

    async structured<S extends z.ZodType>(opts: StructuredOpts<S>): Promise<z.infer<S>> {
      for (let attempt = 0; attempt < 2; attempt++) {
        const msg = await client.beta.messages
          .stream({
            model,
            max_tokens: 64000,
            system: opts.system,
            messages: [{ role: "user", content: opts.user }],
            output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
            ...fallback,
          })
          .finalMessage();
        if (msg.stop_reason === "refusal") throw new Error("Model declined the structured extraction");
        if (msg.stop_reason === "max_tokens") throw new Error("Structured output truncated (max_tokens)");
        const raw = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const res = opts.schema.safeParse(safeJson(raw));
        if (res.success) return res.data;
      }
      throw new Error("Structured output failed schema validation twice");
    },

    async fetchPageText(url: string) {
      const res = await runAgent({
        system: "Fetch the given URL with web_fetch once. Reply only with 'done'.",
        user: url,
        allowSearch: false,
        maxFetches: 1,
        effort: "low",
      });
      return res.fetchedText.get(normUrl(url)) ?? [...res.fetchedText.values()][0] ?? null;
    },
  };
}

function collect(
  content: Anthropic.Beta.BetaContentBlock[],
  retrieved: Map<string, RetrievedUrl>,
  fetchedText: Map<string, string>,
  onProgress?: ProgressFn,
) {
  const now = new Date().toISOString();
  for (const b of content) {
    if (b.type === "server_tool_use") {
      const input = b.input as Record<string, unknown>;
      if (b.name === "web_search" && typeof input.query === "string") onProgress?.(`search: ${input.query}`);
      if (b.name === "web_fetch" && typeof input.url === "string") onProgress?.(`fetch: ${input.url}`);
    }
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (r.type === "web_search_result" && !retrieved.has(normUrl(r.url))) {
          retrieved.set(normUrl(r.url), { url: r.url, title: r.title, retrieval: "search_result", retrieved_at: now });
        }
      }
    }
    if (b.type === "web_fetch_tool_result" && b.content.type === "web_fetch_result") {
      const r = b.content;
      retrieved.set(normUrl(r.url), { url: r.url, title: r.content.title ?? r.url, retrieval: "fetched", retrieved_at: r.retrieved_at ?? now });
      const src = r.content.source as { type: string; data?: string };
      if (src.type === "text" && typeof src.data === "string") fetchedText.set(normUrl(r.url), src.data);
    }
  }
}
