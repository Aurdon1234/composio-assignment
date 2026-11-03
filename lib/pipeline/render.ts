import { cleanUrl } from "../llm/util";
import { Guide, listClaims } from "../schema";
import { saveGuide } from "../storage";
import { summarize } from "./evidence";

/** Stage 5: final validation, summary counts, persist. Returns the permalink path. */
export async function render(g: Guide, target: "auto" | "fs" = "auto"): Promise<{ guide: Guide; path: string; file: string }> {
  // Post-verification consistency: a timeline is only "published" while its claim is still sourced
  // from docs (the verifier may have downgraded it after assembly).
  const w = g.time.wait_days;
  if (w.published_by_provider && w.evidence.evidence_status !== "sourced_from_docs") {
    w.published_by_provider = false;
    w.evidence.note += " [auto-check: verifier could not confirm a published timeline, so it is not shown as published]";
  }
  // Normalize every URL shown to readers (drop ?hl= locale switches; evaluation found
  // Persian/Arabic/Portuguese Google docs cited after geo-redirects).
  const c = (u: string | null) => (u ? cleanUrl(u) : u);
  g.app.website = c(g.app.website);
  g.app.developer_portal_url = c(g.app.developer_portal_url);
  g.app.oauth_docs_url = c(g.app.oauth_docs_url);
  for (const { evidence } of listClaims(g)) evidence.source_urls = [...new Set(evidence.source_urls.map(cleanUrl))];
  for (const e of g.escalation_path) e.url = c(e.url);
  const seen = new Set<string>();
  g.sources = g.sources
    .map((s) => ({ ...s, url: cleanUrl(s.url) }))
    .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
  for (const p of g.probes) if (p.target_url) p.target_url = cleanUrl(p.target_url);
  g.verification_summary = summarize(g);
  const guide = Guide.parse(g); // throws if anything drifted from the schema
  const file = await saveGuide(guide, { target });
  return { guide, path: `/guides/${guide.app.slug}`, file };
}
