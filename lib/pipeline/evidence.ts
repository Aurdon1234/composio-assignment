import { normUrl, MODEL, type RetrievedUrl } from "../anthropic";
import {
  SCHEMA_VERSION,
  listClaims,
  type Evidence,
  type Guide,
  type Probe,
  type Source,
  type SourceType,
} from "../schema";
import type { DraftGuide } from "./extract";
import type { Resolved } from "./resolve";

export const PIPELINE_VERSION = "0.1.0";

const COMMUNITY_HOSTS = [
  "reddit.com",
  "stackoverflow.com",
  "stackexchange.com",
  "medium.com",
  "dev.to",
  "hashnode",
  "quora.com",
  "news.ycombinator.com",
  "youtube.com",
];

export function classifySource(url: string, modelLabel?: SourceType): SourceType {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {}
  if (COMMUNITY_HOSTS.some((h) => host.includes(h))) return "community";
  return modelLabel ?? "other";
}

const isOfficial = (t: SourceType) => t === "official_docs" || t === "official_blog" || t === "official_forum";

/**
 * Turn the model's draft into a Guide and enforce evidence rules in code:
 *  - cited URLs must be ones the pipeline actually retrieved
 *  - verified_by_test needs a real, non-skipped probe
 *  - sourced_from_docs needs >=1 surviving URL
 *  - wait-time "sourced_from_docs" needs an official source
 */
export function assembleGuide(args: {
  draft: DraftGuide;
  resolved: Resolved;
  retrieved: Map<string, RetrievedUrl>;
  probes: Probe[];
}): Guide {
  const { draft, resolved, retrieved, probes } = args;
  const probeById = new Map(probes.map((p) => [p.id, p]));
  const modelTypes = new Map(draft.sources.map((s) => [normUrl(s.url), s.source_type]));
  const typeOf = (u: string) => classifySource(u, modelTypes.get(normUrl(u)));

  const fix = (e: DraftGuide["verdict"]["evidence"], opts: { requireOfficial?: boolean } = {}): Evidence => {
    const notes: string[] = [];
    const kept = e.source_urls.filter((u) => retrieved.has(normUrl(u)));
    const dropped = e.source_urls.length - kept.length;
    if (dropped) notes.push(`${dropped} cited URL(s) removed: not retrieved by the pipeline`);
    const goodProbes = e.probe_ids.filter((id) => {
      const p = probeById.get(id);
      return p && (p.outcome === "positive" || p.outcome === "negative");
    });

    let status = e.evidence_status;
    if (status === "verified_by_test" && goodProbes.length === 0) {
      status = kept.length ? "sourced_from_docs" : "inferred";
      notes.push("no usable probe backs this, so it is not marked tested");
    }
    if (status === "sourced_from_docs" && kept.length === 0) {
      status = "inferred";
      notes.push("no retrievable source, downgraded to inferred");
    }
    if (status === "sourced_from_docs" && opts.requireOfficial && !kept.some((u) => isOfficial(typeOf(u)))) {
      status = "inferred";
      notes.push("only non-official sources, so treated as inferred");
    }
    return {
      evidence_status: status,
      source_urls: kept,
      probe_ids: goodProbes,
      note: notes.length ? `${e.note} [auto-check: ${notes.join("; ")}]` : e.note,
    };
  };

  const t = draft.time;
  const waitEvidence = fix(t.wait_evidence, { requireOfficial: true });
  const waitPublished = t.wait_published_by_provider && waitEvidence.evidence_status === "sourced_from_docs";

  const guide: Guide = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    generated_at: new Date().toISOString(),
    model: MODEL,
    query: resolved.query,
    status: draft.status,
    app: {
      name: draft.app.name || resolved.name,
      slug: resolved.slug,
      website: draft.app.website ?? resolved.website,
      developer_portal_url: draft.app.developer_portal_url ?? resolved.developer_portal_url,
      oauth_docs_url: draft.app.oauth_docs_url ?? resolved.oauth_docs_urls[0] ?? null,
    },
    verdict: { tier: draft.verdict.tier, summary: draft.verdict.summary, evidence: fix(draft.verdict.evidence) },
    time: {
      effort_minutes: { min: t.effort_minutes_min, max: t.effort_minutes_max, evidence: fix(t.effort_evidence) },
      wait_days: {
        min: t.wait_days_min,
        max: t.wait_days_max,
        published_by_provider: waitPublished,
        community_reported: t.wait_community_reported,
        applies_to: t.wait_applies_to,
        evidence: waitEvidence,
      },
      confidence: t.confidence,
    },
    blockers: draft.blockers.map((b) => ({ ...b, evidence: fix(b.evidence) })),
    prerequisites: draft.prerequisites.map((p) => ({ ...p, evidence: fix(p.evidence) })),
    steps: draft.steps.map((s) => ({ ...s, evidence: fix(s.evidence) })),
    review_triggering_scopes: draft.review_triggering_scopes.map((s) => ({ ...s, evidence: fix(s.evidence) })),
    pitfalls: draft.pitfalls.map((p) => ({ ...p, evidence: fix(p.evidence) })),
    escalation_path: draft.escalation_path.map((e) => ({ ...e, evidence: fix(e.evidence) })),
    sources: [],
    probes,
    limitations: [
      "No accounts were created, no forms submitted, no OAuth apps registered, and no credentials were used. Probes are unauthenticated GET requests against public discovery documents, endpoints and documentation pages, plus one unauthenticated POST to the token endpoint with a fake authorization code and a nonexistent client_id (to confirm it answers with an OAuth error).",
      "Review timelines are only marked as sourced when an official provider page states them. Community-reported timelines are labeled as such.",
      "Provider policies change; check the linked sources before relying on a requirement.",
    ],
    verification_summary: {
      claims_total: 0,
      by_status: { verified_by_test: 0, sourced_from_docs: 0, inferred: 0, unknown: 0 },
      downgraded: 0,
      unreachable_sources: 0,
    },
  };

  // Sources = every URL cited anywhere + every fetched URL, with type and retrieval info.
  const cited = new Set(listClaims(guide).flatMap((c) => c.evidence.source_urls.map(normUrl)));
  const sources: Source[] = [];
  for (const [key, r] of retrieved) {
    if (!cited.has(key) && r.retrieval !== "fetched") continue;
    sources.push({ url: r.url, title: r.title, source_type: typeOf(r.url), retrieved_at: r.retrieved_at, retrieval: r.retrieval });
  }
  for (const p of probes) {
    if (p.kind === "doc_page_exists" && p.target_url && !retrieved.has(normUrl(p.target_url))) {
      sources.push({ url: p.target_url, title: p.target_url, source_type: "official_docs", retrieved_at: p.timestamp, retrieval: "probe" });
    }
  }
  guide.sources = sources;
  return guide;
}

export function summarize(guide: Guide): Guide["verification_summary"] {
  const claims = listClaims(guide);
  const by: Guide["verification_summary"]["by_status"] = { verified_by_test: 0, sourced_from_docs: 0, inferred: 0, unknown: 0 };
  let downgraded = 0;
  let unreachable = 0;
  for (const c of claims) {
    by[c.evidence.evidence_status]++;
    if (c.evidence.verification?.original_status) downgraded++;
    if (c.evidence.verification?.verdict === "source_unreachable") unreachable++;
  }
  return { claims_total: claims.length, by_status: by, downgraded, unreachable_sources: unreachable };
}
