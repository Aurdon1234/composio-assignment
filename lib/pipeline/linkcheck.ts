import type { ProgressFn } from "../llm";
import type { Guide, Probe } from "../schema";
import { safeFetch } from "./safeFetch";

/**
 * Probe step 2 (after extraction): request every URL the guide presents as a link
 * (app links, escalation links). Dead links are removed rather than shown.
 * Each check is recorded as a doc_page_exists probe.
 */
export async function linkCheck(g: Guide, onProgress?: ProgressFn): Promise<Guide> {
  let n = g.probes.length;
  const cache = new Map<string, Probe>();
  const already = new Map(g.probes.filter((p) => p.target_url).map((p) => [p.target_url!, p]));

  async function check(url: string): Promise<Probe> {
    if (already.has(url)) return already.get(url)!;
    if (cache.has(url)) return cache.get(url)!;
    const r = await safeFetch(url, { timeoutMs: 10_000 });
    const final = (() => {
      try {
        return new URL(r.finalUrl);
      } catch {
        return null;
      }
    })();
    const signIn = !!final && r.finalUrl !== url && /(^|\/)(login|signin|sign-in|sign_in|session|auth)(\/|$)/i.test(final.pathname);
    // A redirect to a sign-in page means the console exists but needs an account (expected for dev portals).
    const ok = r.ok || signIn;
    const p: Probe = {
      id: `p${++n}`,
      kind: "doc_page_exists",
      target_url: url,
      method: "GET",
      outcome: r.error ? "error" : ok ? "positive" : "negative",
      http_status: r.status,
      summary: r.error
        ? `Link check failed: ${r.error}.`
        : ok
          ? `Link loads (HTTP ${r.status})${signIn ? " — redirects to sign-in, as expected for a developer console" : ""}.`
          : `Link returned HTTP ${r.status}; removed from the guide.`,
      details: { final_url: r.finalUrl, redirects: r.redirects, checked_as: "link_in_guide" },
      timestamp: new Date().toISOString(),
    };
    cache.set(url, p);
    g.probes.push(p);
    onProgress?.(`link ${p.outcome}: ${url}`);
    return p;
  }

  const dead = (p: Probe) => p.outcome === "negative" || (p.outcome === "error" && p.http_status === null);

  for (const key of ["website", "developer_portal_url", "oauth_docs_url"] as const) {
    const u = g.app[key];
    if (u && dead(await check(u))) g.app[key] = null;
  }
  for (const e of g.escalation_path) {
    if (!e.url) continue;
    const p = await check(e.url);
    if (dead(p)) {
      e.evidence.note += ` [link check: ${e.url} did not load (${p.http_status ?? p.summary}); URL removed]`;
      e.url = null;
    } else {
      e.evidence.probe_ids = [...new Set([...e.evidence.probe_ids, p.id])];
      e.evidence.note += " [link check: URL loads]";
    }
  }
  return g;
}
