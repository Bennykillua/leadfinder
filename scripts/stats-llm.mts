// Model call stats from the llm_call table.
//   npm run stats:llm               # all time
//   npm run stats:llm -- --days=7   # last 7 days
//   npm run stats:llm -- --model=gemma3:4b

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: default database path
}

const { db } = await import("@/lib/db");
const { llmCalls } = await import("@/lib/db/schema");
const { and, eq, gte } = await import("drizzle-orm");

const args = process.argv.slice(2);
const days = Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 0);
const model = args.find((a) => a.startsWith("--model="))?.split("=")[1];

const where = and(
  days > 0 ? gte(llmCalls.at, new Date(Date.now() - days * 86_400_000)) : undefined,
  model ? eq(llmCalls.model, model) : undefined,
);
const rows = await db.select().from(llmCalls).where(where);

if (rows.length === 0) {
  console.log("No model calls logged yet. Save or open a lead on the board, or press Write pitch.");
  process.exit(0);
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

type Row = (typeof rows)[number];
function summarise(label: string, group: Row[]) {
  const latency = group.map((r) => r.latencyMs);
  const tokIn = group.map((r) => r.inputTokens);
  const tokOut = group.map((r) => r.outputTokens);
  console.log(`\n${label}  (${group.length} calls)`);
  console.log(`  succeeded               ${pct(group.filter((r) => r.ok).length, group.length)}`);
  console.log(`  valid JSON, first try   ${pct(group.filter((r) => r.validFirstTry).length, group.length)}`);
  console.log(`  grounded, first try     ${pct(group.filter((r) => r.groundedFirstTry).length, group.length)}  (quotes found, no invented numbers)`);
  console.log(`  needed the retry        ${pct(group.filter((r) => r.attempts > 1).length, group.length)}`);
  console.log(`  latency                 avg ${secs(avg(latency))} · median ${secs(percentile(latency, 50))} · p95 ${secs(percentile(latency, 95))}`);
  console.log(`  tokens per call         in ${avg(tokIn)} · out ${avg(tokOut)}`);
  console.log(`  tokens total            in ${tokIn.reduce((a, b) => a + b, 0)} · out ${tokOut.reduce((a, b) => a + b, 0)}`);
  const errors = new Map<string, number>();
  for (const r of group.filter((x) => !x.ok && x.error)) {
    const key = r.error!.slice(0, 90);
    errors.set(key, (errors.get(key) ?? 0) + 1);
  }
  if (errors.size) {
    console.log("  failures");
    for (const [e, n] of [...errors].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`    ${n} × ${e}`);
  }
}

console.log(
  `Model calls${days ? ` in the last ${days} days` : ""}${model ? ` for ${model}` : ""}: ${rows.length}` +
    `  (${rows[0] && new Date(Math.min(...rows.map((r) => r.at.getTime()))).toLocaleDateString()} – ${new Date(Math.max(...rows.map((r) => r.at.getTime()))).toLocaleDateString()})`,
);
summarise("ALL", rows);
const groups = new Map<string, Row[]>();
for (const r of rows) {
  const key = `${r.promptType} · ${r.provider}=${r.model}`;
  groups.set(key, [...(groups.get(key) ?? []), r]);
}
for (const [key, group] of [...groups].sort()) summarise(key, group);
process.exit(0);
