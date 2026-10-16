import "server-only";
import { siteKey } from "./crawl";

// Google PageSpeed Insights (Google runs Lighthouse for us; Chrome never runs on our
// server). Optional: PAGESPEED_API_KEY raises the quota, but without it the API is
// called keyless. Any failure (quota, rate limit, timeout, a site Lighthouse can't
// load) comes back as { ok: false, reason } and the audit carries on: this never
// throws.

const API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
// How long an audit waits for PageSpeed. The request keeps going in the background
// up to REQUEST_MS, so a slow result still lands in the cache for the next audit.
const WAIT_MS = 20_000;
const REQUEST_MS = 60_000;
const CACHE_MS = 24 * 60 * 60 * 1000;
// After a 429 or quota error, don't call again for a while.
const COOLDOWN_MS = 10 * 60 * 1000;

export type PageSpeed =
  | { ok: true; performance: number; accessibility: number; seo: number }
  | { ok: false; reason: string };

// In memory: one instance on Render, and a restart only costs a re-check.
const cache = new Map<string, { result: PageSpeed & { ok: true }; at: number }>();
const inFlight = new Map<string, Promise<PageSpeed>>();
let coolDownUntil = 0;

export function cachedPageSpeed(website: string): PageSpeed | null {
  const hit = cache.get(siteKey(website));
  return hit && Date.now() - hit.at < CACHE_MS ? hit.result : null;
}

async function request(website: string): Promise<PageSpeed> {
  const params = new URLSearchParams({ url: website, strategy: "mobile" });
  for (const c of ["performance", "accessibility", "seo"]) params.append("category", c);
  const key = process.env.PAGESPEED_API_KEY?.trim();
  if (key) params.set("key", key);
  try {
    const res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(REQUEST_MS) });
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      lighthouseResult?: {
        runtimeError?: { code?: string; message?: string };
        categories?: Record<string, { score?: number | null }>;
      };
    };
    if (res.status === 429 || /quota/i.test(json.error?.message ?? "")) {
      coolDownUntil = Date.now() + COOLDOWN_MS;
      return { ok: false, reason: key ? "PageSpeed quota used up for now" : "PageSpeed's free (keyless) quota is used up for now" };
    }
    if (!res.ok) return { ok: false, reason: `PageSpeed couldn't test the site (HTTP ${res.status})` };
    const lr = json.lighthouseResult;
    if (lr?.runtimeError?.code && lr.runtimeError.code !== "NO_ERROR") {
      return { ok: false, reason: `PageSpeed couldn't load the site (${lr.runtimeError.code})` };
    }
    const score = (c: string) => {
      const s = lr?.categories?.[c]?.score;
      return typeof s === "number" ? Math.round(s * 100) : null;
    };
    const performance = score("performance");
    const accessibility = score("accessibility");
    const seo = score("seo");
    if (performance === null || accessibility === null || seo === null) {
      return { ok: false, reason: "PageSpeed returned no scores" };
    }
    const result = { ok: true as const, performance, accessibility, seo };
    cache.set(siteKey(website), { result, at: Date.now() });
    return result;
  } catch (err) {
    const timeout = (err as { name?: string })?.name === "TimeoutError";
    return { ok: false, reason: timeout ? "PageSpeed took too long" : "Couldn't reach PageSpeed" };
  }
}

export async function pageSpeed(website: string, opts: { force?: boolean } = {}): Promise<PageSpeed> {
  try {
    if (!opts.force) {
      const hit = cachedPageSpeed(website);
      if (hit) return hit;
    }
    if (Date.now() < coolDownUntil) {
      return { ok: false, reason: "PageSpeed's quota is used up for now" };
    }
    const k = siteKey(website);
    let p = inFlight.get(k);
    if (!p) {
      p = request(website).finally(() => inFlight.delete(k));
      inFlight.set(k, p);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<PageSpeed>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: "PageSpeed took too long (it'll be ready on Re-run audit)" }), WAIT_MS);
    });
    return await Promise.race([p, waited]).finally(() => clearTimeout(timer));
  } catch {
    return { ok: false, reason: "PageSpeed check failed" };
  }
}
