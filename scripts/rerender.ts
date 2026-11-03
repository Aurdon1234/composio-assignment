/**
 * Re-apply render-stage checks to existing library guides (no model calls).
 *   npx tsx scripts/rerender.ts [slug...]
 */
import "./env";
import { promises as fs } from "node:fs";
import { render } from "../lib/pipeline/render";
import { Guide } from "../lib/schema";

async function main() {
  const slugs = process.argv.slice(2).length
    ? process.argv.slice(2)
    : (await fs.readdir("guides")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  for (const s of slugs) {
    const g = Guide.parse(JSON.parse(await fs.readFile(`guides/${s}.json`, "utf8")));
    const before = g.time.wait_days.published_by_provider;
    await render(g, "fs");
    console.log(`${s}: published_by_provider ${before} -> ${g.time.wait_days.published_by_provider}`);
  }
}
main();
