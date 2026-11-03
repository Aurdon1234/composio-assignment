import type { z } from "zod";

export type RetrievedUrl = {
  url: string;
  title: string;
  retrieval: "fetched" | "search_result";
  retrieved_at: string;
};

export type AgentResult = {
  text: string;
  /** Every URL the agent searched up or fetched, keyed by normalized URL. */
  retrieved: Map<string, RetrievedUrl>;
  /** Raw text of fetched pages, keyed by normalized URL. */
  fetchedText: Map<string, string>;
};

export type ProgressFn = (msg: string) => void;

export type Effort = "low" | "medium" | "high";

export type WebAgentOpts = {
  system: string;
  user: string;
  maxSearches?: number;
  maxFetches?: number;
  effort?: Effort;
  onProgress?: ProgressFn;
};

export type StructuredOpts<S extends z.ZodType> = {
  system: string;
  user: string;
  schema: S;
  effort?: Effort;
};

export interface LlmProvider {
  name: string;
  model: string;
  /** How many verifier calls to run in parallel (free tiers need 1). */
  verifyConcurrency: number;
  runWebAgent(opts: WebAgentOpts): Promise<AgentResult>;
  structured<S extends z.ZodType>(opts: StructuredOpts<S>): Promise<z.infer<S>>;
  /** Fallback page reader for JS-rendered docs; null if unsupported. */
  fetchPageText(url: string): Promise<string | null>;
}
