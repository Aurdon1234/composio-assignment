import type { Evidence } from "@/lib/schema";
import { EVIDENCE_META } from "@/lib/ui";

const VERDICT_TEXT: Record<string, string> = {
  supported: "Verifier: source supports this",
  partially_supported: "Verifier: source supports part of this",
  unsupported: "Verifier: source did not support this (downgraded)",
  source_unreachable: "Verifier: could not read the source",
  not_checked: "",
};

/** Evidence label on a claim. Click to expand note, sources, probes and verifier result. No JS needed. */
export function EvidenceBadge({ evidence, compact = false }: { evidence: Evidence; compact?: boolean }) {
  const m = EVIDENCE_META[evidence.evidence_status];
  const v = evidence.verification;
  const partial = v?.verdict === "partially_supported";
  return (
    <details className="group inline-block align-middle text-xs">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${m.className} [&::-webkit-details-marker]:hidden`}
        title={m.explain}
      >
        <span aria-hidden>{m.icon}</span>
        {!compact && <span>{m.label}</span>}
        {partial && !compact && <span className="opacity-70">(partial)</span>}
      </summary>
      <div className="mt-2 max-w-prose space-y-1.5 rounded-md border border-zinc-200 bg-white p-3 text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">
          {m.label}: <span className="font-normal">{m.explain}</span>
        </p>
        {evidence.note && <p>{evidence.note}</p>}
        {v && v.verdict !== "not_checked" && (
          <p>
            <span className="font-medium">{VERDICT_TEXT[v.verdict]}.</span> {v.note}
            {v.original_status && <span> Originally labeled “{EVIDENCE_META[v.original_status].label}”.</span>}
          </p>
        )}
        {evidence.source_urls.length > 0 && (
          <ul className="list-disc pl-4">
            {evidence.source_urls.map((u) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer" className="break-all text-sky-700 underline dark:text-sky-400">
                  {u.replace(/^https?:\/\//, "")}
                </a>
              </li>
            ))}
          </ul>
        )}
        {evidence.probe_ids.length > 0 && (
          <p>
            Probes:{" "}
            {evidence.probe_ids.map((id) => (
              <a key={id} href={`#probe-${id}`} className="mr-1 font-mono text-sky-700 underline dark:text-sky-400">
                {id}
              </a>
            ))}
          </p>
        )}
      </div>
    </details>
  );
}
