import { getCurrentUser, getLead } from "@/lib/dal";
import { deepReadOnce } from "@/lib/llm/deep-read";
import { LlmError } from "@/lib/llm/generate";

// Gemma's deep read of a saved lead. A route handler, not a server action: a model
// call can take a minute, and server actions run one at a time per page, so it would
// hold up every other save.
export async function POST(_req: Request, ctx: RouteContext<"/api/leads/[id]/deep-read">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const lead = await getLead(user.id, decodeURIComponent((await ctx.params).id));
  if (!lead) return Response.json({ ok: false, error: "Lead not found" }, { status: 404 });
  try {
    return Response.json({ ok: true, ai: await deepReadOnce(user, lead) });
  } catch (err) {
    if (err instanceof LlmError) return Response.json({ ok: false, error: err.message, kind: err.kind }, { status: 503 });
    console.error("[deep-read]", err);
    return Response.json({ ok: false, error: "Gemma's read failed. Try again." }, { status: 500 });
  }
}
