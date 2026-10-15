// Audit evaluation: compare the real audit with hand-checked answers.
//
//   npm run eval:audit                 # offer defaults to "video"
//   npm run eval:audit -- --offer=websites
//   npm run eval:audit -- --fresh      # ignore the 24-hour crawl cache
//
// Reads eval/truth.csv (one row per business: name, url, yes/no answers per check,
// and "what_i_would_pitch"), audits each url by website only, and prints accuracy per
// check, couldn't-check reasons, and top reason vs your pitch. Each run is saved to
// eval/results-<date>-<time>.json.
//
// Never spends SerpApi credits: it only audits by website (no Maps lookup), and the
// SerpApi key is removed from this process before anything runs.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: default database path
}
delete process.env.SERPAPI_API_KEY;

const { auditWebsite } = await import("@/lib/audit");
const { crawlSite, normaliseWebsite } = await import("@/lib/audit/crawl");
const { socialPage } = await import("@/lib/audit/checks");
const { OFFERS } = await import("@/lib/db/schema");
type Offer = (typeof OFFERS)[number];

const CHECKS = ["https", "mobile", "email_found", "whatsapp_found", "has_video", "site_reachable"] as const;
type CheckName = (typeof CHECKS)[number];

const args = process.argv.slice(2);
const offerArg = args.find((a) => a.startsWith("--offer="))?.split("=")[1] ?? "video";
if (!OFFERS.includes(offerArg as Offer)) {
  console.error(`--offer must be one of: ${OFFERS.join(", ")}`);
  process.exit(1);
}
const offer = offerArg as Offer;
const fresh = args.includes("--fresh");

// --- CSV (RFC 4180: quoted fields may contain commas, quotes and newlines) ---

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// yes/no/true/false/y/n/1/0; blank = not answered (left out of accuracy).
function truthValue(raw: string | undefined): boolean | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(v)) return true;
  if (["no", "n", "false", "0"].includes(v)) return false;
  return null;
}

// --- Run ---

type RowResult = {
  name: string;
  url: string;
  truth: Partial<Record<CheckName, boolean | null>>;
  predicted: Partial<Record<CheckName, boolean | null>>;
  couldntCheck: string | null;
  topReason: string | null;
  score: number | null;
  whatIWouldPitch: string;
  error?: string;
};

async function evalRow(cols: Record<string, string>): Promise<RowResult> {
  const name = cols.name?.trim() ?? "";
  const url = cols.url?.trim() ?? "";
  const truth = Object.fromEntries(CHECKS.map((c) => [c, truthValue(cols[c])])) as RowResult["truth"];
  const base: RowResult = {
    name,
    url,
    truth,
    predicted: {},
    couldntCheck: null,
    topReason: null,
    score: null,
    whatIWouldPitch: cols.what_i_would_pitch?.trim() ?? "",
  };

  if (!url) return { ...base, couldntCheck: "No url in truth.csv" };
  const social = socialPage(url);
  if (social) {
    const { business } = await auditWebsite(url, offer);
    return { ...base, couldntCheck: `${social}, not crawled`, topReason: business.topReason, score: business.score };
  }
  if (!normaliseWebsite(url)) return { ...base, couldntCheck: "Not a valid website address" };

  try {
    // --fresh: re-crawl first, so the audit below reads the new crawl from the cache.
    if (fresh) await crawlSite(normaliseWebsite(url)!, { force: true });
    const { business, facts } = await auditWebsite(url, offer);
    const ev = (label: string) => business.evidence.find((e) => e.label === label)?.ok ?? null;

    let couldntCheck: string | null = null;
    if (!facts) couldntCheck = "Not crawled";
    else if (facts.robotsNote) couldntCheck = facts.robotsNote;
    else if (facts.errorKind === "blocked-address") couldntCheck = facts.error;

    const crawled = !!facts && !facts.error && !facts.robotsNote;
    const predicted: RowResult["predicted"] = {
      site_reachable: facts && !facts.robotsNote && facts.errorKind !== "blocked-address" ? !facts.error : null,
      https: crawled ? ev("HTTPS") : null,
      mobile: crawled ? ev("Mobile-friendly") : null,
      email_found: crawled ? business.email !== null : null,
      whatsapp_found: crawled ? business.whatsappPhone !== null : null,
      has_video: crawled ? (facts.hasVideo ?? null) : null,
    };
    return { ...base, predicted, couldntCheck, topReason: business.topReason, score: business.score };
  } catch (err) {
    return { ...base, couldntCheck: "Audit threw an error", error: err instanceof Error ? err.message : String(err) };
  }
}

const truthPath = path.join("eval", "truth.csv");
const rows = parseCsv(await readFile(truthPath, "utf8"));
const [header, ...data] = rows;
const missing = ["name", "url", ...CHECKS, "what_i_would_pitch"].filter((h) => !header?.includes(h));
if (!header || missing.length) {
  console.error(`eval/truth.csv is missing columns: ${missing.join(", ")}`);
  process.exit(1);
}
if (data.length === 0) {
  console.log("eval/truth.csv has no rows yet. Add one row per business, then run again.");
  process.exit(0);
}

console.log(`Auditing ${data.length} sites as offer "${offer}"${fresh ? " (fresh crawl)" : " (24h crawl cache where available)"}…\n`);
const started = Date.now();
let done = 0;
const results = await Promise.all(
  data.map(async (cells) => {
    const cols = Object.fromEntries(header.map((h, i) => [h.trim(), cells[i] ?? ""]));
    const r = await evalRow(cols);
    done++;
    process.stdout.write(`\r  ${done}/${data.length} done`);
    return r;
  }),
);
process.stdout.write("\n\n");

// --- Report ---

const yn = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : "?");
const label = (r: RowResult) => r.name || r.url;

const accuracy = CHECKS.map((check) => {
  const answered = results.filter((r) => r.truth[check] !== null && r.truth[check] !== undefined);
  const correct = answered.filter((r) => r.predicted[check] === r.truth[check]);
  const unchecked = answered.filter((r) => r.predicted[check] === null || r.predicted[check] === undefined);
  const wrong = answered.filter(
    (r) => r.predicted[check] !== null && r.predicted[check] !== undefined && r.predicted[check] !== r.truth[check],
  );
  return { check, correct: correct.length, total: answered.length, unchecked, wrong };
});

console.log("ACCURACY PER CHECK  (correct / rows you answered; couldn't-check counts as not correct)");
for (const a of accuracy) {
  const pct = a.total ? Math.round((a.correct / a.total) * 100) : 0;
  console.log(`  ${a.check.padEnd(15)} ${String(a.correct).padStart(3)} / ${String(a.total).padEnd(3)} ${a.total ? `${pct}%` : "-"}`);
  for (const r of a.wrong) {
    console.log(`      ✗ ${label(r)}: you said ${yn(r.truth[a.check])}, audit said ${yn(r.predicted[a.check])}`);
  }
  for (const r of a.unchecked) console.log(`      – ${label(r)}: audit couldn't check`);
}

const unchecked = results.filter((r) => r.couldntCheck);
console.log(`\nCOULDN'T CHECK  ${unchecked.length} of ${results.length} sites`);
const byReason = new Map<string, string[]>();
for (const r of unchecked) byReason.set(r.couldntCheck!, [...(byReason.get(r.couldntCheck!) ?? []), label(r)]);
for (const [reason, names] of byReason) console.log(`  ${names.length} × ${reason}\n      ${names.join(", ")}`);
for (const r of results.filter((x) => x.error)) console.log(`  error on ${label(r)}: ${r.error}`);

console.log("\nTOP REASON vs WHAT YOU WOULD PITCH  (rate these by eye)");
for (const r of results) {
  console.log(`\n  ${label(r)}  [score ${r.score ?? "-"}]`);
  console.log(`    audit: ${r.topReason ?? "(none)"}`);
  console.log(`    you:   ${r.whatIWouldPitch || "(blank)"}`);
}

const now = new Date();
const stamp = `${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
const outPath = path.join("eval", `results-${stamp}.json`);
await mkdir("eval", { recursive: true });
await writeFile(
  outPath,
  JSON.stringify(
    {
      ranAt: now.toISOString(),
      offer,
      freshCrawl: fresh,
      seconds: Math.round((Date.now() - started) / 1000),
      accuracy: accuracy.map((a) => ({
        check: a.check,
        correct: a.correct,
        total: a.total,
        wrong: a.wrong.map(label),
        couldntCheck: a.unchecked.map(label),
      })),
      couldntCheck: unchecked.map((r) => ({ name: label(r), reason: r.couldntCheck })),
      rows: results,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nSaved ${outPath}`);
process.exit(0);
