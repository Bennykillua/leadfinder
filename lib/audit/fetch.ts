import "server-only";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import robotsParser from "robots-parser";

// Polite, safe fetching for the website audit.
// - 10-second timeout per request, capped body size.
// - Only public http(s) addresses on default ports: user-typed URLs must never reach
//   localhost, the LAN, or the droplet's cloud metadata service.
// - Redirects are followed by hand so every hop is checked.
// - robots.txt is honoured for our user agent.

export const USER_AGENT = "Mozilla/5.0 (compatible; LeadFinderBot/0.1; website audit for local businesses)";
export const BOT_TOKEN = "LeadFinderBot";
export const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

function isPublicAddress(address: string) {
  const v4mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (v4mapped) return !blocked.check(v4mapped, "ipv4");
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) return !blocked.check(address, "ipv6");
  return false;
}

export class FetchProblem extends Error {
  constructor(
    message: string,
    readonly kind: "blocked-address" | "network" | "tls" | "timeout" | "too-many-redirects",
  ) {
    super(message);
  }
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchProblem(`Not a web address (${url.protocol})`, "blocked-address");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new FetchProblem("Only standard web ports are checked", "blocked-address");
  }
  if (url.username || url.password) throw new FetchProblem("Address has credentials in it", "blocked-address");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new FetchProblem("That address isn't a public website", "blocked-address");
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchProblem("That address isn't a public website", "blocked-address");
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new FetchProblem("Domain doesn't resolve (DNS lookup failed)", "network");
  }
  if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
    throw new FetchProblem("That address isn't a public website", "blocked-address");
  }
}

const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_NOT_YET_VALID",
]);

function describe(err: unknown): FetchProblem {
  if (err instanceof FetchProblem) return err;
  const e = err as { name?: string; cause?: { code?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return new FetchProblem(`No response within ${TIMEOUT_MS / 1000}s`, "timeout");
  }
  const code = e?.cause?.code;
  if (code && TLS_CODES.has(code)) {
    const what = code === "CERT_HAS_EXPIRED" ? "expired" : code.includes("SELF_SIGNED") ? "self-signed" : "invalid";
    return new FetchProblem(`SSL certificate is ${what}`, "tls");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new FetchProblem("Domain doesn't resolve (DNS lookup failed)", "network");
  if (code === "ECONNREFUSED") return new FetchProblem("Connection refused", "network");
  if (code === "ECONNRESET") return new FetchProblem("Connection was reset", "network");
  return new FetchProblem(code ? `Couldn't connect (${code})` : "Couldn't connect", "network");
}

export type Page = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
  ms: number;
};

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const charset = res.headers.get("content-type")?.match(/charset=([\w-]+)/i)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(Buffer.concat(chunks));
}

// One page: one request (plus any redirects it answers with). Time covers the whole load.
export async function fetchPage(rawUrl: string, opts: { readBody?: boolean } = {}): Promise<Page> {
  const started = performance.now();
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  let url = new URL(rawUrl);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(url);
      const res = await fetch(url, {
        redirect: "manual",
        signal: deadline,
        cache: "no-store",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", "accept-language": "en" },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        url = new URL(location, url);
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      const wantBody = opts.readBody !== false && (contentType.includes("html") || contentType.includes("text/plain") || !contentType);
      const html = wantBody ? await readCapped(res) : (await res.body?.cancel().catch(() => {}), "");
      return {
        requestedUrl: rawUrl,
        finalUrl: url.toString(),
        status: res.status,
        contentType,
        html,
        ms: Math.round(performance.now() - started),
      };
    }
  } catch (err) {
    throw describe(err);
  }
  throw new FetchProblem("Too many redirects", "too-many-redirects");
}

// --- robots.txt ---

export type RobotsVerdict = { allowed: (url: string) => boolean; note: string | null };

const robotsCache = new Map<string, { at: number; verdict: RobotsVerdict }>();
const ROBOTS_TTL_MS = 60 * 60 * 1000;

// RFC 9309: 4xx = no rules (allowed); 5xx = assume everything is disallowed.
// A network failure is thrown so the caller can report the site as unreachable
// instead of spending another request on the homepage.
export async function robotsFor(origin: string): Promise<RobotsVerdict> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < ROBOTS_TTL_MS) return hit.verdict;
  const robotsUrl = `${origin}/robots.txt`;
  const page = await fetchPage(robotsUrl);
  let verdict: RobotsVerdict;
  if (page.status >= 500) {
    verdict = { allowed: () => false, note: `robots.txt returned HTTP ${page.status}, so the site wasn't crawled` };
  } else if (page.status >= 400 || !page.html.trim()) {
    verdict = { allowed: () => true, note: null };
  } else {
    const robots = robotsParser(robotsUrl, page.html);
    verdict = {
      allowed: (url) => {
        try {
          return robots.isAllowed(url, BOT_TOKEN) !== false;
        } catch {
          return true;
        }
      },
      note: null,
    };
  }
  robotsCache.set(origin, { at: Date.now(), verdict });
  return verdict;
}
