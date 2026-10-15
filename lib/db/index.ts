import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export const DEFAULT_DATABASE_URL = "file:./data/leadfinder.db";

// One client per server process (dev hot reload would otherwise open a new one per edit).
const globalForDb = globalThis as unknown as { libsql?: ReturnType<typeof createClient> };
const client =
  globalForDb.libsql ?? createClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });
if (process.env.NODE_ENV !== "production") globalForDb.libsql = client;

export const db = drizzle(client, { schema });
