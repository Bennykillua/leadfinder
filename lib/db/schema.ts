import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Column, Evidence, WhatsAppLabel } from "../leads";

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
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
});

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
    // Null until audited.
    score: integer("score"),
    auditedAt: integer("audited_at", { mode: "timestamp_ms" }),
    topReason: text("top_reason").notNull(),
    evidence: text("evidence", { mode: "json" }).$type<Evidence[]>().notNull(),
    status: text("status").$type<Column>().notNull().default("saved"),
    position: integer("position").notNull().default(0),
    pitch: text("pitch").notNull().default(""),
    notes: text("notes").notNull().default(""),
    reminderAt: integer("reminder_at", { mode: "timestamp_ms" }),
    reminderNote: text("reminder_note").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index("lead_user_reminder").on(t.userId, t.reminderAt)],
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

// --- Website audit ---

// Raw facts from crawling a site (homepage + contact page), shared across users and
// reused for 24 hours so a site is crawled once even if many results link to it.
// Scores are computed from these per user, because they depend on the user's offer.
export const crawlCache = sqliteTable("crawl_cache", {
  siteKey: text("site_key").primaryKey(),
  facts: text("facts", { mode: "json" }).notNull(),
  crawledAt: integer("crawled_at", { mode: "timestamp_ms" }).notNull(),
});
