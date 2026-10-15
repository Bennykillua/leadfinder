import { getCurrentUser } from "@/lib/dal";
import { auditForUser } from "@/lib/audit/service";
import { business } from "@/lib/schemas";

// Background audit of one search result. A route handler rather than a server action
// because the Search card runs three of these at once, and server actions run one at
// a time per page.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = business.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    return Response.json(await auditForUser(user, parsed.data));
  } catch (err) {
    console.error("[audit]", parsed.data.website, err);
    return Response.json({ error: "Audit failed" }, { status: 500 });
  }
}
