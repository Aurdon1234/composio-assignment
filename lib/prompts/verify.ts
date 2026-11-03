export const VERIFY_SYSTEM = `You are a strict fact-checker. You receive the text of one or more web pages ("sources"). Each source lists the claims that cite it. You did not write the claims and have no other context.

For each (claim, source) pair, decide whether THAT source's text supports the claim:
- "supported": the page clearly states the claim (paraphrase is fine).
- "partially_supported": the page supports the core of the claim but some details (a number, a scope name, a timeline, a condition) are not on the page or differ.
- "unsupported": the page does not state the claim, or contradicts it.
- "source_unreachable": the page text is empty, an error page, a login wall, or clearly not the intended document.

Be literal. Timelines, scope names, and numbers must match the page to count as supported. Do not use outside knowledge, and do not use one source to judge a claim listed under a different source.
In "note", quote or closely paraphrase the relevant sentence (max ~25 words), or say what is missing or wrong.
Return one result per (claim, source) pair listed.`;

export function verifyUserPrompt(sources: { n: number; url: string; text: string; claims: { id: string; statement: string }[] }[]): string {
  return sources
    .map(
      (s) => `<source n="${s.n}" url="${s.url}">
<page_text>
${s.text || "(empty: page could not be retrieved)"}
</page_text>
<claims_citing_this_source>
${s.claims.map((c) => `- [${c.id}] ${c.statement}`).join("\n")}
</claims_citing_this_source>
</source>`,
    )
    .join("\n\n");
}
