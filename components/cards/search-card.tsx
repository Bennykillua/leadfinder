"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Business } from "@/lib/leads";
import { CardHeading, Rating, SaveLeadButton, ScoreDots, ContactBadge } from "./shared";

// Fake the "skeleton, then fill row by row" feel. Real results arrive in step 4.
const ROW_DELAY_MS = 220;
const TOP = 10;

export function SearchCard({ data }: { data: { query: string; results: Business[] } }) {
  const [shown, setShown] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? data.results : data.results.slice(0, TOP);
  const hidden = data.results.length - visible.length;
  const loading = shown < Math.min(TOP, data.results.length);

  useEffect(() => {
    const timers = data.results
      .slice(0, TOP)
      .map((_, i) => setTimeout(() => setShown(i + 1), 450 + i * ROW_DELAY_MS));
    return () => timers.forEach(clearTimeout);
  }, [data.results]);

  return (
    <div className="flex flex-col gap-3">
      <CardHeading
        icon={<Search />}
        title={data.query || "Search"}
        subtitle={
          loading
            ? `Finding businesses… ${shown}/${Math.min(TOP, data.results.length)}`
            : `${data.results.length} businesses · showing ${visible.length}`
        }
      />
      <ul className="flex flex-col divide-y divide-border/60">
        {visible.map((b, i) => (
          <li key={b.id} className="py-2.5 first:pt-0 last:pb-0">
            <AnimatePresence mode="popLayout" initial={false}>
              {i < shown || i >= TOP ? (
                <motion.div
                  key="row"
                  initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.3, ease: "easeOut", delay: i >= TOP ? (i - TOP) * 0.05 : 0 }}
                  className="flex items-center gap-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{b.name}</span>
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.5 }}
                        className="shrink-0"
                        title={b.topReason}
                      >
                        <ScoreDots score={b.score} />
                      </motion.span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {b.category} · {b.area}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Rating rating={b.rating} reviews={b.reviews} />
                      <ContactBadge business={b} />
                    </div>
                  </div>
                  <SaveLeadButton business={b} />
                </motion.div>
              ) : (
                <motion.div key="skeleton" exit={{ opacity: 0 }} className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                  <Skeleton className="h-3.5 w-1/3" />
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        ))}
      </ul>
      {!loading && hidden > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} className="self-center">
          <ChevronDown />
          Show {hidden} more
        </Button>
      )}
    </div>
  );
}
