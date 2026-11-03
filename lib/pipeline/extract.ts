import { z } from "zod";
import { structured, type RetrievedUrl } from "../anthropic";
import { EXTRACT_SYSTEM, extractUserPrompt } from "../prompts/extract";
import { BlockerType, DifficultyTier, EvidenceStatus, SourceType, StepOwner, type Probe } from "../schema";

// LLM-facing draft schema: flat, all fields required, structured-output friendly.
const DraftEvidence = z.object({
  evidence_status: EvidenceStatus,
  source_urls: z.array(z.string()),
  probe_ids: z.array(z.string()),
  note: z.string(),
});

export const DraftGuide = z.object({
  status: z.enum(["complete", "partial", "no_oauth_found"]),
  app: z.object({
    name: z.string(),
    website: z.string().nullable(),
    developer_portal_url: z.string().nullable(),
    oauth_docs_url: z.string().nullable(),
  }),
  verdict: z.object({ tier: DifficultyTier.nullable(), summary: z.string(), evidence: DraftEvidence }),
  time: z.object({
    effort_minutes_min: z.number().nullable(),
    effort_minutes_max: z.number().nullable(),
    effort_evidence: DraftEvidence,
    wait_days_min: z.number().nullable(),
    wait_days_max: z.number().nullable(),
    wait_published_by_provider: z.boolean(),
    wait_community_reported: z.boolean(),
    wait_applies_to: z.string(),
    wait_evidence: DraftEvidence,
    confidence: z.enum(["low", "medium", "high"]),
  }),
  blockers: z.array(
    z.object({ type: BlockerType, description: z.string(), applies_when: z.string(), evidence: DraftEvidence }),
  ),
  prerequisites: z.array(z.object({ item: z.string(), evidence: DraftEvidence })),
  steps: z.array(
    z.object({
      order: z.number(),
      title: z.string(),
      detail: z.string(),
      owner: StepOwner,
      agent_can_automate: z.boolean(),
      notes: z.string(),
      evidence: DraftEvidence,
    }),
  ),
  review_triggering_scopes: z.array(z.object({ scope: z.string(), why: z.string(), evidence: DraftEvidence })),
  pitfalls: z.array(z.object({ description: z.string(), evidence: DraftEvidence })),
  escalation_path: z.array(
    z.object({ channel: z.string(), url: z.string().nullable(), when_to_use: z.string(), evidence: DraftEvidence }),
  ),
  sources: z.array(z.object({ url: z.string(), title: z.string(), source_type: SourceType })),
});
export type DraftGuide = z.infer<typeof DraftGuide>;

/** Stage 3b: research notes + probe results -> structured draft guide. */
export async function extract(input: {
  appName: string;
  notes: string;
  retrieved: Map<string, RetrievedUrl>;
  probes: Probe[];
}): Promise<DraftGuide> {
  return structured({
    system: EXTRACT_SYSTEM,
    user: extractUserPrompt({
      appName: input.appName,
      notes: input.notes,
      retrieved: [...input.retrieved.values()],
      probes: input.probes.map(({ id, kind, target_url, outcome, http_status, summary, details }) => ({
        id,
        kind,
        target_url,
        outcome,
        http_status,
        summary,
        details,
      })),
    }),
    schema: DraftGuide,
    effort: "medium",
  });
}
