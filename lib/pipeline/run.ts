import type { Guide } from "../schema";
import { assembleGuide } from "./evidence";
import { extract, type DraftGuide } from "./extract";
import { linkCheck } from "./linkcheck";
import { loadDebug, saveDebug } from "../storage";
import type { RetrievedUrl } from "../llm";
import type { ResearchResult } from "./research";
import { probe } from "./probe";
import { render } from "./render";
import { research } from "./research";
import { resolve } from "./resolve";
import { verify } from "./verify";

export type Stage = "resolve" | "research" | "probe" | "extract" | "verify" | "render";
export type PipelineEvent =
  | { type: "stage"; stage: Stage; status: "start" | "done"; message?: string }
  | { type: "progress"; stage: Stage; message: string }
  | { type: "done"; slug: string; path: string }
  | { type: "error"; stage: Stage | null; message: string };

function noOauthDraft(name: string): DraftGuide {
  const unknown = (note: string) => ({ evidence_status: "unknown" as const, source_urls: [], probe_ids: [], note });
  return {
    status: "no_oauth_found",
    app: { name, website: null, developer_portal_url: null, oauth_docs_url: null },
    verdict: {
      tier: null,
      summary: `We could not find public OAuth documentation for ${name}. It may not offer OAuth to third-party developers, may only offer API keys, or may document OAuth behind a partner login.`,
      evidence: unknown("Search and page fetches returned no readable provider documentation about OAuth."),
    },
    time: {
      effort_minutes_min: null,
      effort_minutes_max: null,
      effort_evidence: unknown("Cannot estimate without documentation."),
      wait_days_min: null,
      wait_days_max: null,
      wait_published_by_provider: false,
      wait_community_reported: false,
      wait_applies_to: "unknown",
      wait_evidence: unknown("No documentation found."),
      confidence: "low",
    },
    blockers: [],
    prerequisites: [],
    steps: [],
    review_triggering_scopes: [],
    technical: [],
    pitfalls: [],
    escalation_path: [
      {
        channel: "Contact the provider directly",
        url: null,
        when_to_use: "Ask whether they offer OAuth for third-party apps, or a partner/integration program.",
        evidence: unknown("Generic advice; no provider-specific channel was found."),
      },
    ],
    sources: [],
  };
}

/** Orchestrates all stages. Shared by the CLI (library builds) and /api/generate (live). */
export async function runPipeline(
  query: string,
  emit: (e: PipelineEvent) => void = () => {},
  opts: { saveTarget?: "auto" | "fs" } = {},
): Promise<Guide> {
  let current: Stage | null = null;
  const stage = async <T>(s: Stage, fn: (p: (m: string) => void) => Promise<T>, doneMsg?: (r: T) => string) => {
    current = s;
    emit({ type: "stage", stage: s, status: "start" });
    const r = await fn((message) => emit({ type: "progress", stage: s, message }));
    emit({ type: "stage", stage: s, status: "done", message: doneMsg?.(r) });
    return r;
  };

  try {
    const resolved = await stage("resolve", (p) => resolve(query, p), (r) =>
      r.found ? `${r.name}: ${r.developer_portal_url ?? "portal not found"}` : `No OAuth docs found for "${query}" (continuing research to confirm)`,
    );
    // REUSE_RESEARCH=1 (CLI only) replays cached research to iterate on later stages without spending quota.
    const cached = process.env.REUSE_RESEARCH === "1" ? await loadDebug(resolved.slug, "research.json") : null;
    const res = await stage(
      "research",
      async (p): Promise<ResearchResult> => {
        if (cached) {
          p("reusing cached research from .cache/");
          const c = JSON.parse(cached) as Omit<ResearchResult, "retrieved"> & { retrieved: [string, RetrievedUrl][] };
          return { ...c, retrieved: new Map(c.retrieved) };
        }
        return research(resolved, p);
      },
      (r) => `${r.retrieved.size} URLs retrieved`,
    );
    await saveDebug(resolved.slug, "research-notes.md", res.notes);
    await saveDebug(resolved.slug, "research.json", JSON.stringify({ ...res, retrieved: [...res.retrieved] }));
    // Merge resolver URLs so they count as retrieved sources.
    for (const [k, v] of resolved.retrieved) if (!res.retrieved.has(k)) res.retrieved.set(k, v);

    const probes = await stage("probe", (p) => probe(resolved, res.endpoints, p), (r) =>
      `${r.length} probes, ${r.filter((x) => x.outcome === "positive").length} positive`,
    );
    // Nothing readable found at all: say so plainly instead of asking a model to guess a setup flow.
    const fetchedAny = [...res.retrieved.values()].some((r) => r.retrieval === "fetched");
    const draft = fetchedAny
      ? await stage("extract", (p) => extract({ appName: resolved.name, notes: res.notes, retrieved: res.retrieved, probes, onProgress: p }), (d) =>
          `${d.steps.length} steps, ${d.blockers.length} blockers, tier ${d.verdict.tier ?? "n/a"}`,
        )
      : await stage("extract", async () => noOauthDraft(resolved.name), () => "no documentation could be read; marking as no OAuth found");
    const guide = assembleGuide({ draft, resolved, retrieved: res.retrieved, probes });
    await stage("probe", (p) => linkCheck(guide, p), (g) => `link check done, ${g.probes.length} probes total`);
    await stage("verify", (p) => verify(guide, p));
    const out = await stage("render", () => render(guide, opts.saveTarget), (r) => r.path);
    emit({ type: "done", slug: out.guide.app.slug, path: out.path });
    return out.guide;
  } catch (e) {
    emit({ type: "error", stage: current, message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
