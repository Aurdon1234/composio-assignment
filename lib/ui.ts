import type { DifficultyTier, EvidenceStatus, Guide } from "./schema";

export const TIER_META: Record<DifficultyTier, { label: string; short: string; className: string; blurb: string }> = {
  instant_self_serve: {
    label: "Instant self-serve",
    short: "Instant",
    className: "bg-emerald-100 text-emerald-900 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
    blurb: "Create the app and real users can connect right away.",
  },
  self_serve_with_review: {
    label: "Self-serve + review",
    short: "Review",
    className: "bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
    blurb: "Build and test yourself; review or verification before going public or using sensitive scopes.",
  },
  gated_partner: {
    label: "Gated partner program",
    short: "Partner",
    className: "bg-orange-100 text-orange-900 ring-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800",
    blurb: "Apply to a partner program before you get useful access.",
  },
  paid_or_business_verified: {
    label: "Paid / business-verified",
    short: "Paid/verified",
    className: "bg-rose-100 text-rose-900 ring-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800",
    blurb: "Needs a paid plan and/or a verified legal business.",
  },
};

export const UNKNOWN_TIER = {
  label: "Unknown",
  short: "Unknown",
  className: "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  blurb: "Not enough public documentation to classify.",
};

export const tierMeta = (t: DifficultyTier | null) => (t ? TIER_META[t] : UNKNOWN_TIER);

export const EVIDENCE_META: Record<EvidenceStatus, { label: string; icon: string; className: string; explain: string }> = {
  verified_by_test: {
    label: "Tested",
    icon: "✓",
    className: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
    explain: "We observed this directly with a public, unauthenticated probe.",
  },
  sourced_from_docs: {
    label: "From docs",
    icon: "§",
    className: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900",
    explain: "Stated in a cited source that the pipeline retrieved; a separate verifier re-read the source.",
  },
  inferred: {
    label: "Inferred",
    icon: "~",
    className: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
    explain: "Our reasonable conclusion or estimate; not directly stated by a source.",
  },
  unknown: {
    label: "Unknown",
    icon: "?",
    className: "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
    explain: "We could not determine this.",
  },
};

export function formatMinutes(min: number | null, max: number | null): string {
  if (min === null && max === null) return "Unknown";
  const h = (m: number) => `${Math.round((m / 60) * 10) / 10}`;
  const f = (m: number) => (m >= 120 ? `${h(m)} h` : `${m} min`);
  if (min !== null && max !== null && min !== max) {
    if (max < 120) return `${min}–${max} min`;
    if (min >= 120) return `${h(min)}–${h(max)} h`;
    return `${f(min)}–${f(max)}`;
  }
  return f((min ?? max)!);
}

export function formatWait(w: Guide["time"]["wait_days"]): string {
  if (w.min === null && w.max === null) return w.published_by_provider ? "Unknown" : "Not published";
  if ((w.min ?? 0) === 0 && (w.max ?? 0) === 0) return "None";
  const d = (n: number) => (n >= 14 ? `${Math.round(n / 7)} wk` : `${n} d`);
  if (w.min !== null && w.max !== null && w.min !== w.max) return `${d(w.min)}–${d(w.max)}`;
  return d((w.min ?? w.max)!);
}

export const OWNER_META = {
  agent: { label: "Agent", className: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
  developer: { label: "You", className: "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100" },
  provider: { label: "Provider", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
} as const;

export const BLOCKER_LABEL: Record<string, string> = {
  business_verification: "Business verification",
  security_assessment: "Security assessment",
  privacy_policy: "Privacy policy",
  demo_video: "Demo video",
  paid_tier: "Paid plan",
  partner_application: "Partner application",
  other: "Other",
};
