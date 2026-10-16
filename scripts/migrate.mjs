// Apply the SQL migrations in drizzle/ to DATABASE_URL, then exit. Runs at start-up on
// Render (`node scripts/migrate.mjs && npm start`), because the persistent disk
// isn't mounted during the build. Already-applied migrations are skipped.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local (Render): the environment has DATABASE_URL
}

const url = process.env.DATABASE_URL ?? "file:./data/leadfinder.db";
if (url.startsWith("file:")) mkdirSync(dirname(url.slice("file:".length)), { recursive: true });

const client = createClient({ url });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
client.close();
console.log(`Migrations applied to ${url}`);
