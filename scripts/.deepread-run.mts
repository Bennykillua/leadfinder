process.loadEnvFile(".env.local");
process.env.DATABASE_URL = process.argv[2];
process.env.LLM_MODEL = process.argv[3];
delete process.env.SERPAPI_API_KEY;
const { db } = await import("@/lib/db");
const { users, leads: leadsTable, llmCalls } = await import("@/lib/db/schema");
const { deepRead } = await import("@/lib/llm/deep-read");
const { newLead } = await import("@/lib/leads");
const { asc, eq, gt } = await import("drizzle-orm");
const [u] = await db.select().from(users);
const user = { id: u.id, name: u.name, email: u.email, offer: u.offer, offerDetail: u.offerDetail };
const rows0 = await db.select().from(leadsTable).where(eq(leadsTable.userId, u.id)).orderBy(asc(leadsTable.position)).limit(5);
const leads = rows0.map((r) => newLead({ id: r.id, name: r.name, category: r.category, area: r.area, phone: r.phone, whatsapp: r.whatsapp, rating: r.rating, reviews: r.reviews, website: r.website, email: r.email, whatsappPhone: r.whatsappPhone, score: r.score, topReason: r.topReason, evidence: r.evidence, auditedAt: r.auditedAt?.toISOString() ?? null }));
const startedAt = new Date();
console.log(`model ${process.env.LLM_MODEL}`);
for (const lead of leads) {
  const t = Date.now();
  try {
    const ai = await deepRead(user, lead);
    console.log(`✓ ${lead.name}  score ${ai.score}  ${((Date.now() - t) / 1000).toFixed(1)}s\n    top reason: ${ai.topReason}`);
    for (const f of ai.findings) console.log(`    • ${f}`);
  } catch (e) {
    console.log(`✗ ${lead.name}  ${((Date.now() - t) / 1000).toFixed(1)}s  ${(e as Error).message.slice(0, 220)}`);
  }
}
const rows = await db.select().from(llmCalls).where(gt(llmCalls.at, startedAt));
const n = rows.length;
console.log(`This run: ${rows.filter((r) => r.ok).length}/${n} succeeded · valid JSON first try ${rows.filter((r) => r.validFirstTry).length}/${n} · passed all checks first try ${rows.filter((r) => r.groundedFirstTry).length}/${n} · median latency ${[...rows.map((r) => r.latencyMs)].sort((a, b) => a - b)[Math.floor(n / 2)]}ms`);
for (const r of rows.filter((x) => x.attempts > 1)) console.log(`  retry reason: ${r.error}`);
process.exit(0);
