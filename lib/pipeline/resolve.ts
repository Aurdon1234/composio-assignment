import { z } from "zod";
import { extractJsonBlock, runWebAgent, type ProgressFn, type RetrievedUrl } from "../anthropic";
import { RESOLVE_SYSTEM } from "../prompts/resolve";

export const Resolved = z.object({
  found: z.boolean(),
  name: z.string(),
  website: z.string().nullable(),
  developer_portal_url: z.string().nullable(),
  oauth_docs_urls: z.array(z.string()).default([]),
  notes: z.string().default(""),
});
export type Resolved = z.infer<typeof Resolved> & {
  slug: string;
  query: string;
  retrieved: Map<string, RetrievedUrl>;
};

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.(com|io|org|net|dev|app|co)(\/.*)?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Stage 1: app name or URL -> canonical name, developer portal, OAuth docs URLs. */
export async function resolve(query: string, onProgress?: ProgressFn): Promise<Resolved> {
  const res = await runWebAgent({
    system: RESOLVE_SYSTEM,
    user: `Identify this app and its OAuth developer documentation: ${JSON.stringify(query)}`,
    maxSearches: 4,
    maxFetches: 3,
    effort: "low",
    onProgress,
  });
  const parsed = Resolved.safeParse(extractJsonBlock(res.text));
  const data: z.infer<typeof Resolved> = parsed.success
    ? parsed.data
    : { found: false, name: query, website: null, developer_portal_url: null, oauth_docs_urls: [], notes: "Resolver output could not be parsed." };
  return { ...data, slug: slugify(data.name || query), query, retrieved: res.retrieved };
}
