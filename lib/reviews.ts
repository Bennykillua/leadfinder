import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reviewCache } from "@/lib/db/schema";
import type { Review, ReviewSample } from "@/lib/leads";
import { logCall, SerpApiError, stripKeys } from "@/lib/serpapi";

// "Read reviews": SerpApi google_maps_reviews, one call (1 credit), cached 7 days.
// One call returns 8 reviews in one sort order, so we ask for the lowest-rated
// (complaints are what make a pitch) and show them newest first, with dates.
// Reviewer names are never kept: public business information only.

const ENDPOINT = "https://serpapi.com/search.json";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const SORT = "ratingLow";
const MAX_TEXT = 600;

type RawReview = {
  rating?: number;
  date?: string;
  iso_date?: string;
  snippet?: string;
  extracted_snippet?: { original?: string };
};
type ReviewsResponse = { error?: string; reviews?: RawReview[] };

function parse(json: ReviewsResponse): Review[] {
  return (json.reviews ?? [])
    .map((r) => ({
      rating: typeof r.rating === "number" ? r.rating : 0,
      date: r.date ?? "",
      isoDate: r.iso_date ?? null,
      text: (r.extracted_snippet?.original ?? r.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT),
    }))
    .filter((r) => r.text.length > 0 && r.rating > 0)
    .sort((a, b) => (b.isoDate ?? "").localeCompare(a.isoDate ?? ""))
    .map((r, i) => ({ id: `review:${i + 1}`, ...r }));
}

const inFlight = new Map<string, Promise<{ sample: ReviewSample; source: "live" | "cache" }>>();

export function fetchReviews(placeId: string, userId: string) {
  const running = inFlight.get(placeId);
  if (running) return running;
  const p = load(placeId, userId).finally(() => inFlight.delete(placeId));
  inFlight.set(placeId, p);
  return p;
}

async function load(placeId: string, userId: string): Promise<{ sample: ReviewSample; source: "live" | "cache" }> {
  const cached = await db.query.reviewCache.findFirst({ where: eq(reviewCache.placeId, placeId) });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_MS) {
    return {
      sample: { fetchedAt: cached.fetchedAt.toISOString(), sort: SORT, items: parse(cached.response as ReviewsResponse) },
      source: "cache",
    };
  }
  if (process.env.SERPAPI_FIXTURES === "1") {
    throw new SerpApiError("Reviews aren't available in fixtures mode (SERPAPI_FIXTURES=1): they'd use a credit.");
  }
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new SerpApiError("SERPAPI_API_KEY is missing from .env.local.");

  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    engine: "google_maps_reviews",
    place_id: placeId,
    sort_by: SORT,
    hl: "en",
    api_key: apiKey,
  }).toString();

  let json: ReviewsResponse;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    json = (await res.json()) as ReviewsResponse;
    if (!res.ok && !json.error) json = { error: `SerpApi returned HTTP ${res.status}` };
  } catch (err) {
    await logCall(userId, placeId, false, "google_maps_reviews");
    throw new SerpApiError(`Couldn't reach SerpApi: ${err instanceof Error ? err.message : String(err)}`);
  }
  await logCall(userId, placeId, !json.error, "google_maps_reviews");
  if (json.error && !/hasn't returned any results/i.test(json.error)) throw new SerpApiError(json.error);

  // Keep only what we use; never store reviewer names or profile links.
  const stored = stripKeys({
    reviews: (json.reviews ?? []).map(({ rating, date, iso_date, snippet, extracted_snippet }) => ({
      rating,
      date,
      iso_date,
      snippet,
      extracted_snippet: extracted_snippet?.original ? { original: extracted_snippet.original } : undefined,
    })),
  });
  const fetchedAt = new Date();
  await db
    .insert(reviewCache)
    .values({ placeId, response: stored, fetchedAt })
    .onConflictDoUpdate({ target: reviewCache.placeId, set: { response: stored, fetchedAt } });
  return { sample: { fetchedAt: fetchedAt.toISOString(), sort: SORT, items: parse(stored as ReviewsResponse) }, source: "live" };
}
