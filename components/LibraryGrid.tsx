"use client";

import Link from "next/link";
import { useState } from "react";
import type { DifficultyTier } from "@/lib/schema";
import { TIER_META, tierMeta } from "@/lib/ui";
import { TierBadge } from "./TierBadge";

export type GuideCard = {
  slug: string;
  name: string;
  tier: DifficultyTier | null;
  summary: string;
  effort: string;
  wait: string;
  topBlocker: string | null;
  origin: "library" | "live";
  generatedAt: string;
  claims: number;
  tested: number;
  sourced: number;
};

export function LibraryGrid({ cards }: { cards: GuideCard[] }) {
  const [filter, setFilter] = useState<DifficultyTier | "all">("all");
  const tiers = Object.keys(TIER_META) as DifficultyTier[];
  const shown = cards.filter((c) => filter === "all" || c.tier === filter);
  const count = (t: DifficultyTier) => cards.filter((c) => c.tier === t).length;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by difficulty">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All ({cards.length})
        </FilterChip>
        {tiers.map((t) => (
          <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)}>
            {TIER_META[t].label} ({count(t)})
          </FilterChip>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">No guides in this tier yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/guides/${c.slug}`}
                className="flex h-full flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold">{c.name}</h3>
                  <TierBadge tier={c.tier} />
                </div>
                <p className="line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">{c.summary}</p>
                <dl className="mt-auto grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-zinc-500">Your effort</dt>
                    <dd className="font-medium">{c.effort}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Wait on provider</dt>
                    <dd className="font-medium">{c.wait}</dd>
                  </div>
                </dl>
                {c.topBlocker && <p className="text-xs text-zinc-500">Main blocker: {c.topBlocker}</p>}
                <p className="text-xs text-zinc-400">
                  {c.tested} tested · {c.sourced} from docs · {c.claims - c.tested - c.sourced} inferred/unknown
                  {c.origin === "live" && " · generated live"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-zinc-500">{filter !== "all" && tierMeta(filter).blurb}</p>
    </section>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}
