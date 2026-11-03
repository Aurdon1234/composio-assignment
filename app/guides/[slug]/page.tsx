import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CopyLink } from "@/components/CopyLink";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import { TierBadge } from "@/components/TierBadge";
import type { Guide } from "@/lib/schema";
import { getGuide } from "@/lib/storage";
import { BLOCKER_LABEL, EVIDENCE_META, OWNER_META, formatMinutes, formatWait, tierMeta } from "@/lib/ui";

export default function GuidePage({ params }: PageProps<"/guides/[slug]">) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading guide…</p>}>
        <GuideView params={params} />
      </Suspense>
    </main>
  );
}

async function GuideView({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const stored = await getGuide(slug);
  if (!stored) notFound();
  const g = stored.guide;

  return (
    <article className="space-y-8">
      <Header g={g} origin={stored.origin} />
      {g.status !== "complete" && <StatusBanner g={g} />}
      <VerdictCard g={g} />
      <Prerequisites g={g} />
      <Steps g={g} />
      <Blockers g={g} />
      <Scopes g={g} />
      <Technical g={g} />
      <Pitfalls g={g} />
      <Escalation g={g} />
      <Tested g={g} />
      <Sources g={g} />
      <footer className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
        Generated {new Date(g.generated_at).toUTCString()} by pipeline v{g.pipeline_version} ({g.model}) from the query “{g.query}”. Schema v
        {g.schema_version}.
      </footer>
    </article>
  );
}

/* ---------------------------------------------------------------- header */

function Header({ g, origin }: { g: Guide; origin: "library" | "live" }) {
  const links = [
    ["Website", g.app.website],
    ["Developer console", g.app.developer_portal_url],
    ["OAuth docs", g.app.oauth_docs_url],
  ].filter(([, u]) => u) as [string, string][];
  return (
    <header className="space-y-3">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← All guides
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{g.app.name}: OAuth app setup & approval</h1>
        <CopyLink />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {links.map(([label, u]) => (
          <a key={label} href={u} target="_blank" rel="noreferrer" className="text-sky-700 underline dark:text-sky-400">
            {label} ↗
          </a>
        ))}
        <span className="text-zinc-500">
          {origin === "live" ? "Generated live" : "Library guide"} · updated {new Date(g.generated_at).toISOString().slice(0, 10)}
        </span>
      </div>
    </header>
  );
}

function StatusBanner({ g }: { g: Guide }) {
  const text =
    g.status === "no_oauth_found"
      ? "We could not find public OAuth documentation for this app. The guide below says what we checked rather than guessing a setup flow."
      : "Partial guide: we found OAuth documentation, but important parts (often the review process) were not documented publicly or could not be read.";
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {text}
    </div>
  );
}

/* ---------------------------------------------------------------- verdict */

function VerdictCard({ g }: { g: Guide }) {
  const m = tierMeta(g.verdict.tier);
  const w = g.time.wait_days;
  const agentSteps = g.steps.filter((s) => s.agent_can_automate || s.owner === "agent");
  const youSteps = g.steps.filter((s) => s.owner === "developer" && !s.agent_can_automate);
  const providerSteps = g.steps.filter((s) => s.owner === "provider");
  const s = g.verification_summary.by_status;

  return (
    <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <TierBadge tier={g.verdict.tier} size="lg" />
        <span className="text-sm text-zinc-500">{m.blurb}</span>
      </div>
      <p className="text-lg">
        {g.verdict.summary} <EvidenceBadge evidence={g.verdict.evidence} />
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Your hands-on effort" value={formatMinutes(g.time.effort_minutes.min, g.time.effort_minutes.max)} evidence={g.time.effort_minutes.evidence}>
          Setup, coding and preparing any review submission. Excludes waiting.
        </Stat>
        <Stat label="Waiting on the provider" value={formatWait(w)} evidence={w.evidence}>
          {w.applies_to && w.applies_to !== "unknown" && <span className="block">Applies: {w.applies_to}.</span>}
          {w.published_by_provider
            ? "Timeline published by the provider."
            : w.community_reported && (w.min !== null || w.max !== null)
              ? "Not published by the provider; this range is community-reported."
              : "The provider does not publish a review timeline."}
        </Stat>
      </div>
      <p className="text-xs text-zinc-500">Confidence in these estimates: {g.time.confidence}.</p>

      {g.blockers.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">What could block you</h3>
          <ul className="space-y-1.5">
            {g.blockers.slice(0, 3).map((b, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{BLOCKER_LABEL[b.type]}:</span> {b.description}
                {b.applies_when && <span className="text-zinc-500"> — when {b.applies_when.replace(/^when\s+/i, "")}</span>}{" "}
                <EvidenceBadge evidence={b.evidence} compact />
              </li>
            ))}
          </ul>
          {g.blockers.length > 3 && (
            <a href="#blockers" className="text-sm text-sky-700 underline dark:text-sky-400">
              All {g.blockers.length} blockers
            </a>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <HandoffList title="An agent can do" tone="agent" items={agentSteps.map((x) => x.title)} empty="Nothing automatable identified." />
        <HandoffList title="You take over" tone="developer" items={youSteps.map((x) => x.title)} empty="No manual steps identified." />
        <HandoffList title="You wait on the provider" tone="provider" items={providerSteps.map((x) => x.title)} empty="No provider review step." />
      </div>

      <p className="text-xs text-zinc-500">
        {g.verification_summary.claims_total} claims: {s.verified_by_test} tested · {s.sourced_from_docs} from docs · {s.inferred} inferred ·{" "}
        {s.unknown} unknown
        {g.verification_summary.downgraded > 0 && ` · ${g.verification_summary.downgraded} downgraded by the verifier`}. Click any label for its sources.
      </p>
    </section>
  );
}

function Stat({ label, value, evidence, children }: { label: string; value: string; evidence: Guide["verdict"]["evidence"]; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-950">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-bold">{value}</span>
        <EvidenceBadge evidence={evidence} />
      </div>
      <p className="mt-1 text-xs text-zinc-500">{children}</p>
    </div>
  );
}

function HandoffList({ title, tone, items, empty }: { title: string; tone: keyof typeof OWNER_META; items: string[]; empty: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className={`rounded px-1.5 py-0.5 text-xs ${OWNER_META[tone].className}`}>{OWNER_META[tone].label}</span>
        {title}
      </h3>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">{empty}</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- sections */

function Section({ id, title, children, intro }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {intro && <p className="text-sm text-zinc-500">{intro}</p>}
      {children}
    </section>
  );
}

function Prerequisites({ g }: { g: Guide }) {
  if (!g.prerequisites.length) return null;
  return (
    <Section id="prerequisites" title="Before you start">
      <ul className="space-y-1.5">
        {g.prerequisites.map((p, i) => (
          <li key={i} className="text-sm">
            {p.item} <EvidenceBadge evidence={p.evidence} compact />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Steps({ g }: { g: Guide }) {
  if (!g.steps.length) return null;
  return (
    <Section id="steps" title="Steps" intro="Owner shows who does each step. “Agent can automate” means an AI coding agent can do it or prepare everything for your approval.">
      <ol className="space-y-3">
        {[...g.steps]
          .sort((a, b) => a.order - b.order)
          .map((s) => (
            <li key={s.order} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {s.order}
                </span>
                <h3 className="font-semibold">{s.title}</h3>
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${OWNER_META[s.owner].className}`}>{OWNER_META[s.owner].label}</span>
                {s.agent_can_automate && s.owner !== "agent" && (
                  <span className="rounded px-1.5 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-violet-200 dark:text-violet-300 dark:ring-violet-800">
                    agent can automate
                  </span>
                )}
                <EvidenceBadge evidence={s.evidence} />
              </div>
              <p className="mt-2 text-sm">{s.detail}</p>
              {s.notes && <p className="mt-1 text-sm text-zinc-500">{s.notes}</p>}
            </li>
          ))}
      </ol>
    </Section>
  );
}

function Blockers({ g }: { g: Guide }) {
  return (
    <Section id="blockers" title="Blockers and requirements">
      {g.blockers.length ? (
        <ul className="space-y-2">
          {g.blockers.map((b, i) => (
            <li key={i} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{BLOCKER_LABEL[b.type]}</span>
                <EvidenceBadge evidence={b.evidence} />
              </div>
              <p className="mt-1">{b.description}</p>
              {b.applies_when && <p className="mt-1 text-zinc-500">Applies when: {b.applies_when}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No blockers found in the sources we read.</p>
      )}
    </Section>
  );
}

function Scopes({ g }: { g: Guide }) {
  return (
    <Section id="scopes" title="Scopes that trigger review or restrictions">
      {g.review_triggering_scopes.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-2 pr-4">Scope</th>
                <th className="py-2 pr-4">Why it matters</th>
                <th className="py-2">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {g.review_triggering_scopes.map((s, i) => (
                <tr key={i} className="align-top">
                  <td className="py-2 pr-4 font-mono text-xs">{s.scope}</td>
                  <td className="py-2 pr-4">{s.why}</td>
                  <td className="py-2">
                    <EvidenceBadge evidence={s.evidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No review-triggering or restricted scopes were documented in the sources we read.</p>
      )}
    </Section>
  );
}

function Technical({ g }: { g: Guide }) {
  if (!g.technical.length) return null;
  return (
    <Section id="technical" title="Technical details">
      <ul className="space-y-1.5">
        {g.technical.map((t, i) => (
          <li key={i} className="text-sm">
            {t.fact} <EvidenceBadge evidence={t.evidence} compact />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Pitfalls({ g }: { g: Guide }) {
  if (!g.pitfalls.length) return null;
  return (
    <Section id="pitfalls" title="Pitfalls">
      <ul className="list-disc space-y-1.5 pl-5">
        {g.pitfalls.map((p, i) => (
          <li key={i} className="text-sm">
            {p.description} <EvidenceBadge evidence={p.evidence} compact />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Escalation({ g }: { g: Guide }) {
  return (
    <Section id="escalation" title="When you're blocked">
      {g.escalation_path.length ? (
        <ul className="space-y-2">
          {g.escalation_path.map((e, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer" className="text-sky-700 underline dark:text-sky-400">
                    {e.channel} ↗
                  </a>
                ) : (
                  e.channel
                )}
              </span>{" "}
              — {e.when_to_use} <EvidenceBadge evidence={e.evidence} compact />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No escalation channels found.</p>
      )}
    </Section>
  );
}

const OUTCOME_STYLE: Record<string, string> = {
  positive: "text-emerald-700 dark:text-emerald-400",
  negative: "text-rose-700 dark:text-rose-400",
  inconclusive: "text-amber-700 dark:text-amber-400",
  error: "text-rose-700 dark:text-rose-400",
  skipped: "text-zinc-500",
};

function Tested({ g }: { g: Guide }) {
  return (
    <Section id="tested" title="What we tested" intro="Real requests made by the pipeline, with their results. Failures and skipped probes are listed too.">
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Check</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">What we saw</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {g.probes.map((p) => (
              <tr key={p.id} id={`probe-${p.id}`} className="align-top">
                <td className="px-3 py-2 font-mono text-xs">{p.id}</td>
                <td className="px-3 py-2">
                  <div>{p.kind.replace(/_/g, " ")}</div>
                  {p.target_url && <div className="break-all font-mono text-xs text-zinc-500">{p.method !== "none" ? `${p.method} ` : ""}{p.target_url}</div>}
                </td>
                <td className={`px-3 py-2 font-medium ${OUTCOME_STYLE[p.outcome]}`}>
                  {p.outcome}
                  {p.http_status !== null && <span className="block text-xs font-normal text-zinc-500">HTTP {p.http_status}</span>}
                </td>
                <td className="px-3 py-2">
                  {p.summary}
                  <div className="text-xs text-zinc-400">{new Date(p.timestamp).toISOString().replace("T", " ").slice(0, 19)} UTC</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
        <p className="mb-1 font-medium">Limits of this guide</p>
        <ul className="list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-400">
          {g.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

function Sources({ g }: { g: Guide }) {
  const label: Record<string, string> = {
    official_docs: "Official docs",
    official_blog: "Official blog",
    official_forum: "Official forum",
    community: "Community",
    other: "Other",
  };
  return (
    <Section id="sources" title="Sources">
      <ul className="space-y-1 text-sm">
        {g.sources.map((s) => (
          <li key={s.url} className="flex flex-wrap items-baseline gap-2">
            <span className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{label[s.source_type]}</span>
            <a href={s.url} target="_blank" rel="noreferrer" className="break-all text-sky-700 underline dark:text-sky-400">
              {s.title || s.url}
            </a>
            <span className="text-xs text-zinc-400">
              {s.retrieval === "fetched" ? "read in full" : s.retrieval === "probe" ? "probed" : "search result"} · {s.retrieved_at.slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">
        Legend: {Object.values(EVIDENCE_META).map((m) => `${m.icon} ${m.label}`).join(" · ")}
      </p>
    </Section>
  );
}
