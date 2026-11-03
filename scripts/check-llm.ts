/**
 * Sanity check for the configured LLM provider.
 *   npm run check-llm
 * Lists Gemini models that support generateContent (if Gemini), then makes one tiny structured call.
 */
import "./env";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { llm } from "../lib/llm";

async function main() {
  const p = llm();
  console.log(`provider=${p.name} model=${p.model}`);
  if (p.name === "gemini") {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const names: string[] = [];
    for await (const m of await ai.models.list()) {
      if (m.supportedActions?.includes("generateContent") && /flash|pro/.test(m.name ?? "")) names.push(m.name!.replace("models/", ""));
    }
    console.log("available flash/pro models:", names.join(", "));
  }
  const out = await p.structured({
    system: "Answer with JSON.",
    user: "What is the OAuth 2.0 RFC number?",
    schema: z.object({ rfc: z.number() }),
    effort: "low",
  });
  console.log("structured call ok:", out);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
