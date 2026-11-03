import { get, list, put } from "@vercel/blob";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Guide } from "./schema";

/**
 * Guide storage.
 *  - Library: committed JSON in /guides (read-only on Vercel).
 *  - Live-generated guides: Vercel Blob when BLOB_READ_WRITE_TOKEN is set
 *    (production), otherwise the same /guides folder (local dev / CLI).
 * Reads check the library first, then Blob.
 */
const DIR = path.join(process.cwd(), "guides");
// Classic stores expose BLOB_READ_WRITE_TOKEN; newer ones expose BLOB_STORE_ID and the SDK
// authenticates with Vercel's OIDC token automatically.
export const useBlob = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
let BLOB_ACCESS: "public" | "private" = process.env.BLOB_ACCESS === "private" ? "private" : "public";
const flipAccess = (e: unknown) => {
  // A store only accepts its own access mode; switch once if the error says so.
  if (/access|private|public/i.test(String(e))) {
    BLOB_ACCESS = BLOB_ACCESS === "public" ? "private" : "public";
    return true;
  }
  return false;
};
const blobPath = (slug: string) => `guides/${slug}.json`;
const validSlug = (slug: string) => /^[a-z0-9-]{1,80}$/.test(slug);

export type GuideOrigin = "library" | "live";
export type StoredGuide = { guide: Guide; origin: GuideOrigin };

export async function saveGuide(g: Guide, opts: { target?: "auto" | "fs" } = {}): Promise<string> {
  const body = JSON.stringify(g, null, 2) + "\n";
  if (useBlob() && opts.target !== "fs") {
    const doPut = () =>
      put(blobPath(g.app.slug), body, {
        access: BLOB_ACCESS,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
    try {
      return (await doPut()).url;
    } catch (e) {
      if (!flipAccess(e)) throw e;
      return (await doPut()).url;
    }
  }
  try {
    await fs.mkdir(DIR, { recursive: true });
    const file = path.join(DIR, `${g.app.slug}.json`);
    await fs.writeFile(file, body, "utf8");
    return file;
  } catch (e) {
    // Read-only deployment without Blob configured: keep the guide in this instance's /tmp so the
    // permalink works while the instance lives, and say clearly what is missing.
    if (opts.target === "fs") throw e;
    console.warn(`[storage] ${String(e)}; BLOB_READ_WRITE_TOKEN is not set, saving to ${TMP_DIR} (not durable)`);
    await fs.mkdir(TMP_DIR, { recursive: true });
    const file = path.join(TMP_DIR, `${g.app.slug}.json`);
    await fs.writeFile(file, body, "utf8");
    return file;
  }
}

const TMP_DIR = path.join(os.tmpdir(), "oauth-guides");

async function readTmp(slug: string): Promise<Guide | null> {
  try {
    return Guide.parse(JSON.parse(await fs.readFile(path.join(TMP_DIR, `${slug}.json`), "utf8")));
  } catch {
    return null;
  }
}

async function readLibrary(slug: string): Promise<Guide | null> {
  try {
    const raw = await fs.readFile(path.join(DIR, `${slug}.json`), "utf8");
    return Guide.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function readBlob(slug: string): Promise<Guide | null> {
  if (!useBlob()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await get(blobPath(slug), { access: BLOB_ACCESS, useCache: false });
      if (!r || r.statusCode !== 200) return null;
      const raw = await new Response(r.stream).text();
      return Guide.parse(JSON.parse(raw));
    } catch (e) {
      if (attempt === 0 && flipAccess(e)) continue;
      return null;
    }
  }
  return null;
}

export async function getGuide(slug: string): Promise<StoredGuide | null> {
  if (!validSlug(slug)) return null;
  // Live guides can be regenerated over a library entry; prefer the newer one.
  const [lib, blob, tmp] = await Promise.all([readLibrary(slug), readBlob(slug), readTmp(slug)]);
  const live = blob ?? tmp;
  if (lib && live) return live.generated_at > lib.generated_at ? { guide: live, origin: "live" } : { guide: lib, origin: "library" };
  if (lib) return { guide: lib, origin: "library" };
  if (live) return { guide: live, origin: "live" };
  return null;
}

export async function listGuides(): Promise<StoredGuide[]> {
  const out = new Map<string, StoredGuide>();
  try {
    for (const f of (await fs.readdir(DIR)).filter((f) => f.endsWith(".json"))) {
      const g = await readLibrary(f.replace(/\.json$/, ""));
      if (g) out.set(g.app.slug, { guide: g, origin: "library" });
    }
  } catch {}
  if (useBlob()) {
    try {
      const { blobs } = await list({ prefix: "guides/", limit: 200 });
      await Promise.all(
        blobs.map(async (b) => {
          const slug = b.pathname.replace(/^guides\//, "").replace(/\.json$/, "");
          if (out.has(slug)) return; // library entry wins in the listing
          const g = await readBlob(slug);
          if (g) out.set(slug, { guide: g, origin: "live" });
        }),
      );
    } catch {}
  }
  try {
    for (const f of (await fs.readdir(TMP_DIR)).filter((f) => f.endsWith(".json"))) {
      const slug = f.replace(/\.json$/, "");
      if (out.has(slug)) continue;
      const g = await readTmp(slug);
      if (g) out.set(slug, { guide: g, origin: "live" });
    }
  } catch {}
  return [...out.values()].sort((a, b) => a.guide.app.name.localeCompare(b.guide.app.name));
}

/** Intermediate artifacts (research notes) for debugging/evaluation; gitignored, best-effort. */
export async function saveDebug(slug: string, name: string, content: string): Promise<void> {
  try {
    const dir = path.join(process.cwd(), ".cache", slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), content, "utf8");
  } catch {
    // read-only filesystem (e.g. Vercel): skip
  }
}

export async function loadDebug(slug: string, name: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(process.cwd(), ".cache", slug, name), "utf8");
  } catch {
    return null;
  }
}
