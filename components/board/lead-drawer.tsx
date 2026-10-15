"use client";

import { useEffect, useState, useTransition } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import {
  CalendarDays,
  LoaderCircle,
  Mail,
  MessageSquareQuote,
  PenLine,
  Phone,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAiStatus, useLeadActions } from "@/lib/lead-store";
import { rerunAuditAction } from "@/lib/actions";
import {
  COLUMNS,
  contactKind,
  mailtoLink,
  telLink,
  whatsappLink,
  reviewEvidence,
  whatsappNumber,
  type Evidence,
  type Lead,
  type ReviewSample,
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
import { useDeleteWithUndo } from "./actions";
import { Notes } from "./notes";
import { ConfirmDialog } from "@/components/confirm-dialog";

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

function RerunAuditButton({ lead }: { lead: Lead }) {
  const { applyAudit, runDeepRead } = useLeadActions();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      try {
        const fields = await rerunAuditAction(lead.id);
        if (!fields) throw new Error("not found");
        applyAudit(lead.id, fields);
        // Fresh evidence: Gemma reads it again.
        runDeepRead(lead.id);
        toast.success(`Audit updated for ${lead.name}`);
      } catch {
        toast.error("Couldn't re-run the audit", { description: "Try again in a moment." });
      }
    });
  return (
    <div className="flex items-center gap-2">
      {lead.auditedAt && !pending && (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNowStrict(new Date(lead.auditedAt))} ago
        </span>
      )}
      <Button variant="ghost" size="sm" onClick={run} disabled={pending}>
        <RefreshCw className={cn(pending && "animate-spin")} />
        {pending ? "Checking site…" : lead.auditedAt ? "Re-run audit" : "Run audit"}
      </Button>
    </div>
  );
}

// Gemma hasn't read this lead, or the audit changed since it did.
function needsDeepRead(lead: Lead) {
  return !lead.ai || (!!lead.auditedAt && lead.ai.at < lead.auditedAt);
}

function GemmaRead({ lead, highlight }: { lead: Lead; highlight: Set<string> }) {
  const status = useAiStatus(lead.id);
  const { runDeepRead } = useLeadActions();
  const ai = lead.ai;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-violet-800">
        <Sparkles className="size-3.5" />
        Gemma&apos;s read
        {ai && <ScoreDots score={ai.score} className="ml-1" />}
        {status?.running && (
          <span className="ml-auto inline-flex items-center gap-1 font-normal text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" />
            {ai ? "Updating…" : "Reading the site…"}
          </span>
        )}
      </div>
      {status && !status.running && (
        <div className="flex items-start justify-between gap-3 rounded-md bg-rose-500/10 p-2 text-sm text-rose-800">
          <span>{status.error}</span>
          <Button size="xs" variant="outline" onClick={() => runDeepRead(lead.id)} className="shrink-0 bg-background">
            Retry
          </Button>
        </div>
      )}
      {ai ? (
        <>
          <p className="text-sm font-medium">{ai.topReason}</p>
          {ai.timing.length > 0 && (
            <p
              className={cn(
                "rounded-md bg-sky-500/10 px-2 py-1.5 text-sm text-sky-900",
                highlight.has(ai.timing[0].id) && "ring-1 ring-amber-500/40",
              )}
            >
              <span className="font-medium">Why now? </span>
              {ai.timing[0].detail}
              {ai.timing[0].check && <span className="mt-0.5 block text-xs text-sky-900/70">Check: {ai.timing[0].check}</span>}
            </p>
          )}
          {ai.findings.length > 0 && <EvidenceList evidence={ai.findings} highlight={highlight} />}
          <p className="text-xs text-muted-foreground">
            {ai.model} · {formatDistanceToNowStrict(new Date(ai.at))} ago
          </p>
        </>
      ) : (
        !status && <p className="text-sm text-muted-foreground">Waiting for Gemma…</p>
      )}
    </div>
  );
}

function Reviews({ lead, highlight }: { lead: Lead; highlight: Set<string> }) {
  const { applyReviews, runDeepRead } = useLeadActions();
  const [loading, setLoading] = useState(false);
  const sample = lead.reviewSamples;
  const fromMaps = !lead.id.startsWith("site:");
  // "Now" read once on mount (render must stay pure); only decides the "free" hint.
  const [mountedAt] = useState(() => Date.now());
  const fresh = !!sample && mountedAt - Date.parse(sample.fetchedAt) < 7 * 86_400_000;

  async function read() {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(lead.id)}/reviews`, { method: "POST" });
      const data = (await res.json()) as
        | { ok: true; reviewSamples: ReviewSample; source: "live" | "cache" }
        | { ok: false; error: string };
      if (!data.ok) {
        toast.error("Couldn't read reviews", { description: data.error, duration: 8000 });
        return;
      }
      applyReviews(lead.id, data.reviewSamples);
      toast.success(
        data.reviewSamples.items.length ? `Read ${data.reviewSamples.items.length} reviews` : "No written reviews found",
        { description: data.source === "cache" ? "From the 7-day cache, no credit used." : "Used 1 SerpApi credit." },
      );
      // New evidence: Gemma reads the lead again with the reviews.
      if (data.reviewSamples.items.length) runDeepRead(lead.id);
    } catch {
      toast.error("Couldn't read reviews", { description: "Check your connection." });
    } finally {
      setLoading(false);
    }
  }

  if (!fromMaps) {
    return <p className="text-sm text-muted-foreground">Reviews need a Google Maps listing.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {sample
            ? `${sample.items.length} lowest-rated reviews, newest first · fetched ${formatDistanceToNowStrict(new Date(sample.fetchedAt))} ago`
            : "Lowest-rated Google reviews, for Gemma to read."}
        </span>
        <Button size="sm" variant="outline" onClick={read} disabled={loading} className="shrink-0">
          {loading ? <LoaderCircle className="animate-spin" /> : <MessageSquareQuote />}
          {loading ? "Reading…" : sample ? "Refresh" : "Read reviews"}
          {!loading && <span className="text-xs text-muted-foreground">{fresh ? "free" : "1 credit"}</span>}
        </Button>
      </div>
      {sample && sample.items.length > 0 && (
        <EvidenceList evidence={sample.items.map(reviewEvidence)} highlight={highlight} />
      )}
    </div>
  );
}

function WritePitchButton({ lead }: { lead: Lead }) {
  const { updateLead } = useLeadActions();
  const [writing, setWriting] = useState(false);
  async function write() {
    setWriting(true);
    const previous = lead.pitch;
    const previousEvidence = lead.pitchEvidence;
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(lead.id)}/pitch`, { method: "POST" });
      const data = (await res.json()) as
        | { ok: true; pitch: string; evidence: Evidence[] }
        | { ok: false; error: string };
      if (!data.ok) {
        toast.error("Couldn't write a pitch", { description: data.error, duration: 8000 });
        return;
      }
      // Saved like any edit, so it can't race with what the user was typing.
      updateLead(lead.id, { pitch: data.pitch, pitchEvidence: data.evidence });
      toast.success("Gemma wrote a draft. Check it before sending.", {
        action: previous.trim()
          ? { label: "Undo", onClick: () => updateLead(lead.id, { pitch: previous, pitchEvidence: previousEvidence }) }
          : undefined,
      });
    } catch {
      toast.error("Couldn't write a pitch", { description: "Check your connection." });
    } finally {
      setWriting(false);
    }
  }
  return (
    <Button variant="ghost" size="sm" onClick={write} disabled={writing}>
      {writing ? <LoaderCircle className="animate-spin" /> : <PenLine />}
      {writing ? "Writing…" : lead.pitch.trim() ? "Rewrite pitch" : "Write pitch"}
    </Button>
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
  const { updateLead, runDeepRead } = useLeadActions();
  const deleteWithUndo = useDeleteWithUndo();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const aiStatus = useAiStatus(lead?.id ?? "");
  // Evidence the current pitch draft cited: highlighted everywhere it appears.
  const pitchIds = new Set((lead?.pitchEvidence ?? []).map((e) => e.id));

  // Opening a lead Gemma hasn't read (or whose audit changed) starts a read. Not after
  // an error: that waits for Retry, so a stopped Ollama doesn't loop.
  const shouldRead = open && !!lead && needsDeepRead(lead) && !aiStatus;
  const leadId = lead?.id;
  useEffect(() => {
    if (shouldRead && leadId) runDeepRead(leadId);
  }, [shouldRead, leadId, runDeepRead]);

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
                <ScoreDots score={lead.ai?.score ?? lead.score} />
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
                <RerunAuditButton lead={lead} />
              }
            >
              <GemmaRead lead={lead} highlight={pitchIds} />
              {lead.topReason && (
                <div className="rounded-lg bg-muted/60 p-3">
                  <div className="mb-0.5 text-xs font-medium text-muted-foreground">
                    Rule-based reason <span className="font-normal">(score {lead.score ?? "-"})</span>
                  </div>
                  <div className="text-sm">{lead.topReason}</div>
                </div>
              )}
              {lead.evidence.length > 0 ? (
                <EvidenceList evidence={lead.evidence} highlight={pitchIds} />
              ) : (
                <p className="text-sm text-muted-foreground">Not audited yet. Run the audit to check the website.</p>
              )}
            </Section>

            <Section title="Reviews">
              <Reviews lead={lead} highlight={pitchIds} />
            </Section>

            <Section
              title="Pitch"
              action={
                <WritePitchButton lead={lead} />
              }
            >
              <Textarea
                aria-label="Pitch message"
                value={lead.pitch}
                onChange={(e) => updateLead(lead.id, { pitch: e.target.value })}
                placeholder="Write pitch asks Gemma for a draft. Edit it freely before sending."
                rows={6}
                className="resize-y leading-relaxed"
              />
              <span className="text-xs text-muted-foreground">
                {lead.pitch.trim() ? lead.pitch.trim().split(/\s+/).length : 0} words · {lead.pitch.length} characters
              </span>
              {lead.pitchEvidence.length > 0 && lead.pitch.trim() && (
                <div className="flex flex-col gap-1.5 rounded-lg bg-amber-500/5 p-2.5 ring-1 ring-amber-500/30">
                  <span className="text-xs font-medium text-amber-900">Evidence this draft uses: check it before sending</span>
                  <EvidenceList evidence={lead.pitchEvidence} />
                </div>
              )}
              <ContactButtons lead={lead} />
            </Section>

            <Section title="Reminder">
              <ReminderEditor key={lead.id} lead={lead} />
            </Section>

            <Section title={lead.notes.length > 0 ? `Notes (${lead.notes.length})` : "Notes"}>
              <Notes key={lead.id} lead={lead} />
            </Section>

            <div className="border-t px-4 py-4">
              <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 />
                Delete lead
              </Button>
              <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={`Delete ${lead.name}?`}
                description="This removes the lead with its pitch, reminder and notes. You'll have 5 seconds to undo."
                confirmLabel="Delete lead"
                onConfirm={() => {
                  onOpenChange(false);
                  deleteWithUndo(lead.id);
                }}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
