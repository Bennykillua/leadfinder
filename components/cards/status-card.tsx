"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Stage, StatusData } from "@/lib/cards";
import { CardHeading } from "./shared";

const STAGES: Stage[] = ["New", "Pitched", "Replied", "Interested", "Won", "Dead"];

export function StatusCard({ data }: { data: StatusData }) {
  // Start at the old stage, then slide to the new one so the move is visible.
  const [current, setCurrent] = useState<Stage>(data.from);

  useEffect(() => {
    const t = setTimeout(() => setCurrent(data.to), 450);
    return () => clearTimeout(t);
  }, [data.to]);

  return (
    <div className="flex flex-col gap-4">
      <CardHeading
        icon={<ArrowRightLeft />}
        title={data.business}
        subtitle={`${data.from} → ${data.to} · ${data.note}`}
      />
      <div className="grid grid-cols-6 gap-1 rounded-lg bg-muted/60 p-1">
        {STAGES.map((stage) => (
          <div
            key={stage}
            className={cn(
              "relative rounded-md px-1 py-1.5 text-center text-xs transition-colors",
              stage === current ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {stage === current && (
              <motion.div
                layoutId="status-pill"
                className={cn(
                  "absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-foreground/10",
                  current === "Won" && "bg-emerald-50 ring-emerald-500/30",
                  current === "Dead" && "bg-rose-50 ring-rose-500/30",
                )}
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span className="relative font-medium">{stage}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
