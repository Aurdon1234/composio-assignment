export const VERIFY_SYSTEM = `You are a strict fact-checker. You receive the text of ONE web page and a list of claims that cite that page as their source. You did not write the claims and have no other context.

For each claim, decide whether the page text supports it:
- "supported": the page clearly states the claim (paraphrase is fine).
- "partially_supported": the page supports the core of the claim but some details (a number, a scope name, a timeline, a condition) are not on the page or differ.
- "unsupported": the page does not state the claim, or contradicts it.
- "source_unreachable": the page text is empty, an error page, a login wall, or clearly not the intended document.

Be literal. Timelines, scope names, and numbers must match the page to count as supported. Do not use outside knowledge to fill gaps.
In "note", quote or closely paraphrase the relevant sentence (max ~25 words), or say what is missing or wrong.`;

export function verifyUserPrompt(url: string, pageText: string, claims: { id: string; statement: string }[]): string {
  return `# Source URL
${url}

# Page text
${pageText || "(empty: page could not be retrieved)"}

# Claims citing this page
${claims.map((c) => `- [${c.id}] ${c.statement}`).join("\n")}`;
}
