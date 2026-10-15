import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { db } from "@/lib/db";
import { leads, notes, users, type Offer } from "@/lib/db/schema";
import type { Evidence, Lead, Note } from "@/lib/leads";
import { upgradeEvidence } from "@/lib/audit/checks";

// Data access layer: every read and write resolves the user from the session here,
// never from anything the client sends.

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string | null;
  offer: Offer | null;
  offerDetail: string;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const id = await readSession();
  if (!id) return null;
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    offer: row.offer,
    offerDetail: row.offerDetail,
  };
}

// Signed in, any state.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user;
}

// Signed in and has answered "What do you sell?".
export async function requireOnboardedUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.offer) redirect("/welcome");
  return user;
}

type LeadRow = typeof leads.$inferSelect;

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

// One lead, only if it belongs to this user.
export async function getLead(userId: string, id: string): Promise<Lead | null> {
  const row = await db.query.leads.findFirst({ where: and(eq(leads.userId, userId), eq(leads.id, id)) });
  return row ? rowToLead(row) : null;
}

export async function listLeads(userId: string): Promise<Lead[]> {
  const [rows, noteRows] = await Promise.all([
    db.select().from(leads).where(eq(leads.userId, userId)).orderBy(asc(leads.position), asc(leads.createdAt)),
    db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.createdAt)),
  ]);
  const byLead = new Map<string, Note[]>();
  for (const n of noteRows) {
    const list = byLead.get(n.leadId) ?? [];
    list.push({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    });
    byLead.set(n.leadId, list);
  }
  return rows.map((r) => rowToLead(r, byLead.get(r.id)));
}
