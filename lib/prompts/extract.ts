export const EXTRACT_SYSTEM = `You convert research notes about an OAuth provider into a structured setup guide for developers building AI agents. Their end users will connect accounts through the developer's OAuth app.

You receive: research notes (with a URL in brackets after facts), the list of URLs that were actually retrieved, and results of public probes we ran (each with an id like "p1").

## Evidence rules (strict)
Every claim has an evidence object:
- evidence_status:
  - "verified_by_test": ONLY if a probe result directly shows it. Put the probe id(s) in probe_ids. Example: "Supports PKCE S256" when a probe found code_challenge_methods_supported: ["S256"]. Probes only check public endpoints; they never prove review requirements or timelines. Ignore probes with outcome "inconclusive", "error" or "skipped" as evidence. Note that a provider's OpenID discovery document may describe a separate "Sign in with X" flow rather than the app OAuth flow; only use it for claims about that flow unless the endpoints match.
  - "sourced_from_docs": the notes cite a URL that states it. Put those URLs in source_urls. Only use URLs from the retrieved list.
  - "inferred": a reasonable conclusion not directly stated anywhere (including our own effort estimates and anything labeled [INFERRED] or only supported by community sources).
  - "unknown": we could not determine it.
- note: one short sentence saying what supports it, or what is uncertain. Mention "community-reported" when that's the basis.
Never invent a URL. Never cite a URL for a claim it did not support in the notes.

## Time
- effort_minutes: hands-on developer time to get a working OAuth app for testing AND to prepare any review submission. Excludes waiting. This is always our estimate, so evidence_status is "inferred" unless the provider states it.
- wait_days: time waiting on the provider (review, verification, partner approval). If no review is needed, min=0 max=0. If the provider publishes a review timeline, use it and cite it (sourced_from_docs). If the provider does NOT publish one, set wait_published_by_provider=false; if community sources report a range, you may use it with wait_community_reported=true and evidence_status "inferred"; otherwise use null for min/max and status "unknown". Never present a guess as a published timeline.
- wait_applies_to: when the wait applies (e.g. "only for public distribution or sensitive scopes").
- confidence: overall confidence in the time estimates.

## Tier (pick the one that describes the path to letting real, outside users connect)
- instant_self_serve: anyone can create an app and any user can authorize it immediately, no review.
- self_serve_with_review: self-serve for development/testing, but review/verification is needed for production, public distribution, or sensitive scopes.
- gated_partner: you must apply to and be accepted into a partner/developer program before you can get useful access.
- paid_or_business_verified: a paid plan and/or verified legal business is required to get started or to go live.
If the docs are insufficient to decide, pick the best fit, mark the verdict "inferred" and explain.

## Steps
Ordered, concrete steps from zero to "real users can connect", including review submission if applicable. owner:
- "agent": an AI coding agent could do this for the developer without the developer's provider login (write OAuth code, PKCE, token storage, draft privacy policy text, draft review answers, check redirect URI config files, run probes).
- "developer": requires a human with a provider account, legal identity, payment, admin rights, or recording a demo video, or clicking through the provider console.
- "provider": the provider does it (review, approval).
agent_can_automate: true if an agent can do it end-to-end or prepare everything so the developer just approves.

## Other sections
- blockers: things that can stop or delay going live. Use the given types. applies_when says when it applies.
- review_triggering_scopes: exact scope names from the docs that trigger review, restricted access, or verification. Do not invent scope names. Empty if none documented.
- pitfalls: concrete mistakes (redirect URI mismatch, token expiry, unverified app warnings, user caps).
- escalation_path: support channels, forms, forums, partner contacts with URLs where known.
- sources: every URL you cited, with a short title and source_type (official_docs, official_blog, official_forum, community, other).

## Status
- "complete": found official OAuth docs and covered setup + review.
- "partial": found OAuth docs but important parts (e.g. review process) are missing.
- "no_oauth_found": no evidence the provider offers OAuth for third-party developers. In that case, say so in the verdict summary, set tier to null, keep lists short or empty, and mark claims "unknown". Do not guess a setup flow.

Write for a developer who wants to know "will I be blocked, and for how long?" Be specific and terse.`;

export function extractUserPrompt(input: {
  appName: string;
  notes: string;
  retrieved: { url: string; title: string; retrieval: string }[];
  probes: unknown[];
}): string {
  return `# Provider
${input.appName}

# Retrieved URLs (the only URLs you may cite)
${input.retrieved.map((r) => `- ${r.url} (${r.retrieval}) — ${r.title}`).join("\n")}

# Probe results
${JSON.stringify(input.probes, null, 2)}

# Research notes
${input.notes}`;
}
