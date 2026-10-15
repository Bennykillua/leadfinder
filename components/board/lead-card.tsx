"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BellRing, Ellipsis, PanelRightOpen, Trash2 } from "lucide-react";
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
import { deleteWithUndo } from "./actions";

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
        <ScoreDots score={lead.score} className="mt-1.5 shrink-0" />
        {menu}
      </div>
      <p className="line-clamp-2 text-muted-foreground">{lead.topReason}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <ContactBadge business={lead} />
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
          <DropdownMenuItem variant="destructive" onClick={() => deleteWithUndo(lead.id)}>
            <Trash2 />
            Delete lead
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
