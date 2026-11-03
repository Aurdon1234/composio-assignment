import { z } from "zod";
import { llm, normUrl, type ProgressFn } from "../llm";
import { VERIFY_SYSTEM, verifyUserPrompt } from "../prompts/verify";
import type { Evidence, Guide } from "../schema";
import { htmlToText, safeFetch } from "./safeFetch";

const MAX_PAGE_CHARS = 40_000;
const BATCH_CHARS = 150_000; // several sources per verifier call to save requests

const VerifyOut = z.object({
  results: z.array(
    z.object({
      claim_id: z.string(),
      source: z.number(),
      verdict: z.enum(["supported", "partially_supported", "unsupported", "source_unreachable"]),
      note: z.string(),
    }),
  ),
});
type Verdict = z.infer<typeof VerifyOut>["results"][number];

type Claim = { id: string; statement: string; evidence: Evidence };

/** Plain-language statement of each claim. The verifier sees only this + the source text. */
function claimsOf(g: Guide): Claim[] {
  const out: Claim[] = [];
  let i = 0;
  const add = (statement: string, evidence: Evidence) => out.push({ id: `c${++i}`, statement, evidence });
  add(`${g.app.name} OAuth app setup: ${g.verdict.summary}`, g.verdict.evidence);
  const w = g.time.wait_days;
  add(
    `Waiting time for provider review/approval for ${g.app.name}: ${w.min ?? "?"} to ${w.max ?? "?"} days (${w.applies_to}).`,
    w.evidence,
  );
  g.blockers.forEach((b) => add(`${b.description} (applies when: ${b.applies_when})`, b.evidence));
  g.prerequisites.forEach((p) => add(`Prerequisite: ${p.item}`, p.evidence));
  g.steps.forEach((s) => add(`${s.title}: ${s.detail}`, s.evidence));
  g.review_triggering_scopes.forEach((s) =>
    add(`The scope "${s.scope}" triggers review or restricted access: ${s.why}`, s.evidence),
  );
  g.pitfalls.forEach((p) => add(p.description, p.evidence));
  g.escalation_path.forEach((e) => add(`${e.channel}${e.url ? ` (${e.url})` : ""}: ${e.when_to_use}`, e.evidence));
  return out;
}

async function pageText(url: string, onProgress?: ProgressFn): Promise<string> {
  const r = await safeFetch(url, { timeoutMs: 15_000, accept: "text/html,application/xhtml+xml,text/plain,*/*" });
  let text = r.ok ? (r.contentType?.includes("html") ? htmlToText(r.body) : r.body) : "";
  // JS-rendered or bot-blocked pages: fall back to the provider's page reader if it has one.
  if (text.length < 800) {
    onProgress?.(`verify: direct fetch thin (${text.length} chars) for ${url}`);
    try {
      const t = await llm().fetchPageText(url);
      if (t && t.length > text.length) text = t;
    } catch {}
  }
  return text.slice(0, MAX_PAGE_CHARS);
}

/**
 * Stage 4: independent verification. Re-fetch every cited page and check each
 * claim against it. The verifier never sees the research notes or reasoning.
 * Unsupported claims are downgraded to "inferred"; nothing is ever upgraded.
 */
export async function verify(g: Guide, onProgress?: ProgressFn): Promise<Guide> {
  const claims = claimsOf(g);
  const byUrl = new Map<string, { url: string; claims: Claim[] }>();
  for (const c of claims) {
    if (c.evidence.evidence_status !== "sourced_from_docs") {
      c.evidence.verification = {
        verdict: "not_checked",
        note:
          c.evidence.evidence_status === "verified_by_test"
            ? "Backed by a probe result."
            : "No source cited for this claim, so there is nothing to check.",
      };
      continue;
    }
    for (const u of c.evidence.source_urls) {
      const k = normUrl(u);
      if (!byUrl.has(k)) byUrl.set(k, { url: u, claims: [] });
      byUrl.get(k)!.claims.push(c);
    }
  }

  const sourced = claims.filter((c) => c.evidence.evidence_status === "sourced_from_docs");
  onProgress?.(`verify: ${byUrl.size} source page(s), ${sourced.length} sourced claim(s)`);

  // Fetch pages (cheap, no LLM), then pack into batches.
  const jobs = await Promise.all(
    [...byUrl.values()].map(async (j, idx) => ({ ...j, n: idx + 1, text: await pageText(j.url, onProgress) })),
  );
  const verdicts = new Map<string, Verdict[]>();
  const record = (v: Verdict) => {
    if (!verdicts.has(v.claim_id)) verdicts.set(v.claim_id, []);
    verdicts.get(v.claim_id)!.push(v);
  };
  for (const j of jobs.filter((j) => !j.text)) {
    for (const c of j.claims) record({ claim_id: c.id, source: j.n, verdict: "source_unreachable", note: "Page could not be retrieved." });
  }
  const batches: (typeof jobs)[] = [];
  let cur: typeof jobs = [];
  let size = 0;
  for (const j of jobs.filter((j) => j.text)) {
    if (cur.length && size + j.text.length > BATCH_CHARS) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(j);
    size += j.text.length;
  }
  if (cur.length) batches.push(cur);

  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        const out = await llm().structured({
          system: VERIFY_SYSTEM,
          user: verifyUserPrompt(batch.map((j) => ({ n: j.n, url: j.url, text: j.text, claims: j.claims.map(({ id, statement }) => ({ id, statement })) }))),
          schema: VerifyOut,
          effort: "low",
        });
        out.results.forEach(record);
      } catch (e) {
        for (const j of batch) for (const c of j.claims) record({ claim_id: c.id, source: j.n, verdict: "source_unreachable", note: `Verifier error: ${String(e).slice(0, 200)}` });
      }
      onProgress?.(`verify: checked batch of ${batch.length} source(s)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(llm().verifyConcurrency, batches.length || 1) }, worker));

  for (const c of sourced) {
    const vs = verdicts.get(c.id) ?? [];
    const pick = (v: Verdict["verdict"]) => vs.find((x) => x.verdict === v);
    const best = pick("supported") ?? pick("partially_supported") ?? pick("source_unreachable") ?? pick("unsupported");
    if (!best) {
      c.evidence.verification = { verdict: "source_unreachable", note: "Verifier returned no result for this claim." };
    } else if (best.verdict === "unsupported") {
      c.evidence.verification = { verdict: "unsupported", note: best.note, original_status: "sourced_from_docs" };
      c.evidence.evidence_status = "inferred";
    } else {
      c.evidence.verification = { verdict: best.verdict, note: best.note };
    }
  }
  return g;
}
