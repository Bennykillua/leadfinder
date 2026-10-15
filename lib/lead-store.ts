"use client";

// Board state for step 2. Lives in the browser (localStorage) so edits survive a
// reload; SQLite + per-user storage replaces this in step 3.

import { useSyncExternalStore } from "react";
import { newLead, seedLeads, type Business, type Column, type Lead } from "./leads";

// Bump when the Lead shape changes so old browser data is replaced by fresh samples.
const KEY = "leadfinder.leads.v2";
const EMPTY: Lead[] = [];

let leads: Lead[] | null = null;
const listeners = new Set<() => void>();

function read(): Lead[] {
  if (leads) return leads;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    leads = Array.isArray(parsed) ? (parsed as Lead[]) : seedLeads();
  } catch {
    leads = seedLeads();
  }
  return leads;
}

function write(next: Lead[]) {
  leads = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode): keep working in memory.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Server render sees an empty board; the client fills it in after hydration.
export function useLeads(): Lead[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function setLeads(next: Lead[]) {
  write(next);
}

export function saveLead(b: Business) {
  const all = read();
  if (all.some((l) => l.id === b.id)) return;
  write([newLead(b, "saved"), ...all]);
}

export function updateLead(id: string, patch: Partial<Lead>) {
  write(read().map((l) => (l.id === id ? { ...l, ...patch } : l)));
}

export function moveLead(id: string, status: Column) {
  updateLead(id, { status });
}

export function deleteLead(id: string): { lead: Lead; index: number } | null {
  const all = read();
  const index = all.findIndex((l) => l.id === id);
  if (index < 0) return null;
  write(all.filter((l) => l.id !== id));
  return { lead: all[index], index };
}

export function restoreLead(lead: Lead, index: number) {
  const all = read().filter((l) => l.id !== lead.id);
  write([...all.slice(0, index), lead, ...all.slice(index)]);
}

export function resetBoard() {
  write(seedLeads());
}
