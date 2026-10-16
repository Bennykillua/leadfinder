import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { db } from "@/lib/db";
import { leads, notes, users, type Offer } from "@/lib/db/schema";
import type { Lead, Note } from "@/lib/leads";
import { rowToLead } from "@/lib/lead-rows";

// Data access layer: every read and write resolves the user from the session here,
// never from anything the client sends.

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string | null;
  offer: Offer | null;
  offerDetail: string;
  niche: string;
  portfolioLinks: string[];
  rate: string;
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
    niche: row.niche,
    portfolioLinks: row.portfolioLinks ?? [],
    rate: row.rate,
  };
}

// Signed in, any state.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user;
}

// Signed in and has a profile: what they sell and at least one portfolio link.
export function isOnboarded(user: CurrentUser) {
  return Boolean(user.offer) && user.portfolioLinks.length > 0;
}

export async function requireOnboardedUser(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isOnboarded(user)) redirect("/welcome");
  return user;
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
