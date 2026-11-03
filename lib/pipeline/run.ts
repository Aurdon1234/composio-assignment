import type { Guide } from "../schema";
import { assembleGuide } from "./evidence";
import { extract } from "./extract";
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

/** Orchestrates all stages. Shared by the CLI (library builds) and /api/generate (live). */
export async function runPipeline(query: string, emit: (e: PipelineEvent) => void = () => {}): Promise<Guide> {
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
    const draft = await stage("extract", (p) => extract({ appName: resolved.name, notes: res.notes, retrieved: res.retrieved, probes, onProgress: p }), (d) =>
      `${d.steps.length} steps, ${d.blockers.length} blockers, tier ${d.verdict.tier ?? "n/a"}`,
    );
    const guide = assembleGuide({ draft, resolved, retrieved: res.retrieved, probes });
    await stage("probe", (p) => linkCheck(guide, p), (g) => `link check done, ${g.probes.length} probes total`);
    await stage("verify", (p) => verify(guide, p));
    const out = await stage("render", () => render(guide), (r) => r.path);
    emit({ type: "done", slug: out.guide.app.slug, path: out.path });
    return out.guide;
  } catch (e) {
    emit({ type: "error", stage: current, message: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
