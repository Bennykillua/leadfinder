import "server-only";
import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { db } from "@/lib/db";
import { leads, users, type Offer } from "@/lib/db/schema";
import type { Lead } from "@/lib/leads";

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

export function rowToLead(r: LeadRow): Lead {
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
    score: r.score,
    auditedAt: r.auditedAt ? r.auditedAt.toISOString() : null,
    topReason: r.topReason,
    evidence: r.evidence,
    status: r.status,
    pitch: r.pitch,
    notes: r.notes,
    reminder: r.reminderAt ? { at: r.reminderAt.toISOString(), note: r.reminderNote } : null,
  };
}

export async function listLeads(userId: string): Promise<Lead[]> {
  const rows = await db
    .select()
    .from(leads)
    .where(eq(leads.userId, userId))
    .orderBy(asc(leads.position), asc(leads.createdAt));
  return rows.map(rowToLead);
}
