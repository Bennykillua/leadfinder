import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { Column, Evidence, WhatsAppLabel } from "../leads";

// --- Auth.js tables (shape required by @auth/drizzle-adapter) ---

export const OFFERS = ["video", "websites", "social", "other"] as const;
export type Offer = (typeof OFFERS)[number];

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  // "What do you sell?" Null until the first-sign-in question is answered.
  offer: text("offer", { enum: OFFERS }),
  offerDetail: text("offer_detail").notNull().default(""),
});

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
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
    // Null until the audit runs (step 5).
    score: integer("score"),
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
