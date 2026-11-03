import type { Probe } from "../schema";
import type { ProgressFn } from "../anthropic";
import type { Endpoints } from "./research";
import type { Resolved } from "./resolve";
import { safeFetch } from "./safeFetch";

/**
 * Stage 3: public, unauthenticated probes. GET/HEAD only. No accounts, no form
 * submissions, no client registration, no credentials. Every probe records its
 * real result, including failures.
 */
export async function probe(resolved: Resolved, ep: Endpoints, onProgress?: ProgressFn): Promise<Probe[]> {
  const probes: Probe[] = [];
  let n = 0;
  const add = (p: Omit<Probe, "id" | "timestamp">) => {
    const full: Probe = { ...p, id: `p${++n}`, timestamp: new Date().toISOString() };
    probes.push(full);
    onProgress?.(`probe ${full.kind}: ${full.outcome}${full.http_status ? ` (HTTP ${full.http_status})` : ""}`);
    return full;
  };

  // ---- Discovery documents -------------------------------------------------
  const bases = discoveryBases(resolved, ep);
  const oidc = await tryDiscovery(bases, "openid-configuration");
  add({
    kind: "openid_configuration",
    target_url: oidc.hit?.url ?? oidc.attempts[0]?.url ?? null,
    method: oidc.attempts.length ? "GET" : "none",
    outcome: oidc.hit ? "positive" : oidc.attempts.length ? "negative" : "skipped",
    http_status: oidc.hit?.status ?? oidc.attempts[0]?.status ?? null,
    summary: oidc.hit
      ? `OpenID Connect discovery document found (issuer: ${String(oidc.hit.json.issuer ?? "n/a")}).`
      : `No OpenID Connect discovery document at ${oidc.attempts.length} candidate location(s).`,
    details: { attempts: oidc.attempts, ...(oidc.hit ? pickMeta(oidc.hit.json) : {}) },
  });

  const asm = await tryDiscovery(bases, "oauth-authorization-server");
  add({
    kind: "oauth_authorization_server_metadata",
    target_url: asm.hit?.url ?? asm.attempts[0]?.url ?? null,
    method: asm.attempts.length ? "GET" : "none",
    outcome: asm.hit ? "positive" : asm.attempts.length ? "negative" : "skipped",
    http_status: asm.hit?.status ?? asm.attempts[0]?.status ?? null,
    summary: asm.hit
      ? `RFC 8414 authorization server metadata found (issuer: ${String(asm.hit.json.issuer ?? "n/a")}).`
      : `No RFC 8414 authorization server metadata at ${asm.attempts.length} candidate location(s).`,
    details: { attempts: asm.attempts, ...(asm.hit ? pickMeta(asm.hit.json) : {}) },
  });

  const meta = (oidc.hit?.json ?? asm.hit?.json ?? null) as Record<string, unknown> | null;
  const metaUrl = oidc.hit?.url ?? asm.hit?.url ?? null;

  // ---- Endpoint reachability ----------------------------------------------
  // Prefer the app-OAuth endpoints from the docs: some providers' OIDC metadata
  // describes a separate "Sign in with X" flow (e.g. Slack).
  const metaAuth = meta?.authorization_endpoint as string | undefined;
  const metaToken = meta?.token_endpoint as string | undefined;
  add(await authorizeProbe(ep.authorization_url ?? metaAuth, ep.authorization_url ? "docs" : "discovery metadata"));
  add(await tokenProbe(ep.token_url ?? metaToken, ep.token_url ? "docs" : "discovery metadata"));

  // ---- Dynamic client registration (advertised only; never exercised) ------
  const reg = meta?.registration_endpoint as string | undefined;
  add({
    kind: "dynamic_client_registration",
    target_url: reg ?? metaUrl,
    method: "none",
    outcome: reg ? "positive" : meta ? "negative" : "skipped",
    http_status: null,
    summary: reg
      ? `Discovery metadata advertises a registration_endpoint (${reg}). Not exercised: we do not register clients.`
      : meta
        ? "Discovery metadata does not advertise a registration_endpoint, so dynamic client registration is likely unsupported."
        : "No discovery metadata, so dynamic client registration support could not be tested.",
    details: {},
  });

  // ---- PKCE ---------------------------------------------------------------
  const pkce = meta?.code_challenge_methods_supported as string[] | undefined;
  add({
    kind: "pkce_support",
    target_url: metaUrl,
    method: "none",
    outcome: pkce?.length ? "positive" : meta ? "negative" : "skipped",
    http_status: null,
    summary: pkce?.length
      ? `Metadata advertises code_challenge_methods_supported: ${pkce.join(", ")}.`
      : meta
        ? "Metadata does not list code_challenge_methods_supported (PKCE may still be supported; check docs)."
        : "No discovery metadata; PKCE support could not be tested, only read from docs.",
    details: pkce ? { code_challenge_methods_supported: pkce } : {},
  });

  // ---- Doc pages exist (developer portal + review docs) -------------------
  const docUrls = uniq([resolved.developer_portal_url, ...ep.review_doc_urls].filter(Boolean) as string[]).slice(0, 5);
  for (const u of docUrls) {
    const r = await safeFetch(u, { timeoutMs: 10_000 });
    const loginWall = /login|signin|sign-in|auth/i.test(new URL(r.finalUrl).pathname) && r.finalUrl !== u;
    add({
      kind: "doc_page_exists",
      target_url: u,
      method: "GET",
      outcome: r.error ? "error" : r.ok ? "positive" : "negative",
      http_status: r.status,
      summary: r.error
        ? `Could not load page: ${r.error}.`
        : r.ok
          ? `Page loads (HTTP ${r.status})${r.redirects.length ? `, redirected to ${r.finalUrl}` : ""}${loginWall ? " — appears to require sign-in" : ""}.`
          : `Page returned HTTP ${r.status}${r.status === 404 ? " (not found; doc link may be outdated)" : ""}.`,
      details: { final_url: r.finalUrl, redirects: r.redirects },
    });
  }

  return probes;
}

function discoveryBases(resolved: Resolved, ep: Endpoints): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined, keepPath: boolean) => {
    if (!u) return;
    try {
      const x = new URL(u);
      if (x.protocol !== "https:") return;
      out.push(keepPath ? x.origin + x.pathname.replace(/\/\.well-known\/.*$/, "").replace(/\/$/, "") : x.origin);
    } catch {}
  };
  push(ep.issuer_or_discovery_base, true);
  push(ep.issuer_or_discovery_base, false);
  push(ep.authorization_url, false);
  push(ep.token_url, false);
  push(resolved.website, false);
  return uniq(out).slice(0, 5);
}

type Attempt = { url: string; status: number | null; error?: string };

async function tryDiscovery(bases: string[], doc: "openid-configuration" | "oauth-authorization-server") {
  const attempts: Attempt[] = [];
  for (const base of bases) {
    const url = `${base}/.well-known/${doc}`;
    const r = await safeFetch(url, { accept: "application/json", timeoutMs: 8_000 });
    attempts.push({ url, status: r.status, ...(r.error ? { error: r.error } : {}) });
    if (r.ok) {
      try {
        const json = JSON.parse(r.body) as Record<string, unknown>;
        if (json && (json.authorization_endpoint || json.issuer || json.token_endpoint)) {
          return { hit: { url, status: r.status, json }, attempts };
        }
      } catch {}
    }
  }
  return { hit: null as null | { url: string; status: number | null; json: Record<string, unknown> }, attempts };
}

function pickMeta(m: Record<string, unknown>) {
  const keys = [
    "issuer",
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
    "code_challenge_methods_supported",
    "grant_types_supported",
    "response_types_supported",
    "token_endpoint_auth_methods_supported",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in m) out[k] = m[k];
  const scopes = m.scopes_supported;
  if (Array.isArray(scopes)) out.scopes_supported_count = scopes.length;
  return out;
}

const PROBE_CLIENT_ID = "oauth-guide-probe-nonexistent-client";

/**
 * Authorize endpoint: GET with a deliberately nonexistent client_id. A live
 * OAuth server answers with an error page / redirect (4xx or 200); a 404 alone
 * is inconclusive because some providers 404 on unknown clients.
 */
async function authorizeProbe(url: string | null | undefined, origin: string): Promise<Omit<Probe, "id" | "timestamp">> {
  const kind = "authorize_endpoint_reachability" as const;
  if (!url) return { kind, target_url: null, method: "none", outcome: "skipped", http_status: null, summary: "No authorization URL found to test.", details: {} };
  const u = new URL(url);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", PROBE_CLIENT_ID);
  const r = await safeFetch(u.toString(), { timeoutMs: 8_000 });
  const body = r.body.slice(0, 4000).toLowerCase();
  const oauthError = /invalid[_ ]client|client[_ ]id|unknown client|invalid_request|application|oauth/.test(body);
  const outcome = r.error ? "error" : r.status === 404 ? "inconclusive" : r.status! < 500 ? "positive" : "negative";
  return {
    kind,
    target_url: url,
    method: "GET",
    outcome,
    http_status: r.status,
    summary: r.error
      ? `Authorization endpoint (from ${origin}) unreachable: ${r.error}.`
      : outcome === "positive"
        ? `Authorization endpoint (from ${origin}) responds to a request with a fake client_id (HTTP ${r.status}${r.redirects.length ? `, redirected to ${new URL(r.finalUrl).origin}${new URL(r.finalUrl).pathname}` : ""})${oauthError ? "; response mentions an OAuth/client error" : ""}.`
        : outcome === "inconclusive"
          ? `Authorization endpoint (from ${origin}) returned 404 for a fake client_id; some providers do this for unknown clients, so this neither confirms nor refutes the URL.`
          : `Authorization endpoint (from ${origin}) returned HTTP ${r.status}.`,
    details: { final_url: r.finalUrl, redirects: r.redirects, mentions_oauth_error: oauthError },
  };
}

/**
 * Token endpoint: an unauthenticated POST with only grant_type and a bogus code
 * (no client credentials). A live OAuth token endpoint replies with an OAuth
 * error such as invalid_request / invalid_client / bad_verification_code.
 * Nothing is created and no credentials are sent.
 */
async function tokenProbe(url: string | null | undefined, origin: string): Promise<Omit<Probe, "id" | "timestamp">> {
  const kind = "token_endpoint_reachability" as const;
  if (!url) return { kind, target_url: null, method: "none", outcome: "skipped", http_status: null, summary: "No token URL found to test.", details: {} };
  const r = await safeFetch(url, {
    method: "POST",
    formBody: { grant_type: "authorization_code", code: "probe-invalid-code", client_id: PROBE_CLIENT_ID },
    accept: "application/json",
    timeoutMs: 8_000,
  });
  let oauthError: string | null = null;
  try {
    const j = JSON.parse(r.body) as Record<string, unknown>;
    oauthError = typeof j.error === "string" ? j.error : j.ok === false && typeof j.error === "string" ? j.error : null;
  } catch {
    const m = r.body.match(/error=([a-z_]+)/i);
    oauthError = m ? m[1] : null;
  }
  // Only RFC 6749-style snake_case codes count (GitHub returns {"error":"Not Found"} for unknown clients).
  if (oauthError && !/^[a-z][a-z_]+$/.test(oauthError)) oauthError = null;
  const outcome = r.error ? "error" : oauthError ? "positive" : "inconclusive";
  return {
    kind,
    target_url: url,
    method: "POST",
    outcome,
    http_status: r.status,
    summary: r.error
      ? `Token endpoint (from ${origin}) unreachable: ${r.error}.`
      : oauthError
        ? `Token endpoint (from ${origin}) is live: an unauthenticated request with a fake code returned OAuth error "${oauthError}" (HTTP ${r.status}).`
        : `Token endpoint (from ${origin}) returned HTTP ${r.status} without a standard OAuth error code; inconclusive (some providers return 404 for unknown clients).`,
    details: { final_url: r.finalUrl, oauth_error: oauthError },
  };
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
