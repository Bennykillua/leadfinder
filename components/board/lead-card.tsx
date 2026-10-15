"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BellRing, Ellipsis, NotebookPen, PanelRightOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatShort, isOverdue } from "@/lib/dates";
import type { Lead } from "@/lib/leads";
import { ScoreDots, ContactBadge } from "@/components/cards/shared";
import { useDeleteWithUndo } from "./actions";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function LeadCardView({
  lead,
  menu,
  className,
}: {
  lead: Lead;
  menu?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl bg-card p-3 text-left text-sm shadow-xs ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-medium leading-snug">{lead.name}</span>
        <ScoreDots score={lead.ai?.score ?? lead.score} className="mt-1.5 shrink-0" />
        {menu}
      </div>
      {(lead.ai?.topReason || lead.topReason) && (
        <p className="line-clamp-2 text-muted-foreground">{lead.ai?.topReason || lead.topReason}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <ContactBadge business={lead} />
        {lead.notes.length > 0 && (
          <span
            className="inline-flex h-5 items-center gap-1 text-xs text-muted-foreground"
            title={`${lead.notes.length} ${lead.notes.length === 1 ? "note" : "notes"}`}
          >
            <NotebookPen className="size-3" />
            {lead.notes.length}
          </span>
        )}
        {lead.reminder && (
          <span
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-4xl px-2 text-xs font-medium",
              isOverdue(lead.reminder.at)
                ? "bg-rose-500/10 text-rose-700"
                : "bg-amber-500/10 text-amber-800",
            )}
          >
            <BellRing className="size-3" />
            {formatShort(lead.reminder.at)}
          </span>
        )}
      </div>
    </div>
  );
}

export function SortableLeadCard({ lead, onOpen }: { lead: Lead; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="Lead card. Press Space to move it, Enter to open it."
      onClick={() => onOpen(lead.id)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter") onOpen(lead.id);
      }}
      className={cn(
        "cursor-grab touch-manipulation rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/40 active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <LeadCardView
        lead={lead}
        className="transition-shadow hover:shadow-sm"
        menu={<LeadCardMenu lead={lead} onOpen={onOpen} />}
      />
    </li>
  );
}

// Lives inside the draggable card, so it stops pointer and key events from
// starting a drag or opening the drawer.
function LeadCardMenu({ lead, onOpen }: { lead: Lead; onOpen: (id: string) => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const deleteWithUndo = useDeleteWithUndo();
  const [confirming, setConfirming] = useState(false);
  return (
    <div onPointerDown={stop} onClick={stop} onKeyDown={stop} className="-mt-1 -mr-1.5 shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${lead.name}`} />}
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onOpen(lead.id)}>
            <PanelRightOpen />
            Open
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
            <Trash2 />
            Delete lead
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Inside the wrapper so its clicks don't reach the draggable card. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${lead.name}?`}
        description="This removes the lead with its pitch, reminder and notes. You'll have 5 seconds to undo."
        confirmLabel="Delete lead"
        onConfirm={() => deleteWithUndo(lead.id)}
      />
    </div>
  );
}
