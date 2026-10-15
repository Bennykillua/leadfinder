// Set (or reset) a user's password from the terminal.
//   npm run user:password -- you@example.com
// For the account created back when sign-in used Google, which has no password yet.
// Runs locally against DATABASE_URL; the password is typed twice, hidden.

import { createClient } from "@libsql/client";
import { hashPassword, PASSWORD_MIN } from "../lib/password.ts";

try {
  process.loadEnvFile(".env.local");
} catch {
  // fall back to the default database path
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run user:password -- you@example.com");
  process.exit(1);
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    let value = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        } else if (ch === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        } else if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    stdin.on("data", onData);
  });
}

const db = createClient({ url: process.env.DATABASE_URL ?? "file:./data/leadfinder.db" });
const { rows } = await db.execute({ sql: "select id, name from user where lower(email) = ?", args: [email] });
if (rows.length === 0) {
  console.error(`No account with email ${email}.`);
  process.exit(1);
}

const password = await askHidden("New password: ");
if (password.length < PASSWORD_MIN) {
  console.error(`Password must be at least ${PASSWORD_MIN} characters.`);
  process.exit(1);
}
if ((await askHidden("Type it again: ")) !== password) {
  console.error("Passwords didn't match.");
  process.exit(1);
}

await db.execute({
  sql: "update user set password_hash = ?, email = ? where id = ?",
  args: [await hashPassword(password), email, rows[0].id],
});
console.log(`Password set for ${rows[0].name ?? email}. Sign in at /signin.`);
