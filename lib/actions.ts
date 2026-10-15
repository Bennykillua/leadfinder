"use server";

import { and, eq, min } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { headers } from "next/headers";
import { createSession, deleteSession } from "@/lib/session";
import { hashPassword, verifyPassword, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password";
import { clearAttempts, tooManyAttempts } from "@/lib/rate-limit";import { db } from "@/lib/db";
import { leads, OFFERS, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/dal";
import type { Business, Lead } from "@/lib/leads";
import { getSerpUsage, searchGoogleMaps, SerpApiError, type SearchResult, type SerpUsage } from "@/lib/serpapi";
import { auditByName, auditWebsite } from "@/lib/audit";
import { rerunAuditForUser, type AuditFields } from "@/lib/audit/service";
import { business, column, lead, patch, reminder } from "@/lib/schemas";

// Every action re-reads the session; the client never says whose data it is.

export type LeadPatch = Partial<Pick<Lead, "status" | "pitch" | "notes" | "reminder">>;

function reminderColumns(r: z.infer<typeof reminder> | undefined) {
  if (r === undefined) return {};
  return r ? { reminderAt: new Date(r.at), reminderNote: r.note } : { reminderAt: null, reminderNote: "" };
}

export async function saveLeadAction(input: unknown) {
  const user = await requireUser();
  const { auditedAt, ...b } = business.parse(input);
  // New saves go to the top of Saved.
  const [{ top }] = await db
    .select({ top: min(leads.position) })
    .from(leads)
    .where(and(eq(leads.userId, user.id), eq(leads.status, "saved")));
  await db
    .insert(leads)
    .values({
      ...b,
      auditedAt: auditedAt ? new Date(auditedAt) : null,
      userId: user.id,
      status: "saved",
      position: (top ?? 0) - 1,
    })
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
  const { reminder: r, auditedAt, ...l } = lead.parse(input);
  await db
    .insert(leads)
    .values({
      ...l,
      ...reminderColumns(r),
      auditedAt: auditedAt ? new Date(auditedAt) : null,
      userId: user.id,
      position: z.number().int().parse(position),
    })
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

// --- Sign up / sign in / sign out (email + password, JWT cookie) ---

export type AuthState = { error?: string; email?: string; name?: string };

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const password = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, "Password is too long");

// Compared against when the email doesn't exist, so a wrong email takes as long as a
// wrong password and doesn't reveal which accounts exist.
const DUMMY_HASH = hashPassword("not-a-real-password");

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function signUpAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const raw = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") };
  const parsed = z
    .object({ name: z.string().trim().min(1, "Enter your name").max(100), email, password })
    .safeParse({ ...raw, password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, ...raw };
  if (tooManyAttempts(`signup:${await clientIp()}`, 10, 60 * 60 * 1000)) {
    return { error: "Too many sign-ups from here. Try again later.", ...raw };
  }
  const existing = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) });
  if (existing) return { error: "An account with that email already exists. Sign in instead.", ...raw };

  const [user] = await db
    .insert(users)
    .values({ name: parsed.data.name, email: parsed.data.email, passwordHash: await hashPassword(parsed.data.password) })
    .returning({ id: users.id });
  await createSession(user.id);
  redirect("/welcome");
}

export async function signInAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const raw = { email: String(form.get("email") ?? "") };
  const parsed = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX) }).safeParse({
    ...raw,
    password: form.get("password"),
  });
  const wrong = { error: "Email or password is incorrect.", ...raw };
  if (!parsed.success) return wrong;

  const limitKey = `signin:${parsed.data.email}:${await clientIp()}`;
  if (tooManyAttempts(limitKey, 10, 15 * 60 * 1000)) {
    return { error: "Too many attempts. Wait 15 minutes and try again.", ...raw };
  }
  const user = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) });
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !user.passwordHash || !ok) return wrong;

  clearAttempts(limitKey);
  await createSession(user.id);
  redirect(user.offer ? "/" : "/welcome");
}

export async function signOutAction() {
  await deleteSession();
  redirect("/signin");
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

// --- Audit (website crawl; no SerpApi call except a name lookup) ---

export type AuditTargetResponse =
  | { ok: true; business: Business; usage: SerpUsage | null }
  | { ok: false; error: string; usage: SerpUsage | null };

// Audit card: a website (crawl only) or a business name (SerpApi lookup, then crawl).
export async function auditTargetAction(input: { kind: "url" | "name"; target: string }): Promise<AuditTargetResponse> {
  const user = await requireUser();
  const { kind, target } = z
    .object({ kind: z.enum(["url", "name"]), target: z.string().trim().min(2).max(200) })
    .parse(input);
  const offer = user.offer ?? "other";
  try {
    if (kind === "url") {
      return { ok: true, business: await auditWebsite(target, offer), usage: null };
    }
    const found = await auditByName(target, offer, user.id);
    const usage = await getSerpUsage({ refreshAccount: true });
    if (!found) return { ok: false, error: `Google Maps found no business called “${target}”.`, usage };
    return { ok: true, business: found, usage };
  } catch (err) {
    const usage = kind === "name" ? await getSerpUsage() : null;
    if (err instanceof SerpApiError || (err instanceof Error && kind === "url")) {
      return { ok: false, error: err.message, usage };
    }
    console.error("[audit target]", err);
    return { ok: false, error: "Audit failed. Try again in a moment.", usage };
  }
}

// Board drawer "Re-run audit": crawl again, ignoring the 24-hour crawl cache.
export async function rerunAuditAction(id: string): Promise<AuditFields | null> {
  const user = await requireUser();
  return rerunAuditForUser(user, z.string().parse(id));
}
