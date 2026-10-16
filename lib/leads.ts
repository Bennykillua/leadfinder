// Lead types and contact helpers. Leads are stored per user in SQLite (lib/db);
// businesses come from SerpApi (lib/serpapi.ts) and are audited by lib/audit.

export type WhatsAppLabel = "confirmed" | "likely" | "call";

// Everything a pitch may cite. ok: true = passed, false = a weak spot, null = couldn't
// check (or neutral, like a timing signal). `check` tells the owner, in plain English,
// how to see it for themselves. Ids are stable per lead ("check:https", "review:2").
export type EvidenceKind = "check" | "finding" | "review" | "timing" | "profile";
export type Evidence = {
  id: string;
  kind: EvidenceKind;
  label: string;
  ok: boolean | null;
  detail: string;
  check?: string;
};

export type Review = { id: string; rating: number; date: string; isoDate: string | null; text: string };
export type ReviewSample = { fetchedAt: string; sort: string; items: Review[] };

export type Business = {
  id: string;
  name: string;
  category: string;
  area: string;
  phone: string;
  whatsapp: WhatsAppLabel;
  rating: number;
  reviews: number;
  website: string | null;
  // Business email published on its own website (mailto: or contact page). Never guessed.
  email: string | null;
  // WhatsApp number linked from the business's own site (wa.me / api.whatsapp.com),
  // international digits without "+".
  whatsappPhone: string | null;
  // ISO country (detected from the search, a + number, or map coordinates) and the
  // Maps phone in international digits without "+" (null if it couldn't be parsed).
  country: string | null;
  phoneIntl: string | null;
  // 1–5 once audited (step 5); null for fresh search results.
  score: number | null;
  auditedAt: string | null;
  topReason: string;
  evidence: Evidence[];
};

export type Column = "saved" | "pitched" | "replied" | "won" | "lost";

export const COLUMNS: { id: Column; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "pitched", label: "Pitched" },
  { id: "replied", label: "Replied" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export type Reminder = { at: string; note: string };

export type Note = { id: string; body: string; createdAt: string; updatedAt: string };

export type AiRead = {
  score: number;
  topReason: string;
  // Up to 3 problems the rule checks missed, from the customers' point of view
  // (kind "finding"), each with what the owner can check.
  findings: Evidence[];
  // Timing signals found when Gemma read the lead (kind "timing"): "Why now?".
  timing: Evidence[];
  model: string;
  at: string;
};

export type Lead = Business & {
  status: Column;
  pitch: string;
  // Newest first.
  notes: Note[];
  reminder: Reminder | null;
  // Gemma's deep read; null until it has run (see lib/llm).
  ai: AiRead | null;
  // Lowest-rated Google reviews, fetched on request ("Read reviews"). Not `reviews`:
  // that's the review count on Business.
  reviewSamples: ReviewSample | null;
  // The evidence Gemma's current pitch draft cited, as it was when written.
  pitchEvidence: Evidence[];
};

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// --- Contact: WhatsApp confirmed → likely WhatsApp → email from website → call only ---

// Numbers are normalised server-side with libphonenumber-js (lib/phone.ts).
export function whatsappNumber(b: Business): string | null {
  if (b.whatsappPhone) return b.whatsappPhone;
  if (b.whatsapp === "call") return null;
  return b.phoneIntl;
}

export type ContactKind = "confirmed" | "likely" | "email" | "call" | "none";

export function contactKind(b: Business): ContactKind {
  const wa = whatsappNumber(b);
  if (wa && b.whatsapp === "confirmed") return "confirmed";
  if (wa) return "likely";
  if (b.email) return "email";
  return b.phone ? "call" : "none";
}

export function whatsappLink(number: string, pitch: string) {
  const text = pitch.trim();
  return text ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : `https://wa.me/${number}`;
}

export function mailtoLink(b: Business, pitch: string) {
  const subject = encodeURIComponent(`Quick idea for ${b.name}`);
  return `mailto:${b.email}?subject=${subject}&body=${encodeURIComponent(pitch.trim())}`;
}

export function telLink(b: Business) {
  return b.phoneIntl ? `tel:+${b.phoneIntl}` : `tel:${b.phone.replace(/[^\d+]/g, "")}`;
}

// All evidence a pitch may cite, in one list: rule checks, Gemma's findings,
// reviews and timing signals.
export function allEvidence(lead: Lead): Evidence[] {
  return [
    ...lead.evidence,
    ...(lead.ai?.findings ?? []),
    ...(lead.reviewSamples?.items ?? []).map(reviewEvidence),
    ...(lead.ai?.timing ?? []),
  ];
}

export function reviewEvidence(r: Review): Evidence {
  return {
    id: r.id,
    kind: "review",
    label: `${r.rating}★ Google review`,
    ok: r.rating >= 4 ? true : r.rating <= 2 ? false : null,
    detail: `“${r.text}” (${r.date})`,
    check: `Open their Google Maps reviews, sort by lowest rating: the ${r.rating}★ review from ${r.date}.`,
  };
}

export function newLead(b: Business, status: Column = "saved"): Lead {
  return { ...b, status, pitch: "", notes: [], reminder: null, ai: null, reviewSamples: null, pitchEvidence: [] };
}
