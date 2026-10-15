"use client";

import { toast } from "sonner";
import { useLeadActions } from "@/lib/lead-store";

const UNDO_MS = 5000;

export function useDeleteWithUndo() {
  const { deleteLead, restoreLead } = useLeadActions();
  return (id: string) => {
    const removed = deleteLead(id);
    if (!removed) return;
    toast(`Deleted ${removed.lead.name}`, {
      duration: UNDO_MS,
      action: { label: "Undo", onClick: () => restoreLead(removed.lead, removed.index) },
    });
  };
}

export function comingSoon(feature: string, detail: string) {
  toast(`${feature}: coming soon`, { description: detail });
}
