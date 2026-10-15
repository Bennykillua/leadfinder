"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CalendarDays, Mail, PenLine, Phone, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLeadActions } from "@/lib/lead-store";
import {
  COLUMNS,
  contactKind,
  mailtoLink,
  telLink,
  whatsappLink,
  whatsappNumber,
  type Lead,
} from "@/lib/leads";
import { DATE_FORMAT, DEFAULT_HOUR, TIME_FORMAT, isOverdue, parseDateText } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  ContactBadge,
  EvidenceList,
  Rating,
  ScoreDots,
  WhatsAppIcon,
} from "@/components/cards/shared";
import { comingSoon, useDeleteWithUndo } from "./actions";

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 border-t px-4 py-4">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ContactButtons({ lead }: { lead: Lead }) {
  const wa = whatsappNumber(lead);
  const showEmail = lead.email !== null && contactKind(lead) !== "confirmed";
  const nothing = !wa && !lead.email;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {nothing && lead.phone && (
          <Button variant="outline" nativeButton={false} render={<a href={telLink(lead)} />}>
            <Phone />
            Call {lead.phone}
          </Button>
        )}
        {showEmail && (
          <Button variant="outline" nativeButton={false} render={<a href={mailtoLink(lead, lead.pitch)} />}>
            <Mail />
            Open in email
          </Button>
        )}
        {wa ? (
          <Button
            nativeButton={false}
            render={<a href={whatsappLink(wa, lead.pitch)} target="_blank" rel="noopener noreferrer" />}
            className="bg-emerald-600 text-white hover:bg-emerald-600/90"
          >
            <WhatsAppIcon className="size-4" />
            Open in WhatsApp
          </Button>
        ) : (
          <Tooltip>
            {/* Disabled buttons swallow pointer events, so the span carries the tooltip. */}
            <TooltipTrigger render={<span tabIndex={0} className="rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/40" />}>
              <Button disabled tabIndex={-1}>
                <WhatsAppIcon className="size-4" />
                Open in WhatsApp
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {lead.whatsapp === "call" && lead.phone
                ? `${lead.phone} is a landline, so it can't receive WhatsApp.`
                : "No WhatsApp-capable number found for this business."}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {nothing && (
        <p className="text-right text-xs text-muted-foreground">No WhatsApp or email found</p>
      )}
      {showEmail && lead.email && (
        <p className="text-right text-xs text-muted-foreground">Email from their website: {lead.email}</p>
      )}
    </div>
  );
}

// One date picker, one time picker, one note, one delete. The summary line is built
// from the same value and formats as the pickers, so it always matches them.
function ReminderEditor({ lead }: { lead: Lead }) {
  const { updateLead } = useLeadActions();
  const [dateOpen, setDateOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const reminder = lead.reminder;
  const at = reminder ? new Date(reminder.at) : null;
  const parsed = typed.trim() ? parseDateText(typed) : null;

  function commit(next: Date) {
    updateLead(lead.id, { reminder: { at: next.toISOString(), note: reminder?.note ?? "" } });
  }

  function pickDay(day: Date | undefined) {
    if (!day) return;
    const next = new Date(day);
    next.setHours(at?.getHours() ?? DEFAULT_HOUR, at?.getMinutes() ?? 0, 0, 0);
    commit(next);
    setDateOpen(false);
  }

  function applyTyped() {
    if (!parsed) return;
    const next = new Date(parsed.date);
    if (!parsed.hasTime) next.setHours(at?.getHours() ?? DEFAULT_HOUR, at?.getMinutes() ?? 0, 0, 0);
    commit(next);
    setTyped("");
    setDateOpen(false);
  }

  function pickTime(value: string) {
    const [h, m] = value.split(":").map(Number);
    if (!at || Number.isNaN(h) || Number.isNaN(m)) return;
    const next = new Date(at);
    next.setHours(h, m, 0, 0);
    commit(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Popover
          open={dateOpen}
          onOpenChange={(open) => {
            setDateOpen(open);
            if (!open) setTyped("");
          }}
        >
          <PopoverTrigger
            render={<Button variant="outline" className={cn(!at && "text-muted-foreground")} />}
          >
            <CalendarDays />
            {at ? format(at, DATE_FORMAT) : "Pick a date"}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <form
              className="flex flex-col gap-1 border-b p-2"
              onSubmit={(e) => {
                e.preventDefault();
                applyTyped();
              }}
            >
              <Input
                aria-label="Type a date"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="or type: next Tuesday 3pm"
                className="h-8"
              />
              {typed.trim() && (
                <span className="px-1 text-xs text-muted-foreground">
                  {parsed
                    ? `Enter → ${format(parsed.date, DATE_FORMAT)}${parsed.hasTime ? ` at ${format(parsed.date, TIME_FORMAT)}` : ""}`
                    : "No date found in that"}
                </span>
              )}
            </form>
            <Calendar mode="single" selected={at ?? undefined} defaultMonth={at ?? undefined} onSelect={pickDay} />
          </PopoverContent>
        </Popover>
        <Input
          type="time"
          aria-label="Reminder time"
          value={at ? format(at, TIME_FORMAT) : ""}
          onChange={(e) => pickTime(e.target.value)}
          disabled={!at}
          className="w-28"
        />
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => updateLead(lead.id, { reminder: null })}
          disabled={!reminder}
          aria-label="Delete reminder"
          title="Delete reminder"
        >
          <Trash2 />
        </Button>
      </div>
      <Input
        aria-label="Reminder note"
        placeholder={at ? "call the manager" : "Pick a date first"}
        value={reminder?.note ?? ""}
        onChange={(e) => reminder && updateLead(lead.id, { reminder: { ...reminder, note: e.target.value } })}
        disabled={!reminder}
        maxLength={80}
      />
      <p
        className={cn(
          "text-xs",
          reminder && isOverdue(reminder.at) ? "text-rose-700" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {reminder && at
          ? `${isOverdue(reminder.at) ? "Overdue: " : ""}${format(at, DATE_FORMAT)} at ${format(at, TIME_FORMAT)}${reminder.note.trim() ? ` · ${reminder.note.trim()}` : ""}`
          : "No reminder set"}
      </p>
    </div>
  );
}

export function LeadDrawer({
  lead,
  open,
  onOpenChange,
}: {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { updateLead } = useLeadActions();
  const deleteWithUndo = useDeleteWithUndo();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md data-[side=right]:sm:max-w-md">
        {lead && (
          <>
            <SheetHeader className="gap-1.5 pr-12">
              <SheetTitle className="text-lg">{lead.name}</SheetTitle>
              <SheetDescription>
                {lead.category} · {lead.area}
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="rounded-4xl bg-muted px-2 py-0.5 text-xs font-medium">
                  {COLUMNS.find((c) => c.id === lead.status)?.label}
                </span>
                <ScoreDots score={lead.score} />
                <Rating rating={lead.rating} reviews={lead.reviews} />
                <ContactBadge business={lead} />
              </div>
              <div className="text-xs text-muted-foreground">
                {lead.phone || "No phone"} · {lead.website ?? "No website"}
              </div>
            </SheetHeader>

            <Section
              title="Audit"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => comingSoon("Re-run audit", "Real website checks arrive in step 5.")}
                >
                  <RefreshCw />
                  Re-run audit
                </Button>
              }
            >
              {lead.topReason && (
                <div className="rounded-lg bg-muted/60 p-3">
                  <div className="mb-0.5 text-xs font-medium text-muted-foreground">Top reason to pitch</div>
                  <div className="font-medium">{lead.topReason}</div>
                </div>
              )}
              {lead.evidence.length > 0 ? (
                <EvidenceList evidence={lead.evidence} />
              ) : (
                <p className="text-sm text-muted-foreground">Not audited yet. Website checks arrive in step 5.</p>
              )}
            </Section>

            <Section
              title="Pitch"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => comingSoon("Write pitch", "Gemma drafts pitches in step 6. Type your own for now.")}
                >
                  <PenLine />
                  Write pitch
                </Button>
              }
            >
              <Textarea
                aria-label="Pitch message"
                value={lead.pitch}
                onChange={(e) => updateLead(lead.id, { pitch: e.target.value })}
                placeholder="Write your pitch here. Name one specific problem from the audit."
                rows={6}
                className="resize-y leading-relaxed"
              />
              <span className="text-xs text-muted-foreground">{lead.pitch.length} characters</span>
              <ContactButtons lead={lead} />
            </Section>

            <Section title="Reminder">
              <ReminderEditor key={lead.id} lead={lead} />
            </Section>

            <Section title="Notes">
              <Textarea
                aria-label="Notes"
                value={lead.notes}
                onChange={(e) => updateLead(lead.id, { notes: e.target.value })}
                placeholder="Spoke to the manager, call back after the 20th."
                rows={4}
                className="resize-y"
              />
            </Section>

            <div className="border-t px-4 py-4">
              <Button
                variant="destructive"
                onClick={() => {
                  onOpenChange(false);
                  deleteWithUndo(lead.id);
                }}
              >
                <Trash2 />
                Delete lead
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
