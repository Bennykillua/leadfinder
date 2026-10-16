"use server";

import { and, eq, min } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { headers } from "next/headers";
import { createSession, deleteSession } from "@/lib/session";
import { hashPassword, needsRehash, verifyPassword, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/password";
import { backoffRemaining, clearFailures, recordFailure, tooManyAttempts } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { leads, notes, OFFERS, users } from "@/lib/db/schema";
import { requireUser } from "@/lib/dal";
import { track } from "@/lib/events";
import type { Business, Column, Lead } from "@/lib/leads";
import { getSerpUsage, searchGoogleMaps, SerpApiError, type SearchResult, type SerpUsage } from "@/lib/serpapi";
import { auditByName, auditWebsite } from "@/lib/audit";
import { rerunAuditForUser, type AuditFields } from "@/lib/audit/service";
import { business, column, lead, note, noteBody, patch, reminder } from "@/lib/schemas";

// Every action re-reads the session; the client never says whose data it is.

export type LeadPatch = Partial<Pick<Lead, "status" | "pitch" | "reminder" | "pitchEvidence">>;

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
  const inserted = await db
    .insert(leads)
    .values({
      ...b,
      auditedAt: auditedAt ? new Date(auditedAt) : null,
      userId: user.id,
      status: "saved",
      position: (top ?? 0) - 1,
    })
    .onConflictDoNothing()
    .returning({ id: leads.id });
  if (inserted.length) await track(user.id, "lead_saved");
}

// Moving a lead into Replied or Won is a usage event (from the drawer or a drag).
async function trackMoves(userId: string, before: Map<string, Column>, after: { id: string; status: Column }[]) {
  for (const { id, status } of after) {
    if (before.get(id) === status || !before.has(id)) continue;
    if (status === "replied") await track(userId, "moved_replied");
    if (status === "won") await track(userId, "moved_won");
  }
}

async function statusesOf(userId: string) {
  const rows = await db.select({ id: leads.id, status: leads.status }).from(leads).where(eq(leads.userId, userId));
  return new Map(rows.map((r) => [r.id, r.status]));
}

export async function updateLeadAction(id: string, input: LeadPatch) {
  const user = await requireUser();
  const { reminder: r, ...rest } = patch.parse(input);
  const before = rest.status ? await statusesOf(user.id) : null;
  await db
    .update(leads)
    .set({ ...rest, ...reminderColumns(r) })
    .where(and(eq(leads.userId, user.id), eq(leads.id, id)));
  if (before && rest.status) await trackMoves(user.id, before, [{ id, status: rest.status }]);
}

// The board sends its full order after a drag; positions are rewritten to match.
export async function reorderLeadsAction(input: unknown) {
  const user = await requireUser();
  const items = z.array(z.object({ id: z.string(), status: column })).max(2000).parse(input);
  const before = await statusesOf(user.id);
  await db.transaction(async (tx) => {
    for (const [position, item] of items.entries()) {
      await tx
        .update(leads)
        .set({ status: item.status, position })
        .where(and(eq(leads.userId, user.id), eq(leads.id, item.id)));
    }
  });
  await trackMoves(user.id, before, items);
}

export async function deleteLeadAction(id: string) {
  const user = await requireUser();
  const leadId = z.string().parse(id);
  // Notes go with the lead (explicitly, not relying on SQLite foreign-key settings).
  await db.batch([
    db.delete(notes).where(and(eq(notes.userId, user.id), eq(notes.leadId, leadId))),
    db.delete(leads).where(and(eq(leads.userId, user.id), eq(leads.id, leadId))),
  ]);
}

// Undo after delete: put the lead back exactly as it was.
export async function restoreLeadAction(input: unknown, position: number) {
  const user = await requireUser();
  const { reminder: r, auditedAt, notes: leadNotes, ai, reviewSamples, pitchEvidence, ...l } = lead.parse(input);
  await db
    .insert(leads)
    .values({
      ...l,
      ...reminderColumns(r),
      aiScore: ai?.score ?? null,
      aiTopReason: ai?.topReason ?? null,
      aiFindings: ai?.findings ?? null,
      aiTiming: ai?.timing ?? null,
      reviewSamples,
      pitchEvidence,
      aiModel: ai?.model ?? null,
      aiAt: ai ? new Date(ai.at) : null,
      auditedAt: auditedAt ? new Date(auditedAt) : null,
      userId: user.id,
      position: z.number().int().parse(position),
    })
    .onConflictDoNothing();
  if (leadNotes.length > 0) {
    await db
      .insert(notes)
      .values(
        leadNotes.map((n) => ({
          id: n.id,
          userId: user.id,
          leadId: l.id,
          body: n.body,
          createdAt: new Date(n.createdAt),
          updatedAt: new Date(n.updatedAt),
        })),
      )
      .onConflictDoNothing();
  }
}

// --- Notes (many per lead) ---

// The client makes the id so the note shows instantly; the server checks the lead
// belongs to this user before storing it.
export async function addNoteAction(leadId: string, input: unknown) {
  const user = await requireUser();
  const n = note.parse(input);
  const owned = await db.query.leads.findFirst({
    where: and(eq(leads.userId, user.id), eq(leads.id, z.string().parse(leadId))),
    columns: { id: true },
  });
  if (!owned) throw new Error("Lead not found");
  await db
    .insert(notes)
    .values({ ...n, userId: user.id, leadId, createdAt: new Date(n.createdAt), updatedAt: new Date(n.updatedAt) })
    .onConflictDoNothing();
}

export async function updateNoteAction(id: string, body: string) {
  const user = await requireUser();
  await db
    .update(notes)
    .set({ body: noteBody.parse(body), updatedAt: new Date() })
    .where(and(eq(notes.userId, user.id), eq(notes.id, z.uuid().parse(id))));
}

export async function deleteNoteAction(id: string) {
  const user = await requireUser();
  await db.delete(notes).where(and(eq(notes.userId, user.id), eq(notes.id, z.uuid().parse(id))));
}

const MAX_PORTFOLIO_LINKS = 3;

// "vimeo.com/tolu" → "https://vimeo.com/tolu". Only public http(s) web addresses.
function portfolioLink(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname)) return null;
  return url.toString().replace(/\/$/, "");
}

const profileForm = z
  .object({
    offer: z.enum(OFFERS, { error: "Pick what you do" }),
    offerDetail: z.string().trim().max(200),
    niche: z.string().trim().min(2, "Add your niche (who or what you mostly work on)").max(120),
    links: z.array(z.string().max(300, "That link is too long")).max(MAX_PORTFOLIO_LINKS),
    rate: z.string().trim().max(80, "Keep the rate short"),
  })
  .refine((v) => v.offer !== "other" || v.offerDetail.length > 0, {
    message: "Tell us what you do",
    path: ["offerDetail"],
  });

export type OfferState = { error?: string; saved?: boolean };

export async function saveOfferAction(_prev: OfferState, form: FormData): Promise<OfferState> {
  const user = await requireUser();
  const parsed = profileForm.safeParse({
    offer: form.get("offer"),
    offerDetail: form.get("offerDetail") ?? "",
    niche: form.get("niche") ?? "",
    links: form.getAll("portfolio").map(String),
    rate: form.get("rate") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  const { links, ...profile } = parsed.data;
  const filled = links.map((l) => l.trim()).filter(Boolean);
  const portfolioLinks: string[] = [];
  for (const raw of filled) {
    const link = portfolioLink(raw);
    if (!link) return { error: `"${raw}" isn't a web link. Paste the full address, e.g. https://vimeo.com/yourname` };
    if (!portfolioLinks.includes(link)) portfolioLinks.push(link);
  }
  if (portfolioLinks.length === 0) return { error: "Add at least one link to your work" };
  await db
    .update(users)
    .set({ ...profile, portfolioLinks })
    .where(eq(users.id, user.id));
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
  await track(user.id, "signup");
  await createSession(user.id);
  redirect("/welcome");
}

const SIGNIN_MAX_FAILURES = 5;
const SIGNIN_BACKOFF_MS = 15 * 60 * 1000;

export async function signInAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const raw = { email: String(form.get("email") ?? "") };
  const parsed = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX) }).safeParse({
    ...raw,
    password: form.get("password"),
  });
  const wrong = { error: "Email or password is incorrect.", ...raw };
  if (!parsed.success) return wrong;

  // Short backoff on failed passwords, never a permanent lock:
  // - per account (regardless of IP, so a changed or spoofed IP can't buy more
  //   guesses): 5 failures in 15 minutes → wait 15 minutes;
  // - per IP (one client spraying many accounts): 50 failures → wait 15 minutes.
  const accountKey = `signin:email:${parsed.data.email}`;
  const ipKey = `signin:ip:${await clientIp()}`;
  const waitMs = Math.max(backoffRemaining(accountKey), backoffRemaining(ipKey));
  if (waitMs > 0) {
    const minutes = Math.ceil(waitMs / 60_000);
    return {
      error: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      ...raw,
    };
  }
  const user = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) });
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !user.passwordHash || !ok) {
    recordFailure(accountKey, SIGNIN_MAX_FAILURES, SIGNIN_BACKOFF_MS);
    recordFailure(ipKey, 50, SIGNIN_BACKOFF_MS);
    return wrong;
  }

  clearFailures(accountKey);
  if (needsRehash(user.passwordHash)) {
    await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, user.id));
  }
  await createSession(user.id);
  redirect(user.offer && user.portfolioLinks.length > 0 ? "/" : "/welcome");
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
    await track(user.id, "search");
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
      const { business: audited } = await auditWebsite(target, offer);
      await track(user.id, "audit");
      return { ok: true, business: audited, usage: null };
    }
    const found = await auditByName(target, offer, user.id);
    const usage = await getSerpUsage({ refreshAccount: true });
    if (!found) return { ok: false, error: `Google Maps found no business called “${target}”.`, usage };
    await track(user.id, "audit");
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
  const fields = await rerunAuditForUser(user, z.string().parse(id));
  if (fields) await track(user.id, "audit");
  return fields;
}
