"use client";

import { useEffect, useState } from "react";
import { CornerDownLeft, ScanSearch, TriangleAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { auditTargetAction, type AuditTargetResponse } from "@/lib/actions";
import type { SerpUsage } from "@/lib/serpapi";
import { CardHeading, ContactBadge, EvidenceList, Rating, SaveLeadButton, ScoreDots } from "./shared";

type Target = { kind: "url" | "name"; target: string };
type Props = Target & { submitted: boolean; onUsage: (u: SerpUsage) => void };
type State = AuditTargetResponse | { ok: false; error: string; usage: null };

export function AuditCard({ kind, target, submitted, onUsage }: Props) {
  if (!submitted) {
    return (
      <CardHeading
        icon={<ScanSearch />}
        title={target}
        subtitle={
          kind === "url"
            ? "Press Enter to audit this website"
            : "Press Enter to find it on Google Maps, then audit its website"
        }
        aside={
          <kbd className="mt-1 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            <CornerDownLeft className="size-3" />
            Enter
          </kbd>
        }
      />
    );
  }
  return <AuditRun kind={kind} target={target} onUsage={onUsage} />;
}

function AuditRun({ kind, target, onUsage }: Target & { onUsage: (u: SerpUsage) => void }) {
  const [res, setRes] = useState<State | null>(null);

  useEffect(() => {
    let live = true;
    auditTargetAction({ kind, target })
      .then((r) => {
        if (!live) return;
        setRes(r);
        if (r.usage) onUsage(r.usage);
      })
      .catch(() => live && setRes({ ok: false, error: "Audit failed. Check your connection.", usage: null }));
    return () => {
      live = false;
    };
    // onUsage is a stable state setter; the audit runs once per mounted target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, target]);

  if (!res) {
    return (
      <div className="flex flex-col gap-4">
        <CardHeading
          icon={<ScanSearch />}
          title={target}
          subtitle={kind === "url" ? "Checking the website…" : "Looking it up on Google Maps, then checking its website…"}
        />
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-4" />
          ))}
        </div>
      </div>
    );
  }

  if (!res.ok) {
    return (
      <div className="flex flex-col gap-3">
        <CardHeading icon={<ScanSearch />} title={target} subtitle="Audit didn't work" />
        <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {res.error}
        </div>
      </div>
    );
  }

  const b = res.business;
  return (
    <div className="flex flex-col gap-4">
      <CardHeading
        icon={<ScanSearch />}
        title={b.name}
        subtitle={[b.website ?? "No website listed", b.area].filter(Boolean).join(" · ")}
        aside={
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-muted-foreground">Lead score</span>
            <ScoreDots score={b.score} />
          </div>
        }
      />
      <div className="rounded-lg bg-muted/60 p-3">
        <div className="mb-0.5 text-xs font-medium text-muted-foreground">
          Top reason to pitch <span className="font-normal">(provisional until Gemma)</span>
        </div>
        <div className="text-sm font-medium">{b.topReason}</div>
      </div>
      <EvidenceList evidence={b.evidence} className="sm:grid-cols-2" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {b.reviews > 0 && <Rating rating={b.rating} reviews={b.reviews} />}
          <ContactBadge business={b} />
        </div>
        <SaveLeadButton business={b} />
      </div>
    </div>
  );
}
