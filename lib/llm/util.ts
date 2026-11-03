/** Drop locale switches (?hl=fa) so we cite the default-language page. Evaluation found Persian/Arabic Google docs cited. */
export function cleanUrl(u: string): string {
  try {
    const x = new URL(u);
    x.searchParams.delete("hl");
    x.hash = "";
    return x.toString();
  } catch {
    return u;
  }
}

export function normUrl(u: string): string {
  try {
    const x = new URL(cleanUrl(u));
    x.hash = "";
    let s = x.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

export function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Pull the last ```json fenced block (or bare object) out of free text. */
export function extractJsonBlock(text: string): unknown {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fences.length) return safeJson(fences[fences.length - 1][1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return safeJson(text.slice(start, end + 1));
  return null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
