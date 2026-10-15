import { getCurrentUser, getLead } from "@/lib/dal";
import { writePitch } from "@/lib/llm/pitch";
import { LlmError } from "@/lib/llm/ollama";

// Gemma writes a pitch draft. It's returned, not saved: the browser puts it in the
// pitch box and saves it like any edit, so it can't race with the user's typing.
export async function POST(_req: Request, ctx: RouteContext<"/api/leads/[id]/pitch">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const lead = await getLead(user.id, decodeURIComponent((await ctx.params).id));
  if (!lead) return Response.json({ ok: false, error: "Lead not found" }, { status: 404 });
  try {
    const { pitch, evidence } = await writePitch(user, lead);
    return Response.json({ ok: true, pitch, evidence });
  } catch (err) {
    if (err instanceof LlmError) return Response.json({ ok: false, error: err.message, kind: err.kind }, { status: 503 });
    console.error("[pitch]", err);
    return Response.json({ ok: false, error: "Couldn't write a pitch. Try again." }, { status: 500 });
  }
}
