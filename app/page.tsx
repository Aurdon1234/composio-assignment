import { connection } from "next/server";
import { Suspense } from "react";
import { Generator } from "@/components/Generator";
import { LibraryGrid, type GuideCard } from "@/components/LibraryGrid";
import { listGuides } from "@/lib/storage";
import { BLOCKER_LABEL, formatMinutes, formatWait } from "@/lib/ui";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-4 py-10">
      <header className="max-w-3xl space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Will I be blocked, and for how long?</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          OAuth app setup guides for agent builders: how hard it is to get an OAuth app approved, how much of your time it takes vs. how
          long you wait on the provider, what can block you, and which steps an agent can do for you. Every claim is labeled with how we
          know it.
        </p>
      </header>

      <Generator />

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Library</h2>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading guides…</p>}>
          <Library />
        </Suspense>
      </section>

      <EvidenceLegend />
    </main>
  );
}

async function Library() {
  await connection(); // read storage at request time so live-generated guides show up
  const stored = await listGuides();
  const cards: GuideCard[] = stored.map(({ guide: g, origin }) => ({
    slug: g.app.slug,
    name: g.app.name,
    tier: g.verdict.tier,
    summary: g.verdict.summary,
    effort: formatMinutes(g.time.effort_minutes.min, g.time.effort_minutes.max),
    wait: formatWait(g.time.wait_days),
    topBlocker: g.blockers[0] ? BLOCKER_LABEL[g.blockers[0].type] + (g.blockers[0].applies_when ? ` (${g.blockers[0].applies_when})` : "") : null,
    origin,
    generatedAt: g.generated_at,
    claims: g.verification_summary.claims_total,
    tested: g.verification_summary.by_status.verified_by_test,
    sourced: g.verification_summary.by_status.sourced_from_docs,
  }));
  if (!cards.length) return <p className="text-sm text-zinc-500">No guides yet. Generate one above.</p>;
  return <LibraryGrid cards={cards} />;
}

function EvidenceLegend() {
  const items = [
    ["✓ Tested", "Observed directly by a public, unauthenticated probe (discovery docs, endpoint responses, link checks)."],
    ["§ From docs", "Stated in a cited source the pipeline actually retrieved; a separate verifier re-read the source."],
    ["~ Inferred", "Our estimate or conclusion, a community report, or a claim the verifier could not confirm."],
    ["? Unknown", "We could not determine it."],
  ];
  return (
    <section className="rounded-xl border border-zinc-200 p-5 text-sm dark:border-zinc-800">
      <h2 className="mb-2 font-semibold">How to read the evidence labels</h2>
      <dl className="grid gap-2 sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium">{k}</dt>
            <dd className="text-zinc-600 dark:text-zinc-400">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-zinc-500">
        No accounts are created and nothing is submitted to providers. Review timelines are only shown as published when an official page
        states them.
      </p>
    </section>
  );
}
