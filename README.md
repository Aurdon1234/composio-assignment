# OAuth App Approval Guides

**Will I be blocked, and for how long?** A developer building an AI agent needs their users to connect apps like Slack or Google. First they have to create an OAuth app with each provider, and sometimes get it reviewed. This project answers, for any app: how hard that is, how much of your own time it takes vs. how long you wait on the provider, what can block you, and which steps an agent can do for you. Every claim says how we know it.

- **Library:** guides for GitHub, Slack, Google Workspace, LinkedIn and Shopify, plus Cal.com (generated live).
- **Live generation:** type any app name or URL; a research agent investigates it and publishes a shareable guide in 1–4 minutes.
- **Evidence labels on every claim:** ✓ Tested (we observed it with a public probe) · § From docs (a cited official page states it, and a separate verifier re-read the page) · ~ Inferred (our estimate, a community report, or something the verifier could not confirm) · ? Unknown.
- **[EVALUATION.md](EVALUATION.md):** 31 claims checked by hand against the official sources. 65% correct, 19% wrong, 16% unverifiable, and what was changed because of it.

## How it works

One pipeline (`lib/pipeline/`) builds both the library (CLI) and live guides (web API):

| Stage | What it does | Model? |
|---|---|---|
| 1. Resolve | Two web searches to find the provider's OAuth docs | No |
| 2. Research | An agent browses with `web_search` and `fetch_page` (following links), and writes notes with a source URL after every fact | Yes |
| 3. Probe | Public, unauthenticated checks: OpenID / RFC 8414 discovery docs, authorize and token endpoints, PKCE and dynamic client registration advertised in metadata, doc pages load | No |
| 4. Extract | Notes + probe results → structured guide (zod schema). One revision pass if the draft drops material the notes contain | Yes |
| 4b. Link check | Requests every URL shown in the guide; dead links are removed | No |
| 5. Verify | A separate model call re-reads each cited page and checks the claims that cite it. It sees only claims + page text, never the research notes. Unsupported claims are downgraded to Inferred | Yes |
| 6. Render | Final consistency checks, schema validation, save to `/guides/<slug>.json`, served at `/guides/<slug>` | No |

**Evidence rules are enforced in code, not just prompts** (`lib/pipeline/evidence.ts`):
- A cited URL that the pipeline never retrieved is removed.
- "Tested" requires a real probe result; probe results become Tested facts directly.
- "From docs" requires at least one surviving source on the provider's own domain (decided by domain, not by the model's label).
- A review timeline is shown as published only while its claim is still sourced from official docs after verification.
- The verifier can downgrade claims, never upgrade them.

**What we never do:** create accounts, sign in, submit forms, register OAuth clients or use credentials. Probes are GET requests, plus one unauthenticated POST to the token endpoint with a fake code and a nonexistent client ID (to see that it answers with an OAuth error). Every guide's "What we tested" table lists each probe with its result and timestamp.

## Key decisions

- **Lead with the verdict, not the steps.** Developers first need to know whether they will be blocked and for how long, so each guide opens with a difficulty tier, *your effort* and *wait on the provider* side by side (they are different kinds of cost), the top blockers, and a three-way split of who does what: agent / you / provider.
- **Structured guides, not prose.** A fixed schema makes guides comparable across apps (filter the library by tier), lets code enforce evidence rules per claim, and lets the UI separate hands-on effort from waiting. Prose would hide the difference between "the docs say 10 weeks" and "we think a few weeks".
- **Evidence labels instead of confidence scores.** A reader can act on "a probe saw this" or "this page says this" and can click through to check. A single confidence number cannot be checked. Labels also made the pipeline's mistakes visible: in the evaluation, half of the wrong claims had already been labeled Inferred by the verifier.
- **Never fabricate timelines.** If a provider does not publish a review timeline, the guide says "not published". Community-reported ranges are labeled as such.
- **Demo apps chosen for different failure modes:** GitHub (no review at all), Slack and Shopify (review only for marketplace listing), Google Workspace (heavy security review and CASA for restricted scopes), LinkedIn (useful APIs gated behind product applications), Cal.com (obscure: sparse docs, but publishes OAuth metadata, and new clients start pending admin approval).
- **Free-tier stack.** The model is Gemini (free tier), with search via Tavily (free tier) and DuckDuckGo as a keyless fallback. Gemini's built-in Google Search has no free quota, so the agent browses with our own tools. An Anthropic adapter is included (`LLM_PROVIDER=anthropic`), but the shipped guides were generated with Gemini.

## What an agent can and cannot do today

| An agent can | A human must |
|---|---|
| Find the provider's docs, extract requirements and cite them | Sign up for the provider's developer account and accept its terms |
| Check public endpoints, discovery metadata, PKCE and dynamic client registration support | Create the OAuth app in the provider console (no provider in the library offers dynamic client registration) |
| Write the OAuth code: authorization URL, PKCE, token exchange, refresh, storage | Verify a business, domain or company page; pay for plans |
| Draft the privacy policy, scope justifications and review answers | Record the demo video and submit for review |
| Track which scopes trigger review and suggest narrower ones | Wait for the provider. That is the real blocker: up to 10 weeks for Slack Marketplace, several weeks plus a yearly security assessment for Google restricted scopes |

This split is per step in each guide (Agent / You / Provider badges).

## Setup

Requires **Node.js ≥ 22.12** (the Tailwind build step fails on Node 20.16).

```bash
npm install
cp .env.example .env.local   # then fill in the keys below
npm run check-llm            # confirms the model key works
npm run dev                  # http://localhost:3000
```

Environment variables (see `.env.example`):

| Variable | Needed for | Notes |
|---|---|---|
| `GEMINI_API_KEY` | research, extraction, verification | Free at aistudio.google.com |
| `TAVILY_API_KEY` | web search | Free at tavily.com (1,000 searches/month). Without it, DuckDuckGo is used, which rate-limits automated queries |
| `BLOB_READ_WRITE_TOKEN` | saving live guides on Vercel | Create a Blob store in the Vercel project. Locally, guides are saved to `/guides` |
| `ANTHROPIC_API_KEY`, `LLM_PROVIDER=anthropic` | optional alternative model | Uses Claude's server-side web search and fetch |

Generate library guides from the command line:

```bash
npm run generate -- github "Google Workspace" shopify.com
REUSE_RESEARCH=1 npm run generate -- github   # re-run later stages on cached research (no research calls)
```

**Deploy (Vercel):** import the repo, add `GEMINI_API_KEY` and `TAVILY_API_KEY`, connect a Blob store, and deploy. `/api/generate` sets `maxDuration = 300` because live generation takes 1–4 minutes; check that your Vercel plan allows functions that long, or generations will be cut off.

## Limitations

- **Public information only.** No sign-ups or submissions, so nothing behind a login was observed. Timelines are what providers publish, not measured.
- **Free-tier model quality and quota.** All shipped guides used `gemini-3.5-flash-lite`, because the main free-tier flash models allow 20 requests per day and one guide takes about 12. Extraction drops facts that are in the research notes (see EVALUATION.md). Live generation can fail when the daily quota is exhausted; the UI shows the error with a retry button.
- **The verifier checks content, not conditions.** It confirmed GitHub's "200 users" Marketplace number without noticing that it only applies to paid listings.
- **Guides go stale.** Each guide shows its generation date; providers change requirements. There is no scheduled refresh yet.
- **Probes are shallow by design.** They confirm endpoints are live and what metadata advertises. They cannot test review requirements or scopes.
- **Library size.** 6 guides, not 100. The CLI can batch-generate more, limited by the free-tier quota.

## Repository map

```
app/                    Next.js App Router: home, /guides/[slug], /api/generate (SSE)
components/             EvidenceBadge, Generator (live progress), LibraryGrid, ...
lib/schema.ts           zod guide schema (every claim carries an evidence object)
lib/pipeline/           resolve, research, probe, extract, linkcheck, verify, render, run
lib/prompts/            one prompt file per model stage
lib/llm/                provider layer: gemini.ts (browse agent), anthropic.ts, browse.ts (search + page reader)
guides/                 the library (committed JSON)
scripts/                generate.ts (CLI), check-llm.ts, rerender.ts
EVALUATION.md           evidence check against real sources
```
