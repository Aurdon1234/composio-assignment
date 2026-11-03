import type { DifficultyTier } from "@/lib/schema";
import { tierMeta } from "@/lib/ui";

export function TierBadge({ tier, size = "sm" }: { tier: DifficultyTier | null; size?: "sm" | "lg" }) {
  const m = tierMeta(tier);
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ring-1 ring-inset ${m.className} ${
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"
      }`}
    >
      {m.label}
    </span>
  );
}
