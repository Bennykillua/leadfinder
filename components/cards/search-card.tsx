"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { SearchData } from "@/lib/cards";
import { CardHeading, Rating, ScoreDots, WhatsAppBadge } from "./shared";

// Fake the "skeleton, then fill row by row" feel. Real results arrive in step 2.
const ROW_DELAY_MS = 280;

export function SearchCard({ data }: { data: SearchData }) {
  const [shown, setShown] = useState(0);
  const total = data.results.length;

  useEffect(() => {
    const timers = data.results.map((_, i) =>
      setTimeout(() => setShown(i + 1), 450 + i * ROW_DELAY_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [data.results]);

  return (
    <div className="flex flex-col gap-3">
      <CardHeading
        icon={<Search />}
        title={data.query || "Search"}
        subtitle={shown < total ? `Finding businesses… ${shown}/${total}` : `${total} businesses, audited`}
      />
      <ul className="flex flex-col divide-y divide-border/60">
        {data.results.map((lead, i) => (
          <li key={lead.name} className="py-2.5 first:pt-0 last:pb-0">
            <AnimatePresence mode="popLayout" initial={false}>
              {i < shown ? (
                <motion.div
                  key="row"
                  initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="flex flex-col gap-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{lead.name}</span>
                    <ScoreDots score={lead.score} className="ml-auto shrink-0" />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {lead.category} · {lead.area}
                  </div>
                  <div className="text-sm">{lead.topReason}</div>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <Rating rating={lead.rating} reviews={lead.reviews} />
                    <WhatsAppBadge label={lead.whatsapp} />
                  </div>
                </motion.div>
              ) : (
                <motion.div key="skeleton" exit={{ opacity: 0 }} className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                  <Skeleton className="h-3.5 w-4/5" />
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>
    </div>
  );
}
