import { z } from "zod";
import { extractJsonBlock, runWebAgent, type ProgressFn, type RetrievedUrl } from "../anthropic";
import { RESEARCH_SYSTEM, researchUserPrompt } from "../prompts/research";
import type { Resolved } from "./resolve";

export const Endpoints = z.object({
  authorization_url: z.string().nullable().catch(null),
  token_url: z.string().nullable().catch(null),
  issuer_or_discovery_base: z.string().nullable().catch(null),
  review_doc_urls: z.array(z.string()).catch([]),
});
export type Endpoints = z.infer<typeof Endpoints>;

export type ResearchResult = {
  notes: string;
  endpoints: Endpoints;
  retrieved: Map<string, RetrievedUrl>;
};

/** Stage 2: agentic web research -> cited markdown notes + endpoint candidates. */
export async function research(resolved: Resolved, onProgress?: ProgressFn): Promise<ResearchResult> {
  const res = await runWebAgent({
    system: RESEARCH_SYSTEM,
    user: researchUserPrompt(resolved),
    maxSearches: 10,
    maxFetches: 12,
    effort: "medium",
    onProgress,
  });
  const ep = Endpoints.safeParse(extractJsonBlock(res.text));
  return {
    notes: res.text,
    endpoints: ep.success
      ? ep.data
      : { authorization_url: null, token_url: null, issuer_or_discovery_base: null, review_doc_urls: [] },
    retrieved: res.retrieved,
  };
}
