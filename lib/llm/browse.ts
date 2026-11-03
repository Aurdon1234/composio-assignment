import { htmlToText, safeFetch } from "../pipeline/safeFetch";
import { cleanUrl } from "./util";

/**
 * Free web tools for providers without built-in search/fetch:
 *  - search(): Tavily if TAVILY_API_KEY is set (free tier, 1k/month), else DuckDuckGo's HTML endpoint (no key).
 *  - readPage(): our SSRF-guarded fetch, returns text + outgoing links so an agent can browse.
 */

export type SearchHit = { url: string; title: string; snippet: string };

export async function search(query: string, max = 8): Promise<SearchHit[]> {
  return (await rawSearch(query, max)).map((h) => ({ ...h, url: cleanUrl(h.url) }));
}

async function rawSearch(query: string, max: number): Promise<SearchHit[]> {
  if (process.env.TAVILY_API_KEY) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query, max_results: max }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const j = (await res.json()) as { results?: { url: string; title: string; content: string }[] };
      return (j.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.content.slice(0, 300) }));
    }
  }
  return duckDuckGoLite(query, max);
}

/**
 * Keyless fallback. DuckDuckGo rate-limits automated queries (we were flagged
 * after ~15 searches on the html endpoint), so this is best-effort only.
 */
async function duckDuckGoLite(query: string, max: number): Promise<SearchHit[]> {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; oauth-guide-research/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  if (res.status !== 200 || /anomaly/i.test(html)) {
    throw new Error("keyless search is rate-limited right now; set TAVILY_API_KEY for reliable search");
  }
  const hits: SearchHit[] = [];
  const blocks = html.split(/class='result-link'|class="result-link"/);
  for (let i = 0; i < blocks.length - 1 && hits.length < max; i++) {
    const href = blocks[i].match(/href="([^"]+)"[^>]*$/);
    if (!href) continue;
    let url = decode(href[1]);
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = "https:" + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com/.test(url)) continue; // skip ads/internal
    const title = strip(blocks[i + 1].match(/^>([\s\S]*?)<\/a>/)?.[1] ?? url);
    const snip = blocks[i + 1].match(/class='result-snippet'>([\s\S]*?)<\/td>/);
    hits.push({ url, title, snippet: snip ? strip(snip[1]).slice(0, 300) : "" });
  }
  return hits;
}

export type Page = { url: string; title: string; text: string; links: string[] } | { url: string; error: string };

export async function readPage(rawUrl: string, maxChars: number): Promise<Page> {
  const url = cleanUrl(rawUrl);
  const r = await safeFetch(url, { timeoutMs: 15000, accept: "text/html,text/plain,application/json,*/*" });
  if (!r.ok) return { url, error: r.error ?? `HTTP ${r.status}` };
  const isHtml = r.contentType?.includes("html") ?? false;
  const text = isHtml ? htmlToText(r.body) : r.body;
  const title = (isHtml && strip(r.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")) || r.finalUrl;
  return { url: r.finalUrl, title, text: text.slice(0, maxChars), links: isHtml ? extractLinks(r.body, r.finalUrl) : [] };
}

/** Outgoing links as "anchor text -> url", same-site first, capped. */
function extractLinks(html: string, base: string): string[] {
  const baseHost = new URL(base).hostname.split(".").slice(-2).join(".");
  const seen = new Set<string>();
  const same: string[] = [];
  const other: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let abs: URL;
    try {
      abs = new URL(decode(m[1]), base);
    } catch {
      continue;
    }
    if (abs.protocol !== "https:") continue;
    const key = abs.origin + abs.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = strip(m[2]).slice(0, 60) || abs.pathname;
    const line = `${label} -> ${key}`;
    (abs.hostname.endsWith(baseHost) ? same : other).push(line);
  }
  return [...same.slice(0, 70), ...other.slice(0, 15)];
}

function strip(s: string): string {
  return decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
