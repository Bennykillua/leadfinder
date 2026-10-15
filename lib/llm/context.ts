import "server-only";
import type { CurrentUser } from "@/lib/dal";
import type { Evidence, Lead } from "@/lib/leads";

// Shared prompt pieces: who the freelancer is and what we know about the business.

const OFFER_TEXT = {
  video: "video editing (promo videos, reels, event and product videos)",
  websites: "websites (design, build, booking and mobile-friendly sites)",
  social: "social media management (content, page management, ads)",
  other: "",
} as const;

export function offerText(user: CurrentUser) {
  const base = user.offer ? OFFER_TEXT[user.offer] : "";
  const detail = user.offerDetail.trim();
  if (base && detail) return `${base}. In their words: "${detail}"`;
  return base || detail || "freelance digital services";
}

export function evidenceLines(evidence: Evidence[]) {
  if (evidence.length === 0) return "(not audited)";
  return evidence
    .map((e) => `- [${e.ok === true ? "PASSED" : e.ok === false ? "PROBLEM" : "COULDN'T CHECK"}] ${e.label}: ${e.detail}`)
    .join("\n");
}

export function businessFacts(lead: Lead) {
  return [
    `Name: ${lead.name}`,
    lead.category && `Category: ${lead.category}`,
    lead.area && `Address: ${lead.area}`,
    lead.reviews > 0 ? `Google Maps: ${lead.rating.toFixed(1)} stars from ${lead.reviews} reviews` : "Google Maps: no reviews",
    `Website: ${lead.website ?? "none listed"}`,
  ]
    .filter(Boolean)
    .join("\n");
}
