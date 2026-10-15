import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't read .env.local by itself.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: fall back to the default path below.
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "file:./data/leadfinder.db" },
});
