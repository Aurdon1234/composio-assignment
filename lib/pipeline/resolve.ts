import { search, type SearchHit } from "../llm/browse";
import { normUrl, type ProgressFn, type RetrievedUrl } from "../llm";

export type Resolved = {
  found: boolean;
  name: string;
  website: string | null;
  developer_portal_url: string | null;
  oauth_docs_urls: string[];
  notes: string;
  slug: string;
  query: string;
  retrieved: Map<string, RetrievedUrl>;
};

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.(com|io|org|net|dev|app|co|ai)(\/.*)?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const OAUTH_HINT = /oauth|authoriz|auth\b|scopes?|app[- ]?review|verification|developer|create[- ]an?[- ]app|apps?\//i;
const COMMUNITY = /reddit|stackoverflow|stackexchange|medium\.com|dev\.to|youtube|quora/i;

/**
 * Stage 1: app name or URL -> name, website, candidate OAuth docs URLs.
 * Deliberately model-free (two searches + ranking) to save LLM quota; the
 * research agent confirms or replaces these starting points.
 */
export async function resolve(query: string, onProgress?: ProgressFn): Promise<Resolved> {
  const q = query.trim();
  let website: string | null = null;
  let name = q;
  if (/^https?:\/\/|^[\w-]+(\.[\w-]+)+(\/|$)/i.test(q)) {
    const u = new URL(/^https?:\/\//.test(q) ? q : `https://${q}`);
    website = u.origin;
    const host = u.hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    // Short labels are usually brand names that include the TLD (Cal.com, X.ai); keep the full host.
    name = label.length <= 4 ? host.charAt(0).toUpperCase() + host.slice(1) : titleCase(label);
  } else {
    name = titleCase(q);
  }

  const retrieved = new Map<string, RetrievedUrl>();
  const hits: SearchHit[] = [];
  for (const sq of [`${name} OAuth app developer documentation`, `${name} API create OAuth app client ID redirect URI`]) {
    onProgress?.(`search: ${sq}`);
    try {
      hits.push(...(await search(sq, 8)));
    } catch (e) {
      onProgress?.(`search failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  const now = new Date().toISOString();
  for (const h of hits) {
    if (!retrieved.has(normUrl(h.url))) retrieved.set(normUrl(h.url), { url: h.url, title: h.title, retrieval: "search_result", retrieved_at: now });
  }

  // Rank: provider-looking domains with OAuth-ish paths first; community last.
  const token = slugify(website ?? name).split("-")[0];
  const score = (h: SearchHit) => {
    const host = new URL(h.url).hostname;
    let s = 0;
    if (host.includes(token)) s += 3;
    if (OAUTH_HINT.test(h.url) || OAUTH_HINT.test(h.title)) s += 2;
    if (/docs?\.|developers?\.|dev\.|api\./.test(host)) s += 1;
    if (COMMUNITY.test(host)) s -= 4;
    return s;
  };
  const ranked = [...new Map(hits.map((h) => [normUrl(h.url), h])).values()].sort((a, b) => score(b) - score(a));
  const oauth_docs_urls = ranked.filter((h) => score(h) >= 3).slice(0, 4).map((h) => h.url);
  if (!website && oauth_docs_urls[0]) {
    const host = new URL(oauth_docs_urls[0]).hostname.split(".").slice(-2).join(".");
    website = `https://${host}`;
  }

  return {
    found: oauth_docs_urls.length > 0,
    name,
    website,
    developer_portal_url: null,
    oauth_docs_urls,
    notes: oauth_docs_urls.length
      ? `Starting points from search; other results: ${ranked.slice(0, 6).map((h) => h.url).join(", ")}`
      : `Search found no provider OAuth documentation for "${q}".`,
    slug: slugify(website && /^https?:\/\//.test(q) ? website : name),
    query: q,
    retrieved,
  };
}
