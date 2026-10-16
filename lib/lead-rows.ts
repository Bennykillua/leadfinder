import type { leads } from "@/lib/db/schema";
import type { Evidence, Lead, Note } from "@/lib/leads";
import { upgradeEvidence } from "@/lib/audit/checks";

// A lead row from the database → the Lead the app uses. Plain mapping with no Next.js
// imports, so scripts (npm run eval:models) can use it too.

export type LeadRow = typeof leads.$inferSelect;

// Gemma findings were stored first as strings, then { finding, source }, now evidence.
function upgradeFindings(raw: unknown[] | null): Evidence[] {
  return (raw ?? []).map((f, i) => {
    if (f && typeof f === "object" && "id" in f) return f as Evidence;
    const text = typeof f === "string" ? f : String((f as { finding?: unknown }).finding ?? "");
    return { id: `finding:${i + 1}`, kind: "finding", label: "Gemma noticed", ok: false, detail: text };
  });
}

export function rowToLead(r: LeadRow, leadNotes: Note[] = []): Lead {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    area: r.area,
    phone: r.phone,
    whatsapp: r.whatsapp,
    rating: r.rating,
    reviews: r.reviews,
    website: r.website,
    email: r.email,
    whatsappPhone: r.whatsappPhone,
    country: r.country,
    phoneIntl: r.phoneIntl,
    score: r.score,
    auditedAt: r.auditedAt ? r.auditedAt.toISOString() : null,
    topReason: r.topReason,
    evidence: upgradeEvidence(r.evidence),
    status: r.status,
    pitch: r.pitch,
    notes: leadNotes,
    reminder: r.reminderAt ? { at: r.reminderAt.toISOString(), note: r.reminderNote } : null,
    ai:
      r.aiScore !== null && r.aiTopReason && r.aiModel && r.aiAt
        ? {
            score: r.aiScore,
            topReason: r.aiTopReason,
            findings: upgradeFindings(r.aiFindings),
            timing: r.aiTiming ?? [],
            model: r.aiModel,
            at: r.aiAt.toISOString(),
          }
        : null,
    reviewSamples: r.reviewSamples ?? null,
    pitchEvidence: r.pitchEvidence ?? [],
  };
}

