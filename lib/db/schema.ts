import { foreignKey, index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Column, Evidence, ReviewSample, WhatsAppLabel } from "../leads";

// --- Users (email + password; sessions are signed JWT cookies, see lib/session.ts) ---

export const OFFERS = ["video", "websites", "social", "other"] as const;
export type Offer = (typeof OFFERS)[number];

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  // Stored lowercased. Nullable only because SQLite can't tighten it in place.
  email: text("email").unique(),
  // scrypt hash (lib/password.ts). Null for the old Google-created account until a
  // password is set with `npm run user:password`.
  passwordHash: text("password_hash"),
  // "What do you sell?" Null until the first-sign-in question is answered.
  offer: text("offer", { enum: OFFERS }),
  offerDetail: text("offer_detail").notNull().default(""),
  // Profile: who they do it for, 1–3 links to their work, and an optional rate in
  // their own words ("from ₦50k per video"). Pitches may cite these.
  niche: text("niche").notNull().default(""),
  portfolioLinks: text("portfolio_links", { mode: "json" }).$type<string[]>().notNull().default([]),
  rate: text("rate").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

// One row per signed-in browser. The JWT cookie carries the row id (jti); signing
// out deletes the row, so that token stops working immediately, everywhere.
export const sessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("session_user").on(t.userId)],
);

// --- App data: every row belongs to one user ---

// A lead is a saved business plus the user's work on it (status, pitch, reminder, notes).
// `id` is the business id, unique per user, so saving the same business twice is a no-op.
export const leads = sqliteTable(
  "lead",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    area: text("area").notNull(),
    phone: text("phone").notNull(),
    whatsapp: text("whatsapp").$type<WhatsAppLabel>().notNull(),
    rating: real("rating").notNull(),
    reviews: integer("reviews").notNull(),
    website: text("website"),
    email: text("email"),
    whatsappPhone: text("whatsapp_phone"),
    country: text("country"),
    phoneIntl: text("phone_intl"),
    // Null until audited.
    score: integer("score"),
    auditedAt: integer("audited_at", { mode: "timestamp_ms" }),
    topReason: text("top_reason").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<Evidence[]>().notNull(),
    status: text("status").$type<Column>().notNull().default("saved"),
    position: integer("position").notNull().default(0),
    pitch: text("pitch").notNull().default(""),
    // Gemma's deep read (step 6). Null until it has run; the rule-based score and
    // top reason above stay as the fallback.
    aiScore: integer("ai_score"),
    aiTopReason: text("ai_top_reason"),
    // string[] (older rows may hold { finding, source } objects; see rowToLead).
    aiFindings: text("ai_findings", { mode: "json" }).$type<unknown[]>(),
    aiTiming: text("ai_timing", { mode: "json" }).$type<Evidence[]>(),
    aiModel: text("ai_model"),
    // Not "reviews": that's the Google review count above.
    reviewSamples: text("review_samples", { mode: "json" }).$type<ReviewSample>(),
    // Snapshot of the evidence the current pitch draft cited.
    pitchEvidence: text("pitch_evidence", { mode: "json" }).$type<Evidence[]>(),
    aiAt: integer("ai_at", { mode: "timestamp_ms" }),
    reminderAt: integer("reminder_at", { mode: "timestamp_ms" }),
    reminderNote: text("reminder_note").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index("lead_user_reminder").on(t.userId, t.reminderAt)],
);

// Notes on a lead: as many as the user likes, newest first in the drawer.
export const notes = sqliteTable(
  "note",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leadId: text("lead_id").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.userId, t.leadId], foreignColumns: [leads.userId, leads.id] }).onDelete("cascade"),
    index("note_user_lead").on(t.userId, t.leadId),
  ],
);

// --- SerpApi quota ---

// Shared across users on purpose: business listings are public, and one cached
// response for "salons in Yaba" saves a credit for everyone. Not user data.
export const serpCache = sqliteTable("serp_cache", {
  queryKey: text("query_key").primaryKey(),
  query: text("query").notNull(),
  response: text("response", { mode: "json" }).notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
});

// One row per live SerpApi call (cache hits and fixtures are not calls).
export const serpUsage = sqliteTable(
  "serp_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    engine: text("engine").notNull(),
    query: text("query").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("serp_usage_at").on(t.at)],
);

// Google reviews per place (google_maps_reviews engine), shared across users like the
// search cache: public data, and one fetch saves a credit for everyone. 7 days.
export const reviewCache = sqliteTable("review_cache", {
  placeId: text("place_id").primaryKey(),
  response: text("response", { mode: "json" }).notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
});

// --- Website audit ---

// Raw facts from crawling a site (homepage + contact page), shared across users and
// reused for 24 hours so a site is crawled once even if many results link to it.
// Scores are computed from these per user, because they depend on the user's offer.
export const crawlCache = sqliteTable("crawl_cache", {
  siteKey: text("site_key").primaryKey(),
  facts: text("facts", { mode: "json" }).notNull(),
  crawledAt: integer("crawled_at", { mode: "timestamp_ms" }).notNull(),
});

// --- Model calls (step 6) ---

// One row per logical call (a retry is part of the same row). Feeds `npm run stats:llm`
// and the valid-JSON / tokens / latency numbers for the post.
export const llmCalls = sqliteTable(
  "llm_call",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    leadId: text("lead_id"),
    promptType: text("prompt_type", { enum: ["deep_read", "pitch"] }).notNull(),
    // LLM_PROVIDER at the time: ollama (local) or openrouter. Calls before this
    // column existed were all Ollama.
    provider: text("provider", { enum: ["ollama", "openrouter"] }).notNull().default("ollama"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // What the provider billed, all attempts (OpenRouter's usage.cost). Null for
    // local Ollama calls.
    costUsd: real("cost_usd"),
    latencyMs: integer("latency_ms").notNull(),
    // First reply parsed as JSON and matched the schema.
    validFirstTry: integer("valid_first_try", { mode: "boolean" }).notNull(),
    // First reply also passed the grounding checks (quotes found, no invented numbers).
    groundedFirstTry: integer("grounded_first_try", { mode: "boolean" }).notNull().default(false),
    attempts: integer("attempts").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
    // Debugging. Prompt size in characters (input_tokens is the provider's count), the
    // provider options sent, and on failures the raw model output of every attempt.
    promptChars: integer("prompt_chars"),
    options: text("options", { mode: "json" }).$type<Record<string, unknown>>(),
    rawOutput: text("raw_output"),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("llm_call_at").on(t.at)],
);

// Usage events for `npm run stats:usage`: what happened, who, when. Nothing else is
// stored (no queries, lead names or message text). Tracking starts with this table;
// nothing earlier is backfilled.
export const EVENT_TYPES = [
  "signup",
  "search",
  "audit",
  "lead_saved",
  "pitch_written",
  "open_whatsapp",
  "open_email",
  "moved_replied",
  "moved_won",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const events = sqliteTable(
  "event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("event_type_at").on(t.type, t.at), index("event_user").on(t.userId)],
);
