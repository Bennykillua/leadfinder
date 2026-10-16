// Compare models on the same saved leads: deep read, then pitch, per lead.
//   npm run eval:models
//   npm run eval:models -- --leads=15 --models=openrouter=google/gemma-3-12b-it,ollama=gemma3:12b
//
// Models are provider=model (provider: ollama or openrouter); a bare name uses
// LLM_PROVIDER. Default: four open models on OpenRouter plus gemma3:12b on Ollama
// (the same model, hosted vs on this machine). OpenRouter models are skipped without
// OPENROUTER_API_KEY; Ollama models that aren't pulled are skipped.
//
// Runs the app's real deepRead and writePitch (same prompts, checks and retries) on a
// temporary copy of the database, so your leads and model log are never changed.
// Prints, per model and call type: success rate, grounded-first-try rate (passed every
// check on the first answer) and latency; then cost per 1,000 leads per model (what
// OpenRouter billed, from the log), and the same token volume priced on two closed
// models.

import { copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: defaults
}

type ProviderName = "ollama" | "openrouter";
type Spec = { provider: ProviderName; model: string; label: string };

const DEFAULT_MODELS = [
  "openrouter=google/gemma-3-4b-it",
  "openrouter=google/gemma-3-12b-it",
  "openrouter=google/gemma-3-27b-it",
  "openrouter=qwen/qwen3-32b",
  "ollama=gemma3:12b",
].join(",");
// The production model; its token volume is the one priced on closed models.
const REFERENCE = "openrouter=google/gemma-3-12b-it";

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const LEAD_COUNT = Number(arg("leads") ?? 15);
const defaultProvider = (process.env.LLM_PROVIDER?.trim().toLowerCase() || "ollama") as ProviderName;
const specs: Spec[] = (arg("models") ?? process.env.EVAL_MODELS ?? DEFAULT_MODELS)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean)
  .map((m) => {
    const [p, ...rest] = m.split("=");
    const spec = rest.length ? { provider: p as ProviderName, model: rest.join("=") } : { provider: defaultProvider, model: m };
    return { ...spec, label: `${spec.provider}=${spec.model}` };
  });
for (const s of specs) {
  if (s.provider !== "ollama" && s.provider !== "openrouter") {
    console.error(`Unknown provider in "${s.label}": use ollama=… or openrouter=…`);
    process.exit(1);
  }
}

// The copy must be in place before lib/db opens the database.
const source = (process.env.DATABASE_URL ?? "file:./data/leadfinder.db").replace(/^file:/, "");
const copy = join(tmpdir(), `leadfinder-eval-${Date.now()}.db`);
copyFileSync(source, copy);
process.env.DATABASE_URL = `file:${copy}`;

const { db } = await import("@/lib/db");
const { leads, llmCalls, users } = await import("@/lib/db/schema");
const { rowToLead } = await import("@/lib/lead-rows");
const { deepRead } = await import("@/lib/llm/deep-read");
const { writePitch } = await import("@/lib/llm/pitch");
const { ollamaUrl } = await import("@/lib/llm/providers/ollama");
const { openrouterModels } = await import("@/lib/llm/providers/openrouter");
const { CLOSED_MODELS, costUsd } = await import("@/lib/llm/pricing");
const { and, desc, eq, gte } = await import("drizzle-orm");

function finish(code: number): never {
  rmSync(copy, { force: true });
  process.exit(code);
}

// --- Which models can run ---
const OLLAMA_URL = ollamaUrl();
let installed: string[] | null = null;
if (specs.some((s) => s.provider === "ollama")) {
  try {
    const tags = (await (await fetch(`${OLLAMA_URL}/api/tags`)).json()) as { models: { name: string }[] };
    installed = tags.models.map((m) => m.name);
  } catch {
    console.log(`Ollama isn't running at ${OLLAMA_URL}: skipping the Ollama models.`);
  }
}
const hasOpenrouterKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
function skipReason(s: Spec): string | null {
  if (s.provider === "openrouter") return hasOpenrouterKey ? null : "OPENROUTER_API_KEY isn't set";
  if (!installed) return "Ollama isn't running";
  return installed.includes(s.model) || installed.includes(`${s.model}:latest`) ? null : `not pulled (ollama pull ${s.model})`;
}
for (const s of specs) {
  const why = skipReason(s);
  if (why) console.log(`Skipping ${s.label}: ${why}`);
}
const runnable = specs.filter((s) => !skipReason(s));
if (runnable.length === 0) {
  console.log("No model can run.");
  finish(1);
}

// --- The same saved leads for every model: the most recent ones ---
const leadRows = await db.select().from(leads).orderBy(desc(leads.createdAt)).limit(LEAD_COUNT);
if (leadRows.length === 0) {
  console.log("No saved leads. Save some leads on the board first.");
  finish(1);
}
const userRow = await db.query.users.findFirst({ where: eq(users.id, leadRows[0].userId) });
if (!userRow) throw new Error("Lead owner not found");
const user = {
  id: userRow.id,
  name: userRow.name,
  email: userRow.email,
  offer: userRow.offer,
  offerDetail: userRow.offerDetail,
  niche: userRow.niche,
  portfolioLinks: userRow.portfolioLinks ?? [],
  rate: userRow.rate,
};
const evalLeads = leadRows.filter((r) => r.userId === user.id).map((r) => rowToLead(r));
console.log(
  `${evalLeads.length} leads × ${runnable.length} model(s): ${runnable.map((s) => s.label).join(", ")}` +
    (evalLeads.length < LEAD_COUNT ? ` (only ${evalLeads.length} saved, asked for ${LEAD_COUNT})` : ""),
);

// Load a local model before timing, so the first lead doesn't pay for it.
async function warmUp(model: string) {
  await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model, prompt: "Hi", stream: false, options: { num_predict: 1 } }),
  }).catch(() => {});
}

type Skipped = { type: "deep_read" | "pitch"; reason: string };
const skipped = new Map<string, Skipped[]>();
const starts = new Map<string, Date>();
let stopped: string | null = null;

for (const spec of runnable) {
  process.env.LLM_PROVIDER = spec.provider;
  process.env.LLM_MODEL = spec.model;
  if (spec.provider === "ollama") {
    process.stdout.write(`\n${spec.label}: warming up…`);
    await warmUp(spec.model);
  }
  starts.set(spec.label, new Date());
  for (const [i, lead] of evalLeads.entries()) {
    process.stdout.write(`\r${spec.label}: lead ${i + 1}/${evalLeads.length}   `);
    let current = lead;
    try {
      current = { ...lead, ai: await deepRead(user, lead) };
    } catch (err) {
      // Logged in llm_call; the pitch still runs on the lead's saved read. A bad key,
      // no credit or an unknown model fails every call: stop this model.
      const e = err as { kind?: string; message?: string };
      if (e.kind === "config" || e.kind === "model_missing" || e.kind === "unavailable") {
        stopped = `${spec.label}: ${e.message}`;
        console.log(`\n${stopped}`);
        break;
      }
    }
    try {
      await writePitch(user, current);
    } catch (err) {
      // Errors before the model is called (nothing to go on) aren't in llm_call.
      const e = err as { kind?: string; message?: string };
      if (e.kind === "no_evidence" || e.kind === "config") {
        const list = skipped.get(spec.label) ?? [];
        list.push({ type: "pitch", reason: e.message ?? "" });
        skipped.set(spec.label, list);
      }
    }
  }
}
console.log("\n");

// --- Results, from the copy's llm_call log ---
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const W = Math.max(14, ...runnable.map((s) => s.label.length)) + 1;
const pad = (s: string, n: number) => s.padEnd(n);

console.log([pad("model", W), pad("call", 10), pad("runs", 5), pad("success", 8), pad("grounded 1st", 13), pad("median", 7), "p90"].join(" "));
console.log("-".repeat(W + 56));
const failures: string[] = [];
type Volume = { leads: number; input: number; output: number; billed: number | null };
const volumes = new Map<string, Volume>();
for (const spec of runnable) {
  const rows = await db
    .select()
    .from(llmCalls)
    .where(
      and(
        eq(llmCalls.provider, spec.provider),
        eq(llmCalls.model, spec.model),
        gte(llmCalls.at, starts.get(spec.label) ?? new Date(0)),
      ),
    );
  for (const type of ["deep_read", "pitch"] as const) {
    const r = rows.filter((x) => x.promptType === type);
    const latency = r.map((x) => x.latencyMs);
    console.log(
      [
        pad(spec.label, W),
        pad(type, 10),
        pad(String(r.length), 5),
        pad(pct(r.filter((x) => x.ok).length, r.length), 8),
        pad(pct(r.filter((x) => x.groundedFirstTry).length, r.length), 13),
        pad(secs(percentile(latency, 50)), 7),
        secs(percentile(latency, 90)),
      ].join(" "),
    );
    for (const x of r.filter((x) => !x.ok)) failures.push(`${spec.label} ${type}: ${(x.error ?? "").slice(0, 120)}`);
  }
  for (const s of skipped.get(spec.label) ?? []) failures.push(`${spec.label} ${s.type} (not run): ${s.reason.slice(0, 120)}`);
  // Leads the model actually answered for (a stopped model, or a rejected key, has
  // calls with no tokens).
  const leadIds = new Set(rows.filter((x) => x.promptType === "deep_read" && x.inputTokens > 0).map((x) => x.leadId));
  volumes.set(spec.label, {
    leads: leadIds.size,
    input: rows.reduce((n, x) => n + x.inputTokens, 0),
    output: rows.reduce((n, x) => n + x.outputTokens, 0),
    billed: rows.some((x) => x.costUsd !== null) ? rows.reduce((n, x) => n + (x.costUsd ?? 0), 0) : null,
  });
}
console.log("\nsuccess = passed every check (after at most one retry or salvage). grounded 1st = passed on the first answer.");
console.log("Latency is the model calls only (both attempts when retried), not crawling.");

// --- Cost per 1,000 leads, from the tokens logged above (retries included) ---
console.log("\nCost per 1,000 leads (deep read + pitch, retries included):");
console.log([pad("model", W), pad("tokens/lead in", 15), pad("out", 6), pad("per 1,000", 10), "price"].join(" "));
const perLead = (v: Volume) => ({ input: v.input / v.leads, output: v.output / v.leads });
for (const spec of runnable) {
  const v = volumes.get(spec.label)!;
  if (!v.leads) {
    console.log(`${pad(spec.label, W)} no leads read`);
    continue;
  }
  const t = perLead(v);
  let cost = "-";
  let priceNote = "";
  if (spec.provider === "ollama") {
    cost = "$0";
    priceNote = "local: no per-token price (your machine and power)";
  } else {
    const list = (await openrouterModels()).get(spec.model)?.price;
    const listNote = list ? `list price $${+list.input.toFixed(3)} in / $${+list.output.toFixed(3)} out per 1M` : "";
    if (v.billed !== null) {
      cost = usd((v.billed / v.leads) * 1000);
      priceNote = `billed by OpenRouter${listNote ? ` (${listNote})` : ""}`;
    } else if (list) {
      cost = usd(costUsd(list, t.input, t.output) * 1000);
      priceNote = `at ${listNote} (no billed cost logged)`;
    } else {
      priceNote = "no price found";
    }
  }
  console.log([pad(spec.label, W), pad(String(Math.round(t.input)), 15), pad(String(Math.round(t.output)), 6), pad(cost, 10), priceNote].join(" "));
}

// --- The same token volume on two closed models ---
const ref = volumes.get(REFERENCE)?.leads ? REFERENCE : runnable.find((s) => volumes.get(s.label)?.leads)?.label;
if (ref) {
  const t = perLead(volumes.get(ref)!);
  console.log(`\nThe same token volume (${ref}: ${Math.round(t.input)} in / ${Math.round(t.output)} out per lead) on closed models:`);
  for (const m of CLOSED_MODELS) {
    console.log(
      `${pad(m.name, W)} ${pad(usd(costUsd(m, t.input, t.output) * 1000), 10)} per 1,000 leads  ($${m.input} in / $${m.output} out per 1M; ${m.source}, checked ${m.checked})`,
    );
  }
  console.log("Approximate: closed models count tokens with their own tokenizers.");
}

if (stopped) failures.unshift(`stopped early: ${stopped}`);
if (failures.length) {
  console.log(`\nFailures (${failures.length}):`);
  for (const f of failures) console.log(`- ${f}`);
}
finish(0);
