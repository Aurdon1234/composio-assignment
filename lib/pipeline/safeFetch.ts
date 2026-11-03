import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF-guarded fetch for probes and verification.
 * - https only, GET/HEAD only, no cookies or credentials
 * - every hop's hostname must resolve to a public IP
 * - manual redirects (max 4), each re-checked
 * - timeout and response size cap
 */

const UA = "oauth-guide-probe/1.0 (read-only research bot; no account creation)";
const MAX_BYTES = 3_000_000;

export type SafeResponse = {
  ok: boolean;
  status: number | null;
  finalUrl: string;
  contentType: string | null;
  body: string;
  redirects: string[];
  error?: string;
};

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublicHttps(u: URL) {
  if (u.protocol !== "https:") throw new Error(`blocked: non-https URL ${u}`);
  if (u.username || u.password) throw new Error("blocked: credentials in URL");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`blocked: internal hostname ${host}`);
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error(`blocked: ${host} resolves to private IP`);
}

export async function safeFetch(
  rawUrl: string,
  opts: {
    method?: "GET" | "HEAD" | "POST";
    /** POST is only used for the unauthenticated token-endpoint probe (form body, no credentials). */
    formBody?: Record<string, string>;
    timeoutMs?: number;
    accept?: string;
  } = {},
): Promise<SafeResponse> {
  const redirects: string[] = [];
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, status: null, finalUrl: rawUrl, contentType: null, body: "", redirects, error: "invalid URL" };
  }

  for (let hop = 0; hop <= 4; hop++) {
    try {
      await assertPublicHttps(url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        redirect: "manual",
        signal: ctrl.signal,
        credentials: "omit",
        headers: {
          "user-agent": UA,
          accept: opts.accept ?? "*/*",
          ...(opts.formBody ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body: opts.method === "POST" && opts.formBody ? new URLSearchParams(opts.formBody).toString() : undefined,
      }).finally(() => clearTimeout(timer));

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, url);
        redirects.push(next.toString());
        url = next;
        continue;
      }

      let body = "";
      if (opts.method !== "HEAD" && res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_BYTES) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
        body = new TextDecoder().decode(Buffer.concat(chunks));
      }
      return {
        ok: res.ok,
        status: res.status,
        finalUrl: url.toString(),
        contentType: res.headers.get("content-type"),
        body,
        redirects,
      };
    } catch (e) {
      return {
        ok: false,
        status: null,
        finalUrl: url.toString(),
        contentType: null,
        body: "",
        redirects,
        error: e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e),
      };
    }
  }
  return { ok: false, status: null, finalUrl: url.toString(), contentType: null, body: "", redirects, error: "too many redirects" };
}

/** Crude HTML -> text for verification context. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
