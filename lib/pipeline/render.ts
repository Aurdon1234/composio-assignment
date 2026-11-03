import { Guide } from "../schema";
import { saveGuide } from "../storage";
import { summarize } from "./evidence";

/** Stage 5: final validation, summary counts, persist. Returns the permalink path. */
export async function render(g: Guide): Promise<{ guide: Guide; path: string; file: string }> {
  g.verification_summary = summarize(g);
  const guide = Guide.parse(g); // throws if anything drifted from the schema
  const file = await saveGuide(guide);
  return { guide, path: `/guides/${guide.app.slug}`, file };
}
