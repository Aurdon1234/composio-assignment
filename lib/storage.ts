import { promises as fs } from "node:fs";
import path from "node:path";
import { Guide } from "./schema";

/**
 * Guide storage. The curated library is committed JSON in /guides.
 * Writes go to the same folder locally. (On Vercel the filesystem is read-only;
 * see lib/storage.blob.ts for the production adapter added in milestone 3.)
 */
const DIR = path.join(process.cwd(), "guides");

export async function saveGuide(g: Guide): Promise<string> {
  await fs.mkdir(DIR, { recursive: true });
  const file = path.join(DIR, `${g.app.slug}.json`);
  await fs.writeFile(file, JSON.stringify(g, null, 2) + "\n", "utf8");
  return file;
}

export async function getGuide(slug: string): Promise<Guide | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const raw = await fs.readFile(path.join(DIR, `${slug}.json`), "utf8");
    return Guide.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listGuides(): Promise<Guide[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Guide[] = [];
  for (const f of files) {
    const g = await getGuide(f.replace(/\.json$/, ""));
    if (g) out.push(g);
  }
  return out.sort((a, b) => a.app.name.localeCompare(b.app.name));
}
