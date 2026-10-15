import { ScanSearch } from "lucide-react";
import type { Business } from "@/lib/leads";
import { CardHeading, EvidenceList, Rating, SaveLeadButton, ScoreDots, ContactBadge } from "./shared";

export function AuditCard({ data }: { data: Business }) {
  return (
    <div className="flex flex-col gap-4">
      <CardHeading
        icon={<ScanSearch />}
        title={data.name}
        subtitle={data.website ?? "No website listed"}
        aside={
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-muted-foreground">Lead score</span>
            <ScoreDots score={data.score} />
          </div>
        }
      />
      <div className="rounded-lg bg-muted/60 p-3">
        <div className="mb-0.5 text-xs font-medium text-muted-foreground">Top reason to pitch</div>
        <div className="text-sm font-medium">{data.topReason}</div>
      </div>
      <EvidenceList evidence={data.evidence} className="sm:grid-cols-2" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Rating rating={data.rating} reviews={data.reviews} />
          <ContactBadge business={data} />
        </div>
        <SaveLeadButton business={data} />
      </div>
    </div>
  );
}
