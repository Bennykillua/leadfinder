import { BellRing, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReminderData } from "@/lib/cards";
import { CardHeading } from "./shared";

export function ReminderCard({ data }: { data: ReminderData }) {
  return (
    <div className="flex flex-col gap-3">
      <CardHeading icon={<BellRing />} title={`Follow up ${data.business}`} subtitle={data.note} />
      <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 p-3">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="size-4 text-muted-foreground" />
          {data.when}
        </span>
        <Button size="sm" variant="outline">
          Save reminder
        </Button>
      </div>
    </div>
  );
}
