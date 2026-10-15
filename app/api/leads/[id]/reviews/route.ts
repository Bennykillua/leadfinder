import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { getCurrentUser, getLead } from "@/lib/dal";
import { fetchReviews } from "@/lib/reviews";
import { getSerpUsage, SerpApiError } from "@/lib/serpapi";
import { SITE_ID_PREFIX } from "@/lib/audit";

// "Read reviews" on a saved lead found on Google Maps. 1 SerpApi credit unless cached
// (7 days). Stores the sample on the lead; the browser then asks Gemma to re-read.
export async function POST(_req: Request, ctx: RouteContext<"/api/leads/[id]/reviews">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const id = decodeURIComponent((await ctx.params).id);
  const lead = await getLead(user.id, id);
  if (!lead) return Response.json({ ok: false, error: "Lead not found" }, { status: 404 });
  if (lead.id.startsWith(SITE_ID_PREFIX)) {
    return Response.json({ ok: false, error: "Reviews need a Google Maps listing. Look it up on Maps first." }, { status: 400 });
  }
  try {
    const { sample, source } = await fetchReviews(lead.id, user.id);
    await db
      .update(leads)
      .set({ reviewSamples: sample })
      .where(and(eq(leads.userId, user.id), eq(leads.id, lead.id)));
    return Response.json({ ok: true, reviewSamples: sample, source, usage: await getSerpUsage({ refreshAccount: source === "live" }) });
  } catch (err) {
    if (err instanceof SerpApiError) return Response.json({ ok: false, error: err.message }, { status: 502 });
    console.error("[reviews]", err);
    return Response.json({ ok: false, error: "Couldn't fetch reviews. Try again." }, { status: 500 });
  }
}
