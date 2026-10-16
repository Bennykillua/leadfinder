// Usage totals from the event table, overall and per user (users are numbered, never
// named). Your own account is left out: set STATS_EXCLUDE_EMAILS in .env.local
// (comma-separated). Tracking started when the event table was added; nothing
// earlier is counted.
//   npm run stats:usage
//   npm run stats:usage -- --days=7

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: default database path
}

const { db } = await import("@/lib/db");
const { events, EVENT_TYPES, users } = await import("@/lib/db/schema");
const { gte } = await import("drizzle-orm");
type EventType = (typeof EVENT_TYPES)[number];

const days = Number(process.argv.slice(2).find((a) => a.startsWith("--days="))?.split("=")[1] ?? 0);
const excludeEmails = new Set(
  (process.env.STATS_EXCLUDE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

const allUsers = await db.select({ id: users.id, email: users.email }).from(users);
const excluded = new Set(allUsers.filter((u) => u.email && excludeEmails.has(u.email.toLowerCase())).map((u) => u.id));
const counted = allUsers.filter((u) => !excluded.has(u.id));

const rows = (
  await db
    .select()
    .from(events)
    .where(days > 0 ? gte(events.at, new Date(Date.now() - days * 86_400_000)) : undefined)
).filter((e) => !excluded.has(e.userId));

const LABEL: Record<EventType, string> = {
  signup: "Sign-ups",
  search: "Searches run",
  audit: "Audits",
  lead_saved: "Leads saved",
  pitch_written: "Pitches written",
  open_whatsapp: "Open in WhatsApp clicks",
  open_email: "Open in email clicks",
  moved_replied: "Moved to Replied",
  moved_won: "Moved to Won",
};

if (excludeEmails.size === 0) {
  console.log("Note: STATS_EXCLUDE_EMAILS isn't set in .env.local, so your own account is included.\n");
} else if (excluded.size < excludeEmails.size) {
  console.log(`Note: ${excludeEmails.size - excluded.size} address(es) in STATS_EXCLUDE_EMAILS match no account.\n`);
}

const first = rows.reduce<Date | null>((min, e) => (!min || e.at < min ? e.at : min), null);
console.log(
  `Usage${days > 0 ? ` in the last ${days} days` : ""}, excluding ${excluded.size} account(s)` +
    (first ? `, since ${first.toISOString().slice(0, 10)}` : ""),
);
console.log("");
const active = new Set(rows.map((e) => e.userId));
console.log(`${"Users".padEnd(26)} ${counted.length} (${active.size} active)`);
for (const type of EVENT_TYPES) {
  console.log(`${LABEL[type].padEnd(26)} ${rows.filter((e) => e.type === type).length}`);
}

if (rows.length === 0) {
  console.log("\nNo events yet. Tracking started when the event table was added.");
  process.exit(0);
}

// Per user, numbered by first activity. No ids, names or emails.
const order = [...active].sort(
  (a, b) => Math.min(...rows.filter((e) => e.userId === a).map((e) => +e.at)) -
    Math.min(...rows.filter((e) => e.userId === b).map((e) => +e.at)),
);
const SHORT: Record<EventType, string> = {
  signup: "signup",
  search: "search",
  audit: "audit",
  lead_saved: "saved",
  pitch_written: "pitch",
  open_whatsapp: "wa",
  open_email: "email",
  moved_replied: "replied",
  moved_won: "won",
};
console.log("\nPer user:");
console.log(["user".padEnd(8), ...EVENT_TYPES.map((t) => SHORT[t].padStart(8))].join(""));
order.forEach((userId, i) => {
  const mine = rows.filter((e) => e.userId === userId);
  console.log(
    [`user ${i + 1}`.padEnd(8), ...EVENT_TYPES.map((t) => String(mine.filter((e) => e.type === t).length).padStart(8))].join(""),
  );
});
process.exit(0);
