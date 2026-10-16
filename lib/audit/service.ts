import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import type { CurrentUser } from "@/lib/dal";
import { rowToLead } from "@/lib/lead-rows";
import type { Business } from "@/lib/leads";
import { auditBusiness, auditFields, type AuditFields } from "./index";

export type { AuditFields };

async function storeOnLead(userId: string, id: string, f: AuditFields) {
  await db
    .update(leads)
    .set({ ...f, auditedAt: f.auditedAt ? new Date(f.auditedAt) : null })
    .where(and(eq(leads.userId, userId), eq(leads.id, id)));
}

// Audit a search result for this user. If they already saved it, the saved lead is
// updated too.
export async function auditForUser(user: CurrentUser, b: Business): Promise<AuditFields> {
  const { business: audited } = await auditBusiness(b, user.offer ?? "other");
  const fields = auditFields(audited);
  await storeOnLead(user.id, b.id, fields);
  return fields;
}

// "Re-run audit" on a saved lead: crawl again, ignoring the 24-hour crawl cache.
export async function rerunAuditForUser(user: CurrentUser, id: string): Promise<AuditFields | null> {
  const row = await db.query.leads.findFirst({ where: and(eq(leads.userId, user.id), eq(leads.id, id)) });
  if (!row) return null;
  const { business: audited } = await auditBusiness(rowToLead(row), user.offer ?? "other", { force: true, pagespeed: true });
  const fields = auditFields(audited);
  await storeOnLead(user.id, id, fields);
  return fields;
}
