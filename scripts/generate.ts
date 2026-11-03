/**
 * CLI: build library guides.
 *   npm run generate -- github
 *   npm run generate -- "Google Workspace" slack.com
 */
import "./env";
import { runPipeline } from "../lib/pipeline/run";
import { listClaims } from "../lib/schema";

async function main() {
  const queries = process.argv.slice(2);
  if (!queries.length) {
    console.error('usage: npm run generate -- <app name or URL> [...more]');
    process.exit(1);
  }
  for (const q of queries) {
    const t0 = Date.now();
    console.log(`\n=== ${q} ===`);
    try {
      const g = await runPipeline(q, (e) => {
        if (e.type === "stage") console.log(`[${e.stage}] ${e.status}${e.message ? `: ${e.message}` : ""}`);
        else if (e.type === "progress") console.log(`   ${e.message}`);
        else if (e.type === "error") console.error(`[error${e.stage ? ` in ${e.stage}` : ""}] ${e.message}`);
      }, { saveTarget: "fs" });
      console.log(`\nSaved guides/${g.app.slug}.json in ${Math.round((Date.now() - t0) / 1000)}s`);
      console.log(`tier=${g.verdict.tier} status=${g.status}`, g.verification_summary);
      for (const c of listClaims(g)) {
        const v = c.evidence.verification;
        console.log(
          `  ${c.evidence.evidence_status.padEnd(18)} ${(v?.verdict ?? "").padEnd(20)} ${c.label.slice(0, 90)}`,
        );
      }
    } catch (e) {
      console.error(`FAILED ${q}:`, e);
      process.exitCode = 1;
    }
  }
}

main();
