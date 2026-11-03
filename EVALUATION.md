# Evidence check

How accurate are the generated guides? I checked a sample of claims from 5 library guides against the live official pages (read directly, not through the pipeline), on 2026-11-03. This file lists what held up, what was wrong, what I could not verify, and what I changed in the pipeline because of it.

**Method.** For each guide I picked the claims a developer would act on: verdict, wait time, blockers, review-triggering scopes, and technical facts with numbers in them. I then read the cited official page and compared. I did not create accounts or submit anything, so anything that only shows up after sign-in (consoles, review forms) is out of scope.

## Summary

| Guide | Claims checked | Correct | Wrong / overstated | Could not verify | Missing (in sources, not in guide) |
|---|---|---|---|---|---|
| GitHub | 7 | 6 | 1 | 0 | 2 |
| Slack | 6 | 3 | 3 | 0 | 0 |
| Google Workspace | 7 | 4 | 1 | 2 | 0 |
| LinkedIn | 5 | 4 | 0 | 1 | 1 |
| Shopify | 6 | 3 | 1 | 2 | 0 |
| **Total** | **31** | **20 (65%)** | **6 (19%)** | **5 (16%)** | **3** |

"Missing" counts facts that were in the official sources (and usually in the research notes) but not in the guide.

**The evidence labels mostly did their job.** Of the 6 wrong claims, 3 were already labeled "Inferred" by the pipeline's own verifier, so a reader would have been warned (Slack's two scopes, Slack's privacy-policy blocker). The 3 wrong claims shown as "From docs" are the serious ones, and each traced to a fixable cause (below).

## Findings by guide

### GitHub (instant self-serve)
Source: [creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [Marketplace listing requirements](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app).

- Correct: no review before use (the page goes straight from registration to credentials); up to 10 callback URLs; authorization codes expire after 10 minutes; PKCE supports only `S256` ("the `plain` code challenge method is not supported"); authorize and token endpoint URLs.
- **Overstated:** blocker "Marketplace listing requires an organization-owned app, 200 users and publisher verification." The source says these apply to **paid** listings only ("OAuth apps should have a minimum of 200 users" sits under paid-app requirements). Free listings have no such threshold. Labeled "From docs, supported" by the verifier, which matched the numbers but not the condition.
- Missing: user access tokens expire after 8 hours and refresh tokens after 6 months of non-use (on by default); org owners must approve OAuth apps when third-party access restrictions are on. Both were in the research notes; extraction dropped them.

### Slack (self-serve + review)
Source: [Slack Marketplace review guide](https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide).

- Correct: a demo video and test credentials are required for Marketplace review. The privacy-policy blocker was **correctly downgraded** by the verifier (the page does not state it).
- **Wrong:** wait time "not published". Slack publishes it: preliminary review "up to 10 business days", functional review "up to 10 weeks for new submissions and 6 weeks for published apps". This is the most consequential error in the sample, because the whole point of the product is "how long will I wait".
- **Wrong:** review-triggering scopes `channels:history` and `users:read.email`. The page actually names `identity.*`, `workflow.steps:execute`, `read`, `post`, `client`, `admin.*`, `search:read`, `triggers:*`. Both wrong scopes were already labeled "Inferred" (verifier: unsupported).

### Google Workspace (self-serve + review)
Sources: [sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

- Correct: unlisted YouTube demo video required; privacy policy required; CASA security assessment repeats at least every 12 months; review only for sensitive/restricted scopes on external apps.
- **Imprecise:** wait "3–28 days". Google publishes two separate timelines: sensitive scopes "up to 10 days", restricted scopes "several weeks" (plus the CASA assessment). The guide merged them into one range and, after the verifier rejected the number, showed it as unpublished.
- Source quality issue: claims cited `?hl=fa` and `?hl=ar` (Persian and Arabic) versions of Google's docs. The content matches, but a developer would not want those links.
- Could not verify: the 100-test-user cap (not on these pages; it is in Google Cloud console help); exact restricted scope strings (the guide wrote "Gmail scopes (e.g., …)" instead of exact strings; Google keeps the list in a separate FAQ).

### LinkedIn (self-serve + review)
Source: [3-legged OAuth flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow).

- Correct: access tokens last 60 days; authorization codes last 30 minutes; authorize/token endpoints; scopes depend on which Products you apply for and are approved for ("You can apply for new Products under the Products tab. If approved…").
- Could not verify: "app must be linked to a verified Company Page". Not on the cited page (verifier correctly downgraded it to Inferred). I believe it is true from the developer portal, but did not confirm it in this pass.
- **Missing, and important for agents:** "Programmatic refresh tokens are available for a limited set of partners." For most apps, users must re-authorize every 60 days. An agent that runs unattended will silently lose access.
- Open question: whether LinkedIn should be rated "gated partner". Sign In with LinkedIn and Share are self-serve; most data APIs (Marketing, Community Management) need a product application. The guide's "self-serve + review" is defensible but undersells how gated the useful APIs are.

### Shopify (self-serve + review)
Source: [submit app for review](https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review).

- Correct: App Store apps must subscribe to compliance webhooks; protected customer data needs a separate request (and "isn't possible while the app is under review"); wait time honestly shown as community-reported and not published (the page states no timeline).
- **Mis-sourced:** the `read_all_orders` scope claim cites **apideck.com**, a third-party blog, but was labeled "From docs". The model labeled the blog "official", and the pipeline trusted the label.
- Could not verify: privacy policy and terms-of-service requirements (not on the cited page; likely on the App Store requirements page).

## Root causes and fixes

| # | Problem found | Root cause | Fix (pipeline v0.2.0) |
|---|---|---|---|
| 1 | Slack's published review timeline reported as "not published" | Research did not quote durations; extraction had no rule forcing it to use them | Research prompt now asks for review durations to be quoted verbatim per review stage. Extraction must use any quoted official duration. New coverage check: if the notes mention a duration and `wait_days` is empty, a revision pass runs. |
| 2 | Wrong or vague scope names (Slack, Google) | Model listed scopes that "sound sensitive", and categories ("Gmail scopes (e.g. …)") | Prompts require exact scope strings that a source says trigger review, one per row. Coverage check flags category-style rows. |
| 3 | Blog labeled as official docs (Shopify) | Source type came from the model's label | "Official" is now decided in code by domain (the provider's website/console/docs hosts). A claim backed only by non-official sources cannot be "From docs"; it becomes "Inferred". |
| 4 | Persian/Arabic doc links (Google) | Search results carried `?hl=` locale params | `hl` is stripped from every searched/fetched URL. |
| 5 | Conditional requirement shown as universal (GitHub paid Marketplace) | Verifier checks that the source states a claim, not that the condition matches | Extraction prompt: conditional requirements must state the condition in `applies_when`. (Verifier still checks content, not conditions; see limitations.) |
| 6 | Important refresh-token limits missing (LinkedIn, GitHub) | Research prompt did not ask about refresh-token availability | Research prompt now asks whether refresh tokens are available to everyone or only partners. |
| 7 | Published timeline flag survived a verifier downgrade (Google) | Flag set at assembly, before verification | Render stage re-checks: a timeline is "published" only while its claim is still sourced from official docs. |
| 8 | "Cal" instead of "Cal.com" (M5) | Name taken from the first label of the domain | Short brand names keep the full host. |

Fixes 1–2 and 5–6 are prompt changes; 3, 4, 7 and 8 are enforced in code.

## Re-run after the fixes

I re-ran the two guides with the largest errors on pipeline v0.2.0, with the same free-tier model (`gemini-3.5-flash-lite`). The other three keep their v0.1.0 content; the code-level fixes (URL cleanup, published-timeline check) were re-applied to all six without model calls (`scripts/rerender.ts`).

**Slack: fixed.**

| | Before (v0.1.0) | After (v0.2.0) |
|---|---|---|
| Wait | "Not published" (Inferred) | **14–84 days, published** (From docs, verified): "up to 10 business days for preliminary review and up to 10 weeks for functional review" |
| Review-triggering scopes | `channels:history`, `users:read.email` (both wrong, Inferred) | `admin.*`, `identity.*`, `search:read`, `workflow.steps:execute`, `triggers:*` (all match the review guide, From docs) |
| Claims | 4 tested · 15 docs · 6 inferred (4 downgraded) | 4 tested · 25 docs · 2 inferred (1 downgraded) |

Remaining error: the max is 84 days, but "up to 10 weeks" is 70. The model applied the business-day conversion factor to weeks. The cited quote is correct, the arithmetic is not.

**Google Workspace: partly fixed.**

| | Before (v0.1.0) | After (v0.2.0) |
|---|---|---|
| Scopes | "Gmail scopes (e.g., …)", "Google Drive scopes (e.g., …)" | None listed. The sources read did not name exact strings, so the guide no longer invents them. Honest, but less useful; the real list is in Google's verification FAQ, which research did not reach. |
| Wait | 3–28 days, not published (Inferred) | 3–42 days, cited to Google's consent-screen page (verifier: *partially supported*: "several weeks or longer", no exact range). Still merges the sensitive (≤10 days) and restricted (several weeks) timelines. |
| Third-party sources | none flagged | A Nylas guide is now correctly typed as non-official, and the CASA blocker it backed is shown as Inferred |
| Locale links | 5 `?hl=` links (Persian, Arabic) | 0 in sources and claims. Google still geo-redirected fetches to `?hl=pt-br`/`zh-tw`; fixed by sending `Accept-Language: en` and normalizing at render |
| Claims | 5 tested · 19 docs · 3 inferred | 4 tested · 15 docs · 5 inferred |

Also found during the re-run: the sign-in-wall detector matched "auth" inside `/oauth2/` paths and flagged ordinary Google doc pages as "appears to require sign-in". Fixed to match whole path segments only.

New claim not checked by hand: "Enabling billing on the Google Cloud project" as a paid-tier blocker (verifier: supported by the consent-screen page). I did not confirm whether it applies to all apps or only Marketplace publishing.

**Not re-run:** GitHub, LinkedIn and Shopify. The free-tier quota ran out before my deadline. Their known errors (GitHub's paid-only Marketplace condition, LinkedIn's missing refresh-token limit, Shopify's blog-sourced scope) are addressed by the fixes above but not yet confirmed by a re-run. Under the new domain rule, Shopify's apideck.com citation can no longer count as "From docs".

## What this evaluation does not cover

- **Only what is public.** Consoles, review forms and approval emails are behind sign-in. Statements like "review takes up to 10 weeks" are what providers publish, not what we measured.
- **Sample, not census.** 31 claims across 5 guides. Technical claims marked "Tested" were checked by the pipeline's own probes and not re-checked here.
- **The verifier checks content, not conditions.** It confirmed GitHub's "200 users" number while missing that it only applies to paid listings. Catching scope-of-applicability errors would need a second verifier question ("does the source limit when this applies?").
- **Free-tier model.** All guides were generated with `gemini-3.5-flash-lite` because the main free-tier models hit their 20-requests/day quota. Extraction quality (dropped facts) is the weakest stage and would likely improve with a stronger model.
