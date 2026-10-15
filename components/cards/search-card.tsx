"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { formatDistanceToNowStrict } from "date-fns";
import { ChevronDown, CornerDownLeft, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { searchMapsAction, type SearchResponse } from "@/lib/actions";
import type { Business } from "@/lib/leads";
import type { SerpUsage } from "@/lib/serpapi";
import { CardHeading, ContactBadge, Rating, SaveLeadButton, ScoreDots } from "./shared";

// Quota rule: one page per search (about 20), show the top 10, reveal the rest locally.
const TOP = 10;

type Props = { query: string; submitted: boolean; onUsage: (u: SerpUsage) => void };
type State = SearchResponse | { ok: false; error: string };

export function SearchCard({ query, submitted, onUsage }: Props) {
  // Searching costs a SerpApi credit, so it only happens on Enter, never while typing.
  if (!submitted) {
    return (
      <CardHeading
        icon={<Search />}
        title={query}
        subtitle="Press Enter to search Google Maps"
        aside={
          <kbd className="mt-1 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            <CornerDownLeft className="size-3" />
            Enter
          </kbd>
        }
      />
    );
  }
  return <SearchResults query={query} onUsage={onUsage} />;
}

function sourceLabel(res: Extract<SearchResponse, { ok: true }>) {
  const n = res.results.length;
  const found = `${n} ${n === 1 ? "business" : "businesses"}`;
  if (res.source === "live") return `${found} · live from Google Maps`;
  if (res.source === "cache") {
    return `${found} · cached ${formatDistanceToNowStrict(new Date(res.fetchedAt))} ago, no credit used`;
  }
  return `${found} · fixture “${res.query}”, no credit used`;
}

function SearchResults({ query, onUsage }: { query: string; onUsage: (u: SerpUsage) => void }) {
  const [res, setRes] = useState<State | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let live = true;
    searchMapsAction(query)
      .then((r) => {
        if (!live) return;
        setRes(r);
        onUsage(r.usage);
      })
      .catch(() => {
        if (live) setRes({ ok: false, error: "Search failed. Check your connection." });
      });
    return () => {
      live = false;
    };
    // onUsage is a stable state setter; the search runs once per mounted query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  if (!res) {
    return (
      <div className="flex flex-col gap-3">
        <CardHeading icon={<Search />} title={query} subtitle="Searching Google Maps…" />
        <ul className="flex flex-col divide-y divide-border/60" aria-busy>
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="flex flex-col gap-1.5 py-2.5 first:pt-0">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3.5 w-1/3" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!res.ok) {
    return (
      <div className="flex flex-col gap-3">
        <CardHeading icon={<Search />} title={query} subtitle="Search didn't work" />
        <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {res.error}
        </div>
      </div>
    );
  }

  const visible = expanded ? res.results : res.results.slice(0, TOP);
  const hidden = res.results.length - visible.length;

  return (
    <div className="flex flex-col gap-3">
      <CardHeading icon={<Search />} title={query} subtitle={sourceLabel(res)} />
      {res.results.length === 0 ? (
        <p className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
          Google Maps found nothing for that. Try a broader area or another word for the business.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {visible.map((b, i) => (
            <motion.li
              key={b.id}
              initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.3, ease: "easeOut", delay: (i >= TOP ? i - TOP : i) * 0.06 }}
              className="py-2.5 first:pt-0 last:pb-0"
            >
              <ResultRow business={b} />
            </motion.li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)} className="self-center">
          <ChevronDown />
          Show {hidden} more
        </Button>
      )}
    </div>
  );
}

function ResultRow({ business: b }: { business: Business }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{b.name}</span>
          <ScoreDots score={b.score} className="shrink-0" />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {[b.category, b.area].filter(Boolean).join(" · ")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {b.reviews > 0 ? (
            <Rating rating={b.rating} reviews={b.reviews} />
          ) : (
            <span className="text-xs text-muted-foreground">No reviews</span>
          )}
          <ContactBadge business={b} />
        </div>
      </div>
      <SaveLeadButton business={b} />
    </div>
  );
}
