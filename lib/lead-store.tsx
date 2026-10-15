"use client";

// The signed-in user's leads on the client. The server loads them once per visit;
// every change shows immediately and is written to the database in the background.

import { createContext, use, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  addNoteAction,
  deleteNoteAction,
  updateNoteAction,
  deleteLeadAction,
  reorderLeadsAction,
  restoreLeadAction,
  saveLeadAction,
  updateLeadAction,
  type LeadPatch,
} from "./actions";
import { newLead, type AiRead, type Business, type Lead, type ReviewSample } from "./leads";
import { DEFAULT_HOUR, formatShort } from "./dates";
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
  addNote: (leadId: string, body: string) => void;
  updateNote: (leadId: string, noteId: string, body: string) => void;
  deleteNote: (leadId: string, noteId: string) => void;
  // Gemma's deep read of a saved lead, in the background. Safe to call repeatedly:
  // a lead already being read isn't read twice.
  runDeepRead: (id: string) => void;
  // Merge reviews the server already stored on the lead.
  applyReviews: (id: string, sample: ReviewSample) => void;
};

// Moving a lead to Pitched sets a follow-up this many days later (if it has none).
const FOLLOW_UP_DAYS = 3;

// Per-lead state of Gemma's deep read, for the drawer.
export type AiStatus = { running: true } | { running: false; error: string; kind?: string };

const LeadsContext = createContext<Lead[] | null>(null);
const ActionsContext = createContext<Actions | null>(null);
const AiStatusContext = createContext<Record<string, AiStatus>>({});

type DeepReadResponse = { ok: true; ai: AiRead } | { ok: false; error: string; kind?: string };

export function LeadsProvider({ initial, children }: { initial: Lead[]; children: React.ReactNode }) {
  const [leads, setState] = useState(initial);
  const [aiStatus, setAiStatus] = useState<Record<string, AiStatus>>({});
  const aiRunning = useRef(new Set<string>());
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

  const runDeepRead = useCallback(
    (id: string) => {
      if (aiRunning.current.has(id)) return;
      aiRunning.current.add(id);
      setAiStatus((s) => ({ ...s, [id]: { running: true } }));
      fetch(`/api/leads/${encodeURIComponent(id)}/deep-read`, { method: "POST" })
        .then((res) => res.json() as Promise<DeepReadResponse>)
        .catch((): DeepReadResponse => ({ ok: false, error: "Couldn't reach the server. Check your connection." }))
        .then((res) => {
          aiRunning.current.delete(id);
          if (res.ok) {
            commit(current.current.map((l) => (l.id === id ? { ...l, ai: res.ai } : l)));
            setAiStatus((s) => {
              const next = { ...s };
              delete next[id];
              return next;
            });
          } else {
            setAiStatus((s) => ({ ...s, [id]: { running: false, error: res.error, kind: res.kind } }));
          }
        });
    },
    [commit],
  );

  const actions = useMemo<Actions>(
    () => ({
      saveLead(b) {
        if (current.current.some((l) => l.id === b.id)) return;
        commit([newLead(b), ...current.current]);
        enqueue(async () => {
          await saveLeadAction(b);
          // Saved: let Gemma read it now, so the board has its take when opened.
          runDeepRead(b.id);
        });
      },

      runDeepRead,

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
        // Newly pitched leads without a reminder get a follow-up in 3 days.
        const before = new Map(current.current.map((l) => [l.id, l.status]));
        const due = new Date();
        due.setDate(due.getDate() + FOLLOW_UP_DAYS);
        due.setHours(DEFAULT_HOUR, 0, 0, 0);
        const followUp = { at: due.toISOString(), note: "Follow up on the pitch" };
        const newlyPitched = new Set(
          next.filter((l) => l.status === "pitched" && before.get(l.id) !== "pitched" && !l.reminder).map((l) => l.id),
        );
        const withFollowUps = newlyPitched.size
          ? next.map((l) => (newlyPitched.has(l.id) ? { ...l, reminder: followUp } : l))
          : next;
        commit(withFollowUps);
        enqueue(() => reorderLeadsAction(withFollowUps.map((l) => ({ id: l.id, status: l.status }))));
        for (const id of newlyPitched) {
          enqueue(() => updateLeadAction(id, { reminder: followUp }));
          const lead = withFollowUps.find((l) => l.id === id)!;
          toast(`Follow-up set for ${formatShort(followUp.at)}`, {
            description: lead.name,
            action: {
              label: "Undo",
              onClick: () => {
                commit(current.current.map((l) => (l.id === id ? { ...l, reminder: null } : l)));
                enqueue(() => updateLeadAction(id, { reminder: null }));
              },
            },
          });
        }
      },

      applyReviews(id, sample) {
        commit(current.current.map((l) => (l.id === id ? { ...l, reviewSamples: sample } : l)));
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

      addNote(leadId, body) {
        const now = new Date().toISOString();
        const note = { id: crypto.randomUUID(), body: body.trim(), createdAt: now, updatedAt: now };
        commit(current.current.map((l) => (l.id === leadId ? { ...l, notes: [note, ...l.notes] } : l)));
        enqueue(() => addNoteAction(leadId, note));
      },

      updateNote(leadId, noteId, body) {
        const updatedAt = new Date().toISOString();
        commit(
          current.current.map((l) =>
            l.id === leadId
              ? { ...l, notes: l.notes.map((n) => (n.id === noteId ? { ...n, body: body.trim(), updatedAt } : n)) }
              : l,
          ),
        );
        enqueue(() => updateNoteAction(noteId, body));
      },

      deleteNote(leadId, noteId) {
        commit(
          current.current.map((l) => (l.id === leadId ? { ...l, notes: l.notes.filter((n) => n.id !== noteId) } : l)),
        );
        enqueue(() => deleteNoteAction(noteId));
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
    [commit, enqueue, flush, runDeepRead],
  );

  return (
    <ActionsContext value={actions}>
      <AiStatusContext value={aiStatus}>
        <LeadsContext value={leads}>{children}</LeadsContext>
      </AiStatusContext>
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

export function useAiStatus(id: string): AiStatus | undefined {
  return use(AiStatusContext)[id];
}
