import { z } from "zod";
import { getCurrentUser } from "@/lib/dal";
import { track } from "@/lib/events";

// Clicks the server can't see: "Open in WhatsApp" and "Open in email" leave the app.
// Sent with navigator.sendBeacon, so the click isn't delayed. Only these two types.
const body = z.object({ type: z.enum(["open_whatsapp", "open_email"]) });

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  await track(user.id, parsed.data.type);
  return new Response(null, { status: 204 });
}
