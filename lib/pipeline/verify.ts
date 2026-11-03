import { z } from "zod";
import { llm, normUrl, type ProgressFn } from "../llm";
import { VERIFY_SYSTEM, verifyUserPrompt } from "../prompts/verify";
import type { Evidence, Guide } from "../schema";
import { htmlToText, safeFetch } from "./safeFetch";

const MAX_PAGE_CHARS = 60_000;

const VerifyOut = z.object({
  results: z.array(
    z.object({
      id: z.string(),
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

async function pageText(url: string, cache: Map<string, string>, onProgress?: ProgressFn): Promise<string> {
  const r = await safeFetch(url, { timeoutMs: 15_000, accept: "text/html,application/xhtml+xml,text/plain,*/*" });
  let text = r.ok ? (r.contentType?.includes("html") ? htmlToText(r.body) : r.body) : "";
  // JS-rendered or bot-blocked pages: fall back to the provider's page reader if it has one
  // (Anthropic web_fetch returns raw page text, not a model summary).
  if (text.length < 800) {
    onProgress?.(`verify: direct fetch thin (${text.length} chars) for ${url}`);
    try {
      const t = await llm().fetchPageText(url);
      if (t && t.length > text.length) text = t;
    } catch {}
  }
  const out = text.slice(0, MAX_PAGE_CHARS);
  cache.set(normUrl(url), out);
  return out;
}

/**
 * Stage 4: independent verification. For each cited URL, re-read the page and
 * check every claim citing it. The verifier never sees the research notes.
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

  const verdicts = new Map<string, Verdict[]>(); // claim id -> verdicts across its URLs
  const cache = new Map<string, string>();
  const jobs = [...byUrl.values()];
  onProgress?.(`verify: ${jobs.length} source page(s), ${claims.filter((c) => c.evidence.evidence_status === "sourced_from_docs").length} sourced claim(s)`);

  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const text = await pageText(job.url, cache, onProgress);
      let results: Verdict[];
      if (!text) {
        results = job.claims.map((c) => ({ id: c.id, verdict: "source_unreachable" as const, note: "Page could not be retrieved." }));
      } else {
        try {
          const out = await llm().structured({
            system: VERIFY_SYSTEM,
            user: verifyUserPrompt(job.url, text, job.claims.map(({ id, statement }) => ({ id, statement }))),
            schema: VerifyOut,
            effort: "low",
          });
          results = out.results;
        } catch (e) {
          results = job.claims.map((c) => ({ id: c.id, verdict: "source_unreachable" as const, note: `Verifier error: ${String(e)}` }));
        }
      }
      for (const r of results) {
        if (!verdicts.has(r.id)) verdicts.set(r.id, []);
        verdicts.get(r.id)!.push(r);
      }
      onProgress?.(`verify: checked ${job.url} (${results.filter((r) => r.verdict === "supported").length}/${results.length} supported)`);
    }
  }
  await Promise.all(Array.from({ length: llm().verifyConcurrency }, worker));

  for (const c of claims) {
    if (c.evidence.evidence_status !== "sourced_from_docs") continue;
    const vs = verdicts.get(c.id) ?? [];
    const pick = (v: Verdict["verdict"]) => vs.find((x) => x.verdict === v);
    const best = pick("supported") ?? pick("partially_supported") ?? pick("source_unreachable") ?? pick("unsupported");
    if (!best) {
      c.evidence.verification = { verdict: "source_unreachable", note: "Verifier returned no result." };
    } else if (best.verdict === "unsupported") {
      c.evidence.verification = { verdict: "unsupported", note: best.note, original_status: "sourced_from_docs" };
      c.evidence.evidence_status = "inferred";
    } else {
      c.evidence.verification = { verdict: best.verdict, note: best.note };
    }
  }
  return g;
}
