"use client";

import { useId, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { COLUMNS, type Column, type Lead } from "@/lib/leads";
import { useLeadActions, useLeads } from "@/lib/lead-store";
import { LeadCardView, SortableLeadCard } from "./lead-card";
import { LeadDrawer } from "./lead-drawer";

function columnOf(id: UniqueIdentifier, list: Lead[]): Column | null {
  const col = COLUMNS.find((c) => c.id === id);
  if (col) return col.id;
  return list.find((l) => l.id === id)?.status ?? null;
}

function BoardColumn({
  column,
  leads,
  onOpen,
}: {
  column: (typeof COLUMNS)[number];
  leads: Lead[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      aria-label={column.label}
      className="flex min-h-0 w-[272px] shrink-0 snap-start flex-col rounded-2xl bg-muted/60 p-2 md:w-auto md:min-w-0"
    >
      <header className="flex items-center gap-2 px-2 pt-1 pb-2">
        <h2 className="text-sm font-medium">{column.label}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{leads.length}</span>
      </header>
      <SortableContext id={column.id} items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 flex-col gap-2 rounded-xl transition-colors",
            isOver && leads.length === 0 && "bg-foreground/5",
          )}
        >
          {leads.map((lead) => (
            <SortableLeadCard key={lead.id} lead={lead} onOpen={onOpen} />
          ))}
          {leads.length === 0 && (
            <li className="flex flex-1 items-center justify-center rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              {column.id === "saved" ? "Save leads from Find" : "Drag a lead here"}
            </li>
          )}
        </ul>
      </SortableContext>
    </section>
  );
}

export function Board() {
  const leads = useLeads();
  const { setLeads } = useLeadActions();
  const [draft, setDraft] = useState<Lead[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dndId = useId();

  const items = draft ?? leads;
  const active = activeId ? items.find((l) => l.id === activeId) : null;
  const openLead = openId ? leads.find((l) => l.id === openId) ?? null : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter opens the drawer, so only Space picks a card up.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setDraft(leads);
  }

  // Crossing into another column: move the card there now so the column makes room.
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setDraft((prev) => {
      const list = prev ?? leads;
      const from = columnOf(active.id, list);
      const to = columnOf(over.id, list);
      if (!from || !to || from === to) return list;
      const moving = list.find((l) => l.id === active.id);
      if (!moving) return list;
      const rest = list.filter((l) => l.id !== active.id);
      let index = rest.findIndex((l) => l.id === over.id);
      if (index < 0) index = rest.map((l) => l.status).lastIndexOf(to) + 1;
      rest.splice(index, 0, { ...moving, status: to });
      return rest;
    });
  }

  // Same column: reorder. Either way, commit the draft.
  function onDragEnd({ active, over }: DragEndEvent) {
    let list = draft ?? leads;
    if (over && active.id !== over.id) {
      const a = list.findIndex((l) => l.id === active.id);
      const o = list.findIndex((l) => l.id === over.id);
      if (a >= 0 && o >= 0 && list[a].status === list[o].status) list = arrayMove(list, a, o);
    }
    if (list !== leads) setLeads(list);
    setDraft(null);
    setActiveId(null);
  }

  function onDragCancel() {
    setDraft(null);
    setActiveId(null);
  }

  function open(id: string) {
    setOpenId(id);
    setDrawerOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-end justify-between gap-3 px-4 md:px-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Board</h1>
          <p className="text-sm text-muted-foreground">
            Drag a lead to update its status. Click it for audit, pitch, reminder and notes.
          </p>
        </div>
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex flex-1 snap-x gap-3 overflow-x-auto px-4 pb-6 md:grid md:grid-cols-5 md:px-6">
          {COLUMNS.map((c) => (
            <BoardColumn
              key={c.id}
              column={c}
              leads={items.filter((l) => l.status === c.id)}
              onOpen={open}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? <LeadCardView lead={active} className="rotate-2 cursor-grabbing shadow-lg" /> : null}
        </DragOverlay>
      </DndContext>

      <LeadDrawer lead={openLead} open={drawerOpen && openLead !== null} onOpenChange={setDrawerOpen} />
    </div>
  );
}
