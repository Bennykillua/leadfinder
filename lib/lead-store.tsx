"use client";

// The signed-in user's leads on the client. The server loads them once per visit;
// every change shows immediately and is written to the database in the background.

import { createContext, use, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  deleteLeadAction,
  reorderLeadsAction,
  restoreLeadAction,
  saveLeadAction,
  updateLeadAction,
  type LeadPatch,
} from "./actions";
import { newLead, type Business, type Lead } from "./leads";
import type { AuditFields } from "./audit";

// Typing in pitch or notes saves after a short pause instead of on every key.
const SAVE_DELAY_MS = 400;

type Actions = {
  saveLead: (b: Business) => void;
  updateLead: (id: string, patch: LeadPatch) => void;
  setLeads: (next: Lead[]) => void;
  deleteLead: (id: string) => { lead: Lead; index: number } | null;
  restoreLead: (lead: Lead, index: number) => void;
  // Merge audit results the server already stored on the lead (no write from here).
  applyAudit: (id: string, fields: AuditFields) => void;
};

const LeadsContext = createContext<Lead[] | null>(null);
const ActionsContext = createContext<Actions | null>(null);

export function LeadsProvider({ initial, children }: { initial: Lead[]; children: React.ReactNode }) {
  const [leads, setState] = useState(initial);
  const current = useRef(initial);
  // Writes run one after another so an Undo can't overtake its delete.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(new Map<string, { patch: LeadPatch; timer: ReturnType<typeof setTimeout> }>());

  const commit = useCallback((next: Lead[]) => {
    current.current = next;
    setState(next);
  }, []);

  const enqueue = useCallback((write: () => Promise<unknown>) => {
    queue.current = queue.current.then(write).catch(() => {
      toast.error("Couldn't save that change", { description: "Check your connection and reload." });
    });
  }, []);

  const flush = useCallback(
    (id: string) => {
      const p = pending.current.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.current.delete(id);
      enqueue(() => updateLeadAction(id, p.patch));
    },
    [enqueue],
  );

  const actions = useMemo<Actions>(
    () => ({
      saveLead(b) {
        if (current.current.some((l) => l.id === b.id)) return;
        commit([newLead(b), ...current.current]);
        enqueue(() => saveLeadAction(b));
      },

      updateLead(id, patch) {
        commit(current.current.map((l) => (l.id === id ? { ...l, ...patch } : l)));
        const prev = pending.current.get(id);
        if (prev) clearTimeout(prev.timer);
        pending.current.set(id, {
          patch: { ...prev?.patch, ...patch },
          timer: setTimeout(() => flush(id), SAVE_DELAY_MS),
        });
      },

      setLeads(next) {
        commit(next);
        enqueue(() => reorderLeadsAction(next.map((l) => ({ id: l.id, status: l.status }))));
      },

      deleteLead(id) {
        const all = current.current;
        const index = all.findIndex((l) => l.id === id);
        if (index < 0) return null;
        flush(id);
        commit(all.filter((l) => l.id !== id));
        enqueue(() => deleteLeadAction(id));
        return { lead: all[index], index };
      },

      applyAudit(id, fields) {
        if (!current.current.some((l) => l.id === id)) return;
        commit(current.current.map((l) => (l.id === id ? { ...l, ...fields } : l)));
      },

      restoreLead(lead, index) {
        const rest = current.current.filter((l) => l.id !== lead.id);
        const next = [...rest.slice(0, index), lead, ...rest.slice(index)];
        commit(next);
        enqueue(async () => {
          await restoreLeadAction(lead, index);
          await reorderLeadsAction(next.map((l) => ({ id: l.id, status: l.status })));
        });
      },
    }),
    [commit, enqueue, flush],
  );

  return (
    <ActionsContext value={actions}>
      <LeadsContext value={leads}>{children}</LeadsContext>
    </ActionsContext>
  );
}

export function useLeads(): Lead[] {
  const leads = use(LeadsContext);
  if (!leads) throw new Error("useLeads must be used inside LeadsProvider");
  return leads;
}

export function useLeadActions(): Actions {
  const actions = use(ActionsContext);
  if (!actions) throw new Error("useLeadActions must be used inside LeadsProvider");
  return actions;
}
