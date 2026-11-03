import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import type { LlmProvider } from "./types";

export * from "./types";
export { normUrl, extractJsonBlock } from "./util";

/**
 * Provider selection: LLM_PROVIDER=gemini|anthropic. Defaults to whichever key
 * is present (Gemini first, since it has a free tier).
 */
let _p: LlmProvider | null = null;
export function llm(): LlmProvider {
  if (_p) return _p;
  const choice =
    process.env.LLM_PROVIDER ||
    (process.env.GEMINI_API_KEY ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "");
  if (choice === "gemini") _p = geminiProvider();
  else if (choice === "anthropic") _p = anthropicProvider();
  else throw new Error("No LLM configured: set GEMINI_API_KEY (free tier) or ANTHROPIC_API_KEY in .env.local");
  return _p;
}
