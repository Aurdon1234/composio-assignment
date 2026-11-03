import { z } from "zod";
import { llm, type RetrievedUrl } from "../llm";
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
  technical: z.array(z.object({ fact: z.string(), evidence: DraftEvidence })),
  pitfalls: z.array(z.object({ description: z.string(), evidence: DraftEvidence })),
  escalation_path: z.array(
    z.object({ channel: z.string(), url: z.string().nullable(), when_to_use: z.string(), evidence: DraftEvidence }),
  ),
  sources: z.array(z.object({ url: z.string(), title: z.string(), source_type: SourceType })),
});
export type DraftGuide = z.infer<typeof DraftGuide>;

/** Heuristic: did the draft drop material the notes clearly contain? */
export function coverageGaps(draft: DraftGuide, notes: string): string[] {
  const gaps: string[] = [];
  if (draft.status === "no_oauth_found") return gaps;
  if (draft.steps.length < 5) gaps.push(`only ${draft.steps.length} steps; the path from zero to real users connecting usually needs 5-10`);
  if (draft.blockers.length === 0 && /approv|verif|marketplace|review|restrict|admin|SSO|paid|plan|partner/i.test(notes)) {
    gaps.push("no blockers, but the notes mention approvals/verification/restrictions/plans — include conditional blockers with applies_when");
  }
  if (draft.pitfalls.length < 3 && /pitfall|error|mismatch|expire|limit/i.test(notes)) gaps.push("fewer than 3 pitfalls although the notes list more");
  if (draft.technical.length < 3) gaps.push("fewer than 3 technical facts (endpoints, PKCE, redirect rules, token lifetimes)");
  if (/github app|custom app|private app|public app|app type/i.test(notes) && !draft.steps.some((s) => /choose|decide|type|vs\.?/i.test(s.title + s.detail))) {
    gaps.push("the notes describe more than one app type, but no step helps the developer choose between them");
  }
  return gaps;
}

/** Stage 3b: research notes + probe results -> structured draft guide (+ one revision pass if thin). */
export async function extract(input: {
  appName: string;
  notes: string;
  retrieved: Map<string, RetrievedUrl>;
  probes: Probe[];
  onProgress?: (m: string) => void;
}): Promise<DraftGuide> {
  const user = extractUserPrompt({
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
  });
  const draft = await llm().structured({ system: EXTRACT_SYSTEM, user, schema: DraftGuide, effort: "medium" });

  const gaps = coverageGaps(draft, input.notes);
  if (!gaps.length) return draft;
  input.onProgress?.(`draft looks thin (${gaps.length} gap(s)); running one revision pass`);
  try {
    return await llm().structured({
      system: EXTRACT_SYSTEM,
      user: `${user}

# Your previous draft
${JSON.stringify(draft)}

# Problems with the previous draft
${gaps.map((g) => `- ${g}`).join("\n")}

Rewrite the complete guide. Keep everything that was right, and add what the research notes support but the draft left out. Do not add anything the notes do not support; the evidence rules still apply.`,
      schema: DraftGuide,
      effort: "medium",
    });
  } catch {
    return draft; // revision is best-effort
  }
}
