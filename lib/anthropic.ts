import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = process.env.GUIDE_MODEL || "claude-sonnet-5-5";

// Server-side refusal fallback: on a policy decline the API re-runs the request
// on a fallback model inside the same call. Disable with GUIDE_FALLBACKS=off.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const useFallbacks = process.env.GUIDE_FALLBACKS !== "off";

let _client: Anthropic | null = null;
export function client(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 3 });
  return _client;
}

function fallbackParams() {
  return useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {};
}

export type RetrievedUrl = {
  url: string;
  title: string;
  retrieval: "fetched" | "search_result";
  retrieved_at: string;
};

export type AgentResult = {
  text: string;
  retrieved: Map<string, RetrievedUrl>;
  /** Raw text of pages fetched via web_fetch, keyed by normalized URL. */
  fetchedText: Map<string, string>;
  stopReason: string | null;
};

export type ProgressFn = (msg: string) => void;

/**
 * Agentic loop with Anthropic's server-side web_search / web_fetch tools.
 * Collects every URL the model searched up or fetched, so later stages can
 * check that cited URLs were actually retrieved (not invented).
 */
export async function runWebAgent(opts: {
  system: string;
  user: string;
  maxSearches?: number;
  maxFetches?: number;
  allowSearch?: boolean;
  effort?: "low" | "medium" | "high";
  onProgress?: ProgressFn;
}): Promise<AgentResult> {
  const tools: Anthropic.Beta.BetaToolUnion[] = [];
  if (opts.allowSearch !== false) {
    tools.push({ type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 8 });
  }
  tools.push({
    type: "web_fetch_20260209",
    name: "web_fetch",
    max_uses: opts.maxFetches ?? 10,
    max_content_tokens: 20000,
  });

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.user }];
  const retrieved = new Map<string, RetrievedUrl>();
  const fetchedText = new Map<string, string>();
  let text = "";
  let stopReason: string | null = null;

  for (let turn = 0; turn < 8; turn++) {
    const stream = client().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: opts.system,
      tools,
      messages,
      output_config: { effort: opts.effort ?? "medium" },
      ...fallbackParams(),
    });
    const msg = await stream.finalMessage();
    stopReason = msg.stop_reason;
    collectRetrieved(msg.content, retrieved, fetchedText, opts.onProgress);

    for (const b of msg.content) if (b.type === "text") text += b.text;

    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    if (msg.stop_reason === "refusal") {
      throw new Error(`Model declined the request (${msg.stop_details?.category ?? "unknown category"})`);
    }
    break;
  }
  return { text, retrieved, fetchedText, stopReason };
}

function collectRetrieved(
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
      retrieved.set(normUrl(r.url), {
        url: r.url,
        title: r.content.title ?? r.url,
        retrieval: "fetched",
        retrieved_at: r.retrieved_at ?? now,
      });
      const src = r.content.source as { type: string; data?: string };
      if (src.type === "text" && typeof src.data === "string") fetchedText.set(normUrl(r.url), src.data);
    }
  }
}

export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    let s = x.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

/** Single structured-output call (no tools). Returns parsed, schema-valid output. */
export async function structured<S extends z.ZodType>(opts: {
  system: string;
  user: string;
  schema: S;
  effort?: "low" | "medium" | "high";
}): Promise<z.infer<S>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = client().beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      ...fallbackParams(),
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Model declined the structured extraction");
    if (msg.stop_reason === "max_tokens") throw new Error("Structured output truncated (max_tokens)");
    const parsed = (msg as { parsed_output?: unknown }).parsed_output;
    if (parsed) return parsed as z.infer<S>;
    // Fallback: parse the text ourselves.
    const raw = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const res = opts.schema.safeParse(safeJson(raw));
    if (res.success) return res.data;
  }
  throw new Error("Structured output failed schema validation twice");
}

/** Pull the last ```json fenced block (or bare object) out of free text. */
export function extractJsonBlock(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fences.length) return safeJson(fences[fences.length - 1][1]);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return safeJson(text.slice(start, end + 1));
  return null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
