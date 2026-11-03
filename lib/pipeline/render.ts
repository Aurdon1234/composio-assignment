import { Guide } from "../schema";
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
  g.verification_summary = summarize(g);
  const guide = Guide.parse(g); // throws if anything drifted from the schema
  const file = await saveGuide(guide, { target });
  return { guide, path: `/guides/${guide.app.slug}`, file };
}
