import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/dal";
import type { AiRead, Evidence, Lead, Review } from "@/lib/leads";
import { crawlSite, normaliseWebsite, PAGES_VERSION, type CrawlFacts } from "@/lib/audit/crawl";
import { socialPage } from "@/lib/audit/checks";
import { businessFacts, evidenceLines, offerText } from "./context";
import { copiedFromExample, normalise, pointsAtFacts, serviceTalk, unknownNumbers } from "./grounding";
import { generateJson } from "./ollama";

// Gemma call 1: read the site (and reviews, if fetched), judge fit for THIS user's
// offer, and add up to 3 findings the rule checks missed, written as the business's
// problem from its customers' point of view, each with what the owner can check.

const PAGE_BUDGET = 2500;
const HOME_SHARE = 1700;
const REVIEW_BUDGET = 1600;
// The prompt asks for under 100 characters and the check allows up to 140. The schema
// leaves room beyond that because Ollama enforces maxLength by cutting text off
// mid-word, which a small model doesn't plan for.
const SCHEMA_MAX = 200;
const TEXT_MAX = 140;
const RECENT_DAYS = 30;

function schemaFor(maxFindings: number) {
  return z.object({
    score: z.number().int().min(1).max(5),
    top_reason: z.string().min(15).max(SCHEMA_MAX),
    findings: z
      .array(z.object({ text: z.string().min(10).max(SCHEMA_MAX), check: z.string().min(10).max(SCHEMA_MAX) }))
      .max(maxFindings),
  });
}

async function crawlFor(lead: Lead): Promise<CrawlFacts | null> {
  if (!lead.website || socialPage(lead.website)) return null;
  const website = normaliseWebsite(lead.website);
  if (!website) return null;
  let facts = await crawlSite(website);
  // Crawls cached before the current page-text format: crawl once more.
  if (facts.pagesVersion !== PAGES_VERSION && !facts.error && !facts.robotsNote) {
    facts = await crawlSite(website, { force: true });
  }
  return facts;
}

// About 2,500 characters: most of it for the homepage, the rest shared by the others.
// Each page's text is already ordered most-useful-first, so cutting the end is safe.
function pageBlock(pages: NonNullable<CrawlFacts["pages"]>) {
  const blocks: string[] = [];
  let used = 0;
  pages.forEach((p, i) => {
    const left = PAGE_BUDGET - used;
    if (left < 150) return;
    const share = i === 0 ? Math.min(HOME_SHARE, left) : Math.floor(left / (pages.length - i));
    const text = p.text.length > share ? `${p.text.slice(0, share - 1)}…` : p.text;
    used += text.length;
    blocks.push(`### ${new URL(p.url).pathname || "/"}\n${text}`);
  });
  return blocks.join("\n\n");
}

function reviewBlock(reviews: Review[]) {
  let budget = REVIEW_BUDGET;
  const lines: string[] = [];
  for (const r of reviews) {
    const text = r.text.length > 220 ? `${r.text.slice(0, 219)}…` : r.text;
    const line = `- ${r.rating}★, ${r.date}: "${text}"`;
    if (line.length > budget) break;
    budget -= line.length;
    lines.push(line);
  }
  return lines.join("\n");
}

function daysAgo(iso: string | null) {
  return iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : Infinity;
}

// "Why now?": timing signals from the site text and the reviews. Code-made, not model.
function timingSignals(lead: Lead, facts: CrawlFacts | null): Evidence[] {
  const out: Evidence[] = [];
  for (const sig of facts?.signals ?? []) {
    const path = new URL(sig.url).pathname || "/";
    out.push({
      id: sig.kind === "hiring" ? "timing:hiring" : "timing:new-location",
      kind: "timing",
      label: sig.kind === "hiring" ? "Hiring" : "New location",
      ok: null,
      detail: `Their site says: “${sig.quote}”`,
      check: `Open ${new URL(sig.url).hostname.replace(/^www\./, "")}${path === "/" ? "" : path}: it says “${sig.quote}”.`,
    });
  }
  const recent = (lead.reviewSamples?.items ?? []).filter((r) => daysAgo(r.isoDate) <= RECENT_DAYS);
  const recentBad = recent.find((r) => r.rating <= 2);
  if (recentBad) {
    out.push({
      id: "timing:recent-bad-review",
      kind: "timing",
      label: "Recent bad review",
      ok: null,
      detail: `A ${recentBad.rating}★ review ${recentBad.date}: “${recentBad.text.slice(0, 120)}${recentBad.text.length > 120 ? "…" : ""}”`,
      check: `Open their Google Maps reviews, sort by newest: the ${recentBad.rating}★ review from ${recentBad.date}.`,
    });
  } else if (recent.length > 0) {
    out.push({
      id: "timing:new-reviews",
      kind: "timing",
      label: "New reviews",
      ok: null,
      detail: `${recent.length} of the reviews fetched are from the last ${RECENT_DAYS} days.`,
      check: `Open their Google Maps reviews, sort by newest: new reviews this month.`,
    });
  }
  return out;
}

const EXAMPLE = `{"score":4,"top_reason":"No photos or prices of the hall, so couples must message before they can judge it.","findings":[{"text":"Couples can't see the hall or prices without messaging first.","check":"Open the Halls page: there are no photos and no prices."},{"text":"Guests say parking is a problem: \\"no space to park, we left early\\".","check":"Read their 2★ Google review from 3 weeks ago."}]}`;
// Only in the example: must not show up in a real answer unless the business has them.
const EXAMPLE_ONLY = ["couples", "hall", "Halls", "parking"];

const SYSTEM = `You help a freelancer decide which local businesses to pitch. You read a business's website text, Google reviews (if given) and audit results, and judge how good a pitch it is for THIS freelancer's service.

Reply with JSON in exactly this shape (this example is for a different business, an event hall; never copy its details):
${EXAMPLE}

Fields:
- "score": integer 1-5, for THIS freelancer's service. 5 = a clear, checkable problem their service fixes and the business looks active. 4 = a problem they fix, less striking. 3 = a weak or indirect angle. 2 = little to fix. 1 = nothing to fix. No website, or a site that is down, is a real problem, not a reason for a low score.
- "top_reason": one plain sentence, under 100 characters, naming ONE specific problem the freelancer's service fixes, as the business would feel it.
- "findings": up to 3 problems the audit evidence does NOT already list. Each has:
  - "text": one short sentence (under 100 characters).
  - "check": one short sentence telling the owner exactly where to look to see it (a page, a section, a review).

Rules for findings and top_reason:
- Describe the business's problem from ITS CUSTOMERS' point of view, in plain English.
- Point to something specific in the website text, reviews or evidence.
- A finding taken from a review must quote the review's own words in double quotes.
- Never mention the freelancer or their services, and never say "opportunity" or "online presence".
  Bad: "Lack of online presence limits website design opportunities."
  Good: "Couples can't see the hall or prices without messaging first."
- Use only facts given. No invented numbers, prices or names.
- If there is no website text and no reviews, "findings" must be [].`;

const REVIEW_TALK = /\b(review|reviews|reviewer|rated|stars?|★|complain|complaint|guests? (say|said|mention)|customers? (say|said|mention))\b/i;

function quotesIn(text: string) {
  return [...text.matchAll(/["“]([^"”]{3,})["”]/g)].map((m) => m[1]);
}

export async function deepRead(user: CurrentUser, lead: Lead): Promise<AiRead> {
  const facts = await crawlFor(lead);
  const pages = facts?.pages ?? [];
  const pageText = pages.length > 0 ? pageBlock(pages) : "";
  const reviews = lead.reviewSamples?.items ?? [];
  const reviewText = reviews.length > 0 ? reviewBlock(reviews) : "";
  const evidence = evidenceLines(lead.evidence);
  const businessText = businessFacts(lead);
  const corpus = [pageText, reviewText, evidence, businessText];
  const reviewCorpus = ` ${normalise(reviews.map((r) => r.text).join(" \n "))} `;

  const { value, model } = await generateJson({
    type: "deep_read",
    schema: schemaFor(pageText || reviewText ? 3 : 0),
    userId: user.id,
    leadId: lead.id,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `THE FREELANCER sells (this is about the freelancer, NOT the business): ${offerText(user)}

THE BUSINESS:
${businessText}

AUDIT EVIDENCE (already known problems and passes):
${evidence}

THE BUSINESS'S WEBSITE TEXT (most useful parts):
${pageText || "(no website text available)"}
${reviewText ? `\nGOOGLE REVIEWS (lowest-rated, newest first):\n${reviewText}\n` : ""}`,
      },
    ],
    check: (v) => {
      // The rubric's one hard rule: no website (or a dead one) is a real problem.
      const noSite = lead.evidence.some((e) => (e.label === "Website" || e.label === "Site up") && e.ok === false);
      if (noSite && v.score <= 2) {
        return `"score" is ${v.score}, but the evidence shows no working website, which is a real problem for this business. Score it 3 or higher.`;
      }
      if (v.top_reason.length > TEXT_MAX) return `"top_reason" is ${v.top_reason.length} characters; keep it under 100.`;
      for (const f of v.findings) {
        if (f.text.length > TEXT_MAX) return `A finding is too long ("${f.text}"); keep each under 100 characters.`;
        if (f.check.length > TEXT_MAX) return `A finding's "check" is too long ("${f.check}"); keep it under 100 characters.`;
        // Findings from reviews must quote the review, and the quote must be real.
        const quotes = quotesIn(f.text);
        if (REVIEW_TALK.test(f.text) && reviews.length > 0 && quotes.length === 0) {
          return `The finding "${f.text}" comes from a review but doesn't quote it. Quote the review's own words in double quotes.`;
        }
        const fake = quotes.find((q) => !reviewCorpus.includes(` ${normalise(q)}`) && !pointsAtFacts(q, [pageText]));
        if (fake) return `The quote "${fake}" isn't in the reviews or the website text. Quote exactly.`;
      }
      const texts: [string, string][] = [
        ["top_reason", v.top_reason],
        ...v.findings.map((f): [string, string] => ["finding", f.text]),
      ];
      for (const [field, text] of texts) {
        const talk = serviceTalk(text, user.offerDetail);
        if (talk) {
          return `The ${field} "${text}" talks about "${talk}". Describe the business's own problem as its customers feel it, and don't mention the freelancer's services.`;
        }
        // With nothing to read, there's nothing to point at: the evidence is the point.
        if ((pageText || reviewText) && !pointsAtFacts(text, corpus)) {
          return `The ${field} "${text}" is too general. Point to something specific in the website text, reviews or evidence.`;
        }
        const numbers = unknownNumbers(text, corpus);
        if (numbers.length) return `The ${field} "${text}" uses numbers that aren't in the facts (${numbers.join(", ")}).`;
        const copied = copiedFromExample(text, EXAMPLE_ONLY, corpus);
        if (copied.length) return `The ${field} "${text}" copies the example (${copied.join(", ")}). Write about this business only.`;
      }
      if (new Set(v.findings.map((f) => f.text.toLowerCase())).size < v.findings.length) return "Two findings are the same.";
      return null;
    },
  });

  const read: AiRead = {
    score: value.score,
    topReason: value.top_reason,
    findings: value.findings.map((f, i) => ({
      id: `finding:${i + 1}`,
      kind: "finding",
      label: "Gemma noticed",
      ok: false,
      detail: f.text,
      check: f.check,
    })),
    timing: timingSignals(lead, facts),
    model,
    at: new Date().toISOString(),
  };
  await db
    .update(leads)
    .set({
      aiScore: read.score,
      aiTopReason: read.topReason,
      aiFindings: read.findings,
      aiTiming: read.timing,
      aiModel: read.model,
      aiAt: new Date(read.at),
    })
    .where(and(eq(leads.userId, user.id), eq(leads.id, lead.id)));
  return read;
}

// The same lead asked for twice at once (saved, then opened) shares one model call.
const inFlight = new Map<string, Promise<AiRead>>();
export function deepReadOnce(user: CurrentUser, lead: Lead): Promise<AiRead> {
  const key = `${user.id}:${lead.id}`;
  const running = inFlight.get(key);
  if (running) return running;
  const p = deepRead(user, lead).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
