import "server-only";
import { db } from "@/lib/db";
import { events, type EventType } from "@/lib/db/schema";

// Record a usage event (npm run stats:usage). Never fails the action it's part of.
export async function track(userId: string, type: EventType) {
  try {
    await db.insert(events).values({ userId, type });
  } catch (err) {
    console.warn(`[events] couldn't record ${type}:`, err);
  }
}
