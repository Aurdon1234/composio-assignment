/**
 * Run only the probe stage (no API key needed) to sanity-check endpoints.
 *   npx tsx scripts/probe-only.ts <website> <authorize_url> <token_url> [issuer]
 */
import { probe } from "../lib/pipeline/probe";

const [website, authorization_url, token_url, issuer] = process.argv.slice(2);
probe(
  {
    found: true,
    name: website,
    slug: "probe-test",
    query: website,
    website,
    developer_portal_url: null,
    oauth_docs_urls: [],
    notes: "",
    retrieved: new Map(),
  },
  { authorization_url, token_url, issuer_or_discovery_base: issuer ?? null, review_doc_urls: [] },
  (m) => console.log(m),
).then((ps) => console.log(JSON.stringify(ps, null, 2)));
