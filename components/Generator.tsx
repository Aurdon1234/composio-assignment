"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Ev =
  | { type: "stage"; stage: string; status: "start" | "done"; message?: string }
  | { type: "progress"; stage: string; message: string }
  | { type: "done" | "cached"; slug: string; path: string }
  | { type: "error"; stage: string | null; message: string };

const STAGES = [
  { id: "resolve", label: "Find the provider's docs" },
  { id: "research", label: "Research setup & review requirements" },
  { id: "probe", label: "Probe public OAuth endpoints & links" },
  { id: "extract", label: "Draft the structured guide" },
  { id: "verify", label: "Re-check each claim against its source" },
  { id: "render", label: "Save & publish permalink" },
] as const;

export function Generator() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [stageState, setStageState] = useState<Record<string, "start" | "done">>({});
  const [stageMsg, setStageMsg] = useState<Record<string, string>>({});
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  async function run(force = false) {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    setStageState({});
    setStageMsg({});
    setLog([]);
    setStarted(Date.now());
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query.trim(), force }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (HTTP ${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!data) continue; // keep-alive comment
          handle(JSON.parse(data.slice(6)) as Ev);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handle(e: Ev) {
    if (e.type === "stage") {
      setStageState((s) => ({ ...s, [e.stage]: e.status }));
      if (e.message) setStageMsg((s) => ({ ...s, [e.stage]: e.message! }));
    } else if (e.type === "progress") {
      setLog((l) => [...l.slice(-60), e.message]);
      requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }));
    } else if (e.type === "done" || e.type === "cached") {
      if (e.type === "cached") setLog((l) => [...l, "Already in the library — opening the existing guide."]);
      router.push(e.path);
    } else if (e.type === "error") {
      setError(`${e.stage ? `Failed during "${e.stage}": ` : ""}${e.message}`);
    }
  }

  const elapsed = started ? Math.round((Date.now() - started) / 1000) : 0;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="q" className="sr-only">
          App name or website
        </label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="App name or website, e.g. Notion, calendly.com, Linear"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-sky-900"
          disabled={busy}
          maxLength={200}
        />
        <button
          type="submit"
          disabled={busy || query.trim().length < 2}
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {busy ? "Generating…" : "Get guide"}
        </button>
      </form>
      <p className="mt-2 text-xs text-zinc-500">
        Library apps open instantly. Anything else is researched live by an agent (usually 1–4 minutes on the free-tier model).
        It reads public docs and probes public endpoints only — no sign-ups, no forms, no credentials.
      </p>

      {(busy || error || log.length > 0) && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <ol className="space-y-1.5 text-sm">
            {STAGES.map((s) => {
              const st = stageState[s.id];
              return (
                <li key={s.id} className="flex items-start gap-2">
                  <span className="w-5 shrink-0 text-center">
                    {st === "done" ? "✓" : st === "start" ? <span className="inline-block animate-pulse">●</span> : "○"}
                  </span>
                  <span className={st ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"}>
                    {s.label}
                    {stageMsg[s.id] && <span className="block text-xs text-zinc-500">{stageMsg[s.id]}</span>}
                  </span>
                </li>
              );
            })}
            {busy && <li className="pl-7 text-xs text-zinc-500">{elapsed > 0 && `running…`}</li>}
          </ol>
          <ol
            ref={logRef}
            className="max-h-56 overflow-y-auto rounded-md bg-zinc-50 p-2 font-mono text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400"
            aria-live="polite"
          >
            {log.map((l, i) => (
              <li key={i} className="break-all">
                {l}
              </li>
            ))}
          </ol>
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          {error}
          <button onClick={() => run(true)} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
