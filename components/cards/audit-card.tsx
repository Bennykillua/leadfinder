import { Check, Globe, ScanSearch, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuditData } from "@/lib/cards";
import { CardHeading, ScoreDots } from "./shared";

export function AuditCard({ data }: { data: AuditData }) {
  return (
    <div className="flex flex-col gap-4">
      <CardHeading
        icon={<ScanSearch />}
        title={data.business}
        subtitle={data.url ?? "No website listed"}
        aside={
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-muted-foreground">Lead score</span>
            <ScoreDots score={data.score} />
          </div>
        }
      />
      <ul className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {data.evidence.map((e) => (
          <li key={e.label} className="flex items-start gap-2 text-sm">
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full [&_svg]:size-3",
                e.ok ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700",
              )}
            >
              {e.ok ? <Check /> : <X />}
            </span>
            <span className="min-w-0">
              <span className="font-medium">{e.label}</span>{" "}
              <span className="text-muted-foreground">{e.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Globe className="size-3" /> Suggested pitch
        </div>
        {data.pitch}
      </div>
    </div>
  );
}
