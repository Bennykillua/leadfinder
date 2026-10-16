import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export const DEFAULT_DATABASE_URL = "file:./data/leadfinder.db";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// The connection opens on first use, not on import: `next build` imports every route
// to collect its config, and on Render the database disk (/var/data) isn't mounted
// during the build.
// One client per server process (dev hot reload would otherwise open a new one per edit).
const globalForDb = globalThis as unknown as { libsql?: ReturnType<typeof createClient> };
let instance: Db | undefined;

function open(): Db {
  if (!instance) {
    const client =
      globalForDb.libsql ?? createClient({ url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });
    if (process.env.NODE_ENV !== "production") globalForDb.libsql = client;
    instance = drizzle(client, { schema });
  }
  return instance;
}

export const db = new Proxy({} as Db, {
  get(_, prop) {
    const real = open();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
