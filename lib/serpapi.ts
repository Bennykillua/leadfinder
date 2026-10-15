import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { count, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { serpCache, serpUsage } from "@/lib/db/schema";
import { NG_MOBILE, normalisePhone, slug, type Business } from "@/lib/leads";

// SerpApi Google Maps search, following the free-plan quota rule in SPEC.md:
// one call per search, first page only, no paging, 24-hour cache, every call counted.

const ENDPOINT = "https://serpapi.com/search.json";
const ACCOUNT_ENDPOINT = "https://serpapi.com/account.json";
const CACHE_MS = 24 * 60 * 60 * 1000;
// Centre of Lagos, so "salons in Yaba" means Yaba, Lagos.
const LAGOS_LL = "@6.5244,3.3792,11z";
const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "serpapi");
const FIXTURES_TO_KEEP = 2;

export type SearchSource = "live" | "cache" | "fixture";

export type SearchResult = {
  query: string;
  results: Business[];
  source: SearchSource;
  fetchedAt: string;
};

export class SerpApiError extends Error {}

export function queryKey(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

// --- Response → Business ---

type LocalResult = {
  place_id?: string;
  data_id?: string;
  title?: string;
  type?: string;
  types?: string[];
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
};

type MapsResponse = {
  error?: string;
  local_results?: LocalResult[];
  // A query that matches one exact place returns this instead of a list.
  place_results?: LocalResult;
};

function toBusiness(r: LocalResult): Business | null {
  if (!r.title) return null;
  const phone = r.phone?.trim() ?? "";
  // Until the website crawl (step 5) can confirm a wa.me link, a Nigerian
  // mobile number is "likely WhatsApp" and anything else is call-only.
  const whatsapp = phone && NG_MOBILE.test(normalisePhone(phone)) ? "likely" : "call";
  return {
    id: r.place_id ?? r.data_id ?? slug(`${r.title} ${r.address ?? ""}`),
    name: r.title,
    category: r.type ?? r.types?.[0] ?? "",
    area: r.address ?? "",
    phone,
    whatsapp,
    rating: r.rating ?? 0,
    reviews: r.reviews ?? 0,
    website: r.website ?? null,
    email: null,
    score: null,
    topReason: "",
    evidence: [],
  };
}

export function parseMapsResponse(json: MapsResponse): Business[] {
  const raw = json.local_results ?? (json.place_results ? [json.place_results] : []);
  const seen = new Set<string>();
  return raw.flatMap((r) => {
    const b = toBusiness(r);
    if (!b || seen.has(b.id)) return [];
    seen.add(b.id);
    return [b];
  });
}

// --- Fixtures: the first real responses, saved so the UI can be tested for free ---

function stripKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== "api_key")
        .map(([k, v]) => [k, stripKeys(v)]),
    );
  }
  return value;
}

async function fixtureFiles() {
  try {
    return (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

async function maybeSaveFixture(query: string, json: unknown) {
  try {
    const files = await fixtureFiles();
    if (files.length >= FIXTURES_TO_KEEP) return;
    await mkdir(FIXTURES_DIR, { recursive: true });
    const name = `${String(files.length + 1).padStart(2, "0")}-${slug(query) || "query"}.json`;
    const body = { query, savedAt: new Date().toISOString(), response: stripKeys(json) };
    await writeFile(path.join(FIXTURES_DIR, name), JSON.stringify(body, null, 2) + "\n");
  } catch (err) {
    console.warn("[serpapi] couldn't save fixture:", err);
  }
}

async function searchFixtures(query: string): Promise<SearchResult> {
  const files = await fixtureFiles();
  if (files.length === 0) {
    throw new SerpApiError("SERPAPI_FIXTURES is on but fixtures/serpapi/ is empty. Run two real searches first.");
  }
  const wanted = slug(query);
  const file = files.find((f) => f.replace(/^\d+-/, "").replace(/\.json$/, "") === wanted) ?? files[0];
  const saved = JSON.parse(await readFile(path.join(FIXTURES_DIR, file), "utf8"));
  return {
    query: saved.query,
    results: parseMapsResponse(saved.response),
    source: "fixture",
    fetchedAt: saved.savedAt,
  };
}

// --- Search ---

async function logCall(userId: string, query: string, ok: boolean) {
  await db.insert(serpUsage).values({ userId, engine: "google_maps", query, ok });
}

// Identical searches already in flight share one call (e.g. a double Enter).
const inFlight = new Map<string, Promise<SearchResult>>();

export function searchGoogleMaps(rawQuery: string, userId: string): Promise<SearchResult> {
  const key = queryKey(rawQuery);
  const running = inFlight.get(key);
  if (running) return running;
  const p = search(rawQuery, key, userId).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function search(rawQuery: string, key: string, userId: string): Promise<SearchResult> {
  const query = rawQuery.trim().replace(/\s+/g, " ");

  if (process.env.SERPAPI_FIXTURES === "1") return searchFixtures(query);

  const cached = await db.query.serpCache.findFirst({ where: eq(serpCache.queryKey, key) });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_MS) {
    return {
      query,
      results: parseMapsResponse(cached.response as MapsResponse),
      source: "cache",
      fetchedAt: cached.fetchedAt.toISOString(),
    };
  }

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new SerpApiError("SERPAPI_API_KEY is missing from .env.local.");

  // One page only: no `start` parameter, and nothing here ever asks for page two.
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q: query,
    ll: LAGOS_LL,
    hl: "en",
    gl: "ng",
    api_key: apiKey,
  }).toString();

  let json: MapsResponse;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    json = (await res.json()) as MapsResponse;
    if (!res.ok && !json.error) json = { error: `SerpApi returned HTTP ${res.status}` };
  } catch (err) {
    await logCall(userId, query, false);
    throw new SerpApiError(`Couldn't reach SerpApi: ${err instanceof Error ? err.message : String(err)}`);
  }

  // "No results" comes back as an error string but is a normal, cacheable answer.
  const empty = json.error?.includes("hasn't returned any results");
  await logCall(userId, query, !json.error || !!empty);
  if (json.error && !empty) throw new SerpApiError(json.error);

  const stored = stripKeys(json);
  const fetchedAt = new Date();
  await db
    .insert(serpCache)
    .values({ queryKey: key, query, response: stored, fetchedAt })
    .onConflictDoUpdate({ target: serpCache.queryKey, set: { query, response: stored, fetchedAt } });
  if (!empty) await maybeSaveFixture(query, json);

  return { query, results: parseMapsResponse(json), source: "live", fetchedAt: fetchedAt.toISOString() };
}

// --- Usage counter ---

export type SerpUsage = {
  callsToday: number;
  callsThisMonth: number;
  // From SerpApi's Account API (free, doesn't use a search). Null if unavailable.
  planLeft: number | null;
  planPerMonth: number | null;
  fixtures: boolean;
};

let account: { at: number; left: number | null; perMonth: number | null } | null = null;
const ACCOUNT_TTL_MS = 60_000;

async function accountInfo(force: boolean) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) return { left: null, perMonth: null };
  if (!force && account && Date.now() - account.at < ACCOUNT_TTL_MS) return account;
  try {
    const res = await fetch(`${ACCOUNT_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const json = (await res.json()) as { plan_searches_left?: number; searches_per_month?: number };
    account = {
      at: Date.now(),
      left: typeof json.plan_searches_left === "number" ? json.plan_searches_left : null,
      perMonth: typeof json.searches_per_month === "number" ? json.searches_per_month : null,
    };
  } catch {
    account = { at: Date.now(), left: null, perMonth: null };
  }
  return account;
}

export async function getSerpUsage(opts: { refreshAccount?: boolean } = {}): Promise<SerpUsage> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const since = (d: Date) =>
    db
      .select({ n: count() })
      .from(serpUsage)
      .where(gte(serpUsage.at, d));
  const [[today], [month], acct] = await Promise.all([
    since(startOfDay),
    since(startOfMonth),
    accountInfo(!!opts.refreshAccount),
  ]);
  return {
    callsToday: today.n,
    callsThisMonth: month.n,
    planLeft: acct.left,
    planPerMonth: acct.perMonth,
    fixtures: process.env.SERPAPI_FIXTURES === "1",
  };
}
