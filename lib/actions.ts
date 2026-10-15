"use server";

import { and, eq, min } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { leads, OFFERS, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/dal";
import type { Column, Lead } from "@/lib/leads";
import { getSerpUsage, searchGoogleMaps, SerpApiError, type SearchResult, type SerpUsage } from "@/lib/serpapi";

// Every action re-reads the session; the client never says whose data it is.

const column = z.enum(["saved", "pitched", "replied", "won", "lost"] satisfies Column[]);

const business = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  category: z.string().max(200),
  area: z.string().max(300),
  phone: z.string().max(40),
  whatsapp: z.enum(["confirmed", "likely", "call"]),
  rating: z.number().min(0).max(5),
  reviews: z.number().int().min(0),
  website: z.string().max(500).nullable(),
  email: z.string().email().max(200).nullable(),
  score: z.number().int().min(1).max(5).nullable(),
  topReason: z.string().max(500),
  evidence: z.array(z.object({ label: z.string().max(100), ok: z.boolean(), detail: z.string().max(300) })).max(30),
});

const reminder = z.object({ at: z.iso.datetime(), note: z.string().max(200) }).nullable();

const lead = business.extend({
  status: column,
  pitch: z.string().max(5000),
  notes: z.string().max(10000),
  reminder,
});

const patch = z
  .object({
    status: column,
    pitch: z.string().max(5000),
    notes: z.string().max(10000),
    reminder,
  })
  .partial();

export type LeadPatch = Partial<Pick<Lead, "status" | "pitch" | "notes" | "reminder">>;

function reminderColumns(r: z.infer<typeof reminder> | undefined) {
  if (r === undefined) return {};
  return r ? { reminderAt: new Date(r.at), reminderNote: r.note } : { reminderAt: null, reminderNote: "" };
}

export async function saveLeadAction(input: unknown) {
  const user = await requireUser();
  const b = business.parse(input);
  // New saves go to the top of Saved.
  const [{ top }] = await db
    .select({ top: min(leads.position) })
    .from(leads)
    .where(and(eq(leads.userId, user.id), eq(leads.status, "saved")));
  await db
    .insert(leads)
    .values({ ...b, userId: user.id, status: "saved", position: (top ?? 0) - 1 })
    .onConflictDoNothing();
}

export async function updateLeadAction(id: string, input: LeadPatch) {
  const user = await requireUser();
  const { reminder: r, ...rest } = patch.parse(input);
  await db
    .update(leads)
    .set({ ...rest, ...reminderColumns(r) })
    .where(and(eq(leads.userId, user.id), eq(leads.id, id)));
}

// The board sends its full order after a drag; positions are rewritten to match.
export async function reorderLeadsAction(input: unknown) {
  const user = await requireUser();
  const items = z.array(z.object({ id: z.string(), status: column })).max(2000).parse(input);
  await db.transaction(async (tx) => {
    for (const [position, item] of items.entries()) {
      await tx
        .update(leads)
        .set({ status: item.status, position })
        .where(and(eq(leads.userId, user.id), eq(leads.id, item.id)));
    }
  });
}

export async function deleteLeadAction(id: string) {
  const user = await requireUser();
  await db.delete(leads).where(and(eq(leads.userId, user.id), eq(leads.id, z.string().parse(id))));
}

// Undo after delete: put the lead back exactly as it was.
export async function restoreLeadAction(input: unknown, position: number) {
  const user = await requireUser();
  const { reminder: r, ...l } = lead.parse(input);
  await db
    .insert(leads)
    .values({ ...l, ...reminderColumns(r), userId: user.id, position: z.number().int().parse(position) })
    .onConflictDoNothing();
}

const offerForm = z
  .object({
    offer: z.enum(OFFERS),
    offerDetail: z.string().trim().max(200),
  })
  .refine((v) => v.offer !== "other" || v.offerDetail.length > 0, {
    message: "Tell us what you sell",
    path: ["offerDetail"],
  });

export type OfferState = { error?: string; saved?: boolean };

export async function saveOfferAction(_prev: OfferState, form: FormData): Promise<OfferState> {
  const user = await requireUser();
  const parsed = offerForm.safeParse({
    offer: form.get("offer"),
    offerDetail: form.get("offerDetail") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Pick what you sell" };
  await db.update(users).set(parsed.data).where(eq(users.id, user.id));
  if (form.get("next") === "settings") return { saved: true };
  redirect("/");
}

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}

// --- Search (SerpApi) ---

export type SearchResponse =
  | ({ ok: true; usage: SerpUsage } & SearchResult)
  | { ok: false; error: string; usage: SerpUsage };

export async function searchMapsAction(input: string): Promise<SearchResponse> {
  const user = await requireUser();
  const query = z.string().trim().min(2).max(120).parse(input);
  try {
    const result = await searchGoogleMaps(query, user.id);
    const usage = await getSerpUsage({ refreshAccount: result.source === "live" });
    return { ok: true, ...result, usage };
  } catch (err) {
    const usage = await getSerpUsage();
    if (err instanceof SerpApiError) return { ok: false, error: err.message, usage };
    console.error("[search]", err);
    return { ok: false, error: "Search failed. Try again in a moment.", usage };
  }
}

export async function getSerpUsageAction(): Promise<SerpUsage> {
  await requireUser();
  return getSerpUsage();
}
