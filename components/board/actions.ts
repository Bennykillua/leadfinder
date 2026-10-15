"use client";

import { toast } from "sonner";
import { deleteLead, restoreLead } from "@/lib/lead-store";

const UNDO_MS = 5000;

export function deleteWithUndo(id: string) {
  const removed = deleteLead(id);
  if (!removed) return;
  toast(`Deleted ${removed.lead.name}`, {
    duration: UNDO_MS,
    action: { label: "Undo", onClick: () => restoreLead(removed.lead, removed.index) },
  });
}

export function comingSoon(feature: string, detail: string) {
  toast(`${feature}: coming soon`, { description: detail });
}
