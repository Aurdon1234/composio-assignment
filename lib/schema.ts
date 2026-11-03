import { z } from "zod";

/**
 * Guide schema. Every factual claim carries an `evidence` object so a reader can
 * tell what was tested, what the docs say, and what is our inference.
 *
 * Evidence rules (enforced in code by lib/pipeline/evidence.ts, not just prompts):
 *  - verified_by_test  -> must reference at least one recorded probe id
 *  - sourced_from_docs -> must cite at least one URL the pipeline actually retrieved
 *  - wait-time claims  -> sourced_from_docs only if an official source is cited
 *  - a verifier pass can downgrade claims to inferred/unknown, never upgrade them
 */

export const SCHEMA_VERSION = "1.0.0";

export const EvidenceStatus = z.enum([
  "verified_by_test",
  "sourced_from_docs",
  "inferred",
  "unknown",
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;

export const VerificationVerdict = z.enum([
  "supported", // cited source states the claim
  "partially_supported", // source supports part of the claim
  "unsupported", // source does not state the claim -> downgraded
  "source_unreachable", // verifier could not read the source
  "not_checked", // e.g. inferred claims, probe-backed claims
]);

export const Evidence = z.object({
  evidence_status: EvidenceStatus,
  source_urls: z.array(z.string()),
  probe_ids: z.array(z.string()).default([]),
  note: z.string(),
  verification: z
    .object({
      verdict: VerificationVerdict,
      note: z.string(),
      original_status: EvidenceStatus.optional(), // set when the verifier downgraded
    })
    .optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const DifficultyTier = z.enum([
  "instant_self_serve", // create app, get credentials, use any scope immediately
  "self_serve_with_review", // self-serve for dev/testing; review needed for production/public or sensitive scopes
  "gated_partner", // must apply to a partner program before meaningful access
  "paid_or_business_verified", // requires paid plan and/or verified legal business
]);
export type DifficultyTier = z.infer<typeof DifficultyTier>;

export const BlockerType = z.enum([
  "business_verification",
  "security_assessment",
  "privacy_policy",
  "demo_video",
  "paid_tier",
  "partner_application",
  "other",
]);

export const StepOwner = z.enum(["agent", "developer", "provider"]);

export const SourceType = z.enum([
  "official_docs",
  "official_blog",
  "official_forum", // provider-run community / support forum
  "community", // third-party blogs, Stack Overflow, Reddit
  "other",
]);
export type SourceType = z.infer<typeof SourceType>;

export const Range = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
});

export const Probe = z.object({
  id: z.string(),
  kind: z.enum([
    "openid_configuration",
    "oauth_authorization_server_metadata",
    "authorize_endpoint_reachability",
    "token_endpoint_reachability",
    "dynamic_client_registration",
    "pkce_support",
    "doc_page_exists",
  ]),
  target_url: z.string().nullable(),
  method: z.enum(["GET", "HEAD", "POST", "none"]),
  outcome: z.enum(["positive", "negative", "inconclusive", "error", "skipped"]),
  http_status: z.number().nullable(),
  summary: z.string(),
  details: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.string(),
});
export type Probe = z.infer<typeof Probe>;

export const Source = z.object({
  url: z.string(),
  title: z.string(),
  source_type: SourceType,
  retrieved_at: z.string(),
  retrieval: z.enum(["fetched", "search_result", "probe"]),
});
export type Source = z.infer<typeof Source>;

export const Guide = z.object({
  schema_version: z.string(),
  pipeline_version: z.string(),
  generated_at: z.string(),
  model: z.string(),
  query: z.string(),
  status: z.enum(["complete", "partial", "no_oauth_found"]),

  app: z.object({
    name: z.string(),
    slug: z.string(),
    website: z.string().nullable(),
    developer_portal_url: z.string().nullable(),
    oauth_docs_url: z.string().nullable(),
  }),

  verdict: z.object({
    tier: DifficultyTier.nullable(),
    summary: z.string(),
    evidence: Evidence,
  }),

  time: z.object({
    effort_minutes: Range.extend({ evidence: Evidence }),
    wait_days: Range.extend({
      published_by_provider: z.boolean(),
      community_reported: z.boolean(),
      applies_to: z.string(), // e.g. "only if you request restricted scopes"
      evidence: Evidence,
    }),
    confidence: z.enum(["low", "medium", "high"]),
  }),

  blockers: z.array(
    z.object({
      type: BlockerType,
      description: z.string(),
      applies_when: z.string(),
      evidence: Evidence,
    }),
  ),

  prerequisites: z.array(z.object({ item: z.string(), evidence: Evidence })),

  steps: z.array(
    z.object({
      order: z.number(),
      title: z.string(),
      detail: z.string(),
      owner: StepOwner,
      agent_can_automate: z.boolean(),
      notes: z.string(),
      evidence: Evidence,
    }),
  ),

  review_triggering_scopes: z.array(
    z.object({ scope: z.string(), why: z.string(), evidence: Evidence }),
  ),

  pitfalls: z.array(z.object({ description: z.string(), evidence: Evidence })),

  escalation_path: z.array(
    z.object({
      channel: z.string(),
      url: z.string().nullable(),
      when_to_use: z.string(),
      evidence: Evidence,
    }),
  ),

  sources: z.array(Source),
  probes: z.array(Probe),
  limitations: z.array(z.string()),

  verification_summary: z.object({
    claims_total: z.number(),
    by_status: z.record(EvidenceStatus, z.number()),
    downgraded: z.number(),
    unreachable_sources: z.number(),
  }),
});
export type Guide = z.infer<typeof Guide>;

/** Every place in a guide where an Evidence object lives, with a human label. */
export function listClaims(g: Guide): { label: string; evidence: Evidence }[] {
  const out: { label: string; evidence: Evidence }[] = [];
  out.push({ label: `verdict: ${g.verdict.tier}`, evidence: g.verdict.evidence });
  out.push({
    label: `effort ${g.time.effort_minutes.min}-${g.time.effort_minutes.max} min`,
    evidence: g.time.effort_minutes.evidence,
  });
  out.push({
    label: `wait ${g.time.wait_days.min ?? "?"}-${g.time.wait_days.max ?? "?"} days`,
    evidence: g.time.wait_days.evidence,
  });
  g.blockers.forEach((b) => out.push({ label: `blocker: ${b.type} - ${b.description}`, evidence: b.evidence }));
  g.prerequisites.forEach((p) => out.push({ label: `prereq: ${p.item}`, evidence: p.evidence }));
  g.steps.forEach((s) => out.push({ label: `step ${s.order}: ${s.title}`, evidence: s.evidence }));
  g.review_triggering_scopes.forEach((s) => out.push({ label: `scope: ${s.scope}`, evidence: s.evidence }));
  g.pitfalls.forEach((p) => out.push({ label: `pitfall: ${p.description}`, evidence: p.evidence }));
  g.escalation_path.forEach((e) => out.push({ label: `escalation: ${e.channel}`, evidence: e.evidence }));
  return out;
}

export const TIER_LABELS: Record<DifficultyTier, string> = {
  instant_self_serve: "Instant self-serve",
  self_serve_with_review: "Self-serve + review",
  gated_partner: "Gated partner program",
  paid_or_business_verified: "Paid / business-verified",
};
