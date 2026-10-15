process.loadEnvFile(".env.local");
process.env.DATABASE_URL = process.argv[2];
process.env.SERPAPI_API_KEY = "stub-key";
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
let serpCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  if (u.hostname === "serpapi.com") {
    if (u.pathname === "/account.json") return new Response(JSON.stringify({ plan_searches_left: 200, searches_per_month: 250 }));
    serpCalls++;
    if (u.searchParams.get("engine") !== "google_maps_reviews" || u.searchParams.get("sort_by") !== "ratingLow") throw new Error("unexpected SerpApi call " + u);
    return new Response(JSON.stringify({ reviews: [
      { rating: 1, date: "2 weeks ago", iso_date: days(14), snippet: "Booked online but nobody confirmed. Called three times, no answer. Had to find another place at night.", user: { name: "Private Person" } },
      { rating: 2, date: "2 months ago", iso_date: days(60), snippet: "Nice apartment but the photos online don't match, the kitchen is much smaller." },
      { rating: 3, date: "5 months ago", iso_date: days(150), snippet: "Okay stay. Wifi was slow and check-in instructions were unclear." },
    ] }));
  }
  return realFetch(input, init);
}) as typeof fetch;

const { db } = await import("@/lib/db");
const { users, leads } = await import("@/lib/db/schema");
const { fetchReviews } = await import("@/lib/reviews");
const { deepRead } = await import("@/lib/llm/deep-read");
const { writePitch } = await import("@/lib/llm/pitch");
const { newLead, allEvidence } = await import("@/lib/leads");
const { upgradeEvidence } = await import("@/lib/audit/checks");
const { eq, like } = await import("drizzle-orm");
const [u] = await db.select().from(users);
const user = { id: u.id, name: u.name, email: u.email, offer: u.offer, offerDetail: u.offerDetail };
const [row] = await db.select().from(leads).where(like(leads.name, "CityScape%"));
let lead = { ...newLead({ id: row.id, name: row.name, category: row.category, area: row.area, phone: row.phone, whatsapp: row.whatsapp, rating: row.rating, reviews: row.reviews, website: row.website, email: row.email, whatsappPhone: row.whatsappPhone, country: row.country, phoneIntl: row.phoneIntl, score: row.score, topReason: row.topReason, evidence: upgradeEvidence(row.evidence), auditedAt: row.auditedAt?.toISOString() ?? null }) };

const a = await fetchReviews(lead.id, u.id);
const b = await fetchReviews(lead.id, u.id);
console.log(`reviews: ${a.sample.items.length} (${a.source}), again → ${b.source}; SerpApi calls: ${serpCalls}; reviewer name stored: ${JSON.stringify(a.sample).includes("Private Person")}`);
console.log("  order (newest first):", a.sample.items.map((r) => `${r.id}=${r.rating}★ ${r.date}`).join(", "));
lead = { ...lead, reviewSamples: a.sample };

let t = Date.now();
const ai = await deepRead(user, lead);
console.log(`\ndeep read (${user.offer}) ${((Date.now() - t) / 1000).toFixed(1)}s · score ${ai.score}\n  top: ${ai.topReason}`);
for (const f of ai.findings) console.log(`  [${f.id}] ${f.detail}\n        check: ${f.check}`);
for (const w of ai.timing) console.log(`  WHY NOW [${w.id}] ${w.detail}`);
lead = { ...lead, ai };

for (let i = 1; i <= 2; i++) {
  t = Date.now();
  try {
    const p = await writePitch(user, lead);
    console.log(`\npitch #${i} ${((Date.now() - t) / 1000).toFixed(1)}s · ${p.pitch.split(/\s+/).length} words · cites ${p.evidence.map((e) => e.id).join(", ")}\n  ${p.pitch}`);
  } catch (e) { console.log(`\npitch #${i} FAILED: ${(e as Error).message}`); }
}
console.log(`\nevidence available to the pitch: ${allEvidence(lead).length} items (${[...new Set(allEvidence(lead).map((e) => e.kind))].join(", ")})`);
const { llmCalls } = await import("@/lib/db/schema");
const { gt } = await import("drizzle-orm");
const calls = await db.select().from(llmCalls).where(gt(llmCalls.at, new Date(Date.now() - 600_000)));
for (const c of calls) console.log(`  llm ${c.promptType}: ok=${c.ok} json1st=${c.validFirstTry} checks1st=${c.groundedFirstTry} attempts=${c.attempts}${c.error ? " · " + c.error.slice(0, 150) : ""}`);
process.exit(0);
