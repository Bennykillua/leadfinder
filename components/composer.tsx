"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { CornerDownLeft, ScanSearch, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD_TYPES, classify, fakeCard, type CardData, type Intent } from "@/lib/cards";
import { SearchCard } from "./cards/search-card";
import { AuditCard } from "./cards/audit-card";

// Same pause the spec gives Gemma; keyword rules stand in for it in step 1.
const DEBOUNCE_MS = 300;

const SPRING: Transition = { type: "spring", bounce: 0.18, duration: 0.55 };

const ICONS: Record<Intent, React.ComponentType<{ className?: string }>> = {
  search: Search,
  audit: ScanSearch,
};

const LABELS: Record<Intent, string> = Object.fromEntries(
  CARD_TYPES.map((c) => [c.intent, c.label]),
) as Record<Intent, string>;

function useMeasuredHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.borderBoxSize[0].blockSize));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, height] as const;
}

function CardBody({ card }: { card: CardData }) {
  switch (card.intent) {
    case "search":
      return <SearchCard key={card.data.query} data={card.data} />;
    case "audit":
      return <AuditCard data={card.data} />;
  }
}

export function Composer() {
  const [text, setText] = useState("");
  const [settled, setSettled] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [contentRef, height] = useMeasuredHeight<HTMLDivElement>();

  useEffect(() => {
    const t = setTimeout(() => setSettled(text), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const slash = text.startsWith("/");
  const filter = text.slice(1).trim().toLowerCase();
  const menu = slash
    ? CARD_TYPES.filter(
        (c) => c.label.toLowerCase().includes(filter) || c.example.toLowerCase().includes(filter),
      )
    : [];
  const activeIndex = Math.min(active, Math.max(menu.length - 1, 0));

  const intent = slash ? null : classify(settled);
  const card = useMemo(() => (intent ? fakeCard(intent, settled) : null), [intent, settled]);
  const open = slash || card !== null;
  const Icon = intent ? ICONS[intent] : slash ? Sparkles : Search;

  function choose(i: number) {
    const pick = menu[i];
    if (!pick) return;
    setText(pick.example);
    setSettled(pick.example);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setText("");
      setSettled("");
      return;
    }
    if (!slash || menu.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % menu.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((activeIndex - 1 + menu.length) % menu.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(activeIndex);
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <motion.div
        initial={false}
        animate={{
          height: height ?? "auto",
          maxWidth: open ? 640 : 520,
          borderRadius: open ? 20 : 28,
        }}
        transition={SPRING}
        className={cn(
          "relative w-full overflow-hidden border bg-card text-card-foreground",
          "shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-8px_rgb(0_0_0/0.12)]",
          "focus-within:ring-3 focus-within:ring-ring/20",
        )}
      >
        <div ref={contentRef} className="relative">
          <div className="flex h-14 items-center gap-3 px-4">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={intent ?? (slash ? "slash" : "idle")}
                initial={{ opacity: 0, scale: 0.6, filter: "blur(4px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.6, filter: "blur(4px)" }}
                transition={{ duration: 0.2 }}
                className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
              >
                <Icon className="size-4.5" />
              </motion.span>
            </AnimatePresence>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="event centres in Lekki…"
              aria-label="Tell Lead Finder what you need"
              autoFocus
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70"
            />
            <AnimatePresence mode="popLayout" initial={false}>
              {intent ? (
                <motion.span
                  key={intent}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  {LABELS[intent]}
                </motion.span>
              ) : !text ? (
                <motion.kbd
                  key="slash-hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="shrink-0 rounded-md border px-1.5 font-mono text-xs text-muted-foreground"
                >
                  /
                </motion.kbd>
              ) : null}
            </AnimatePresence>
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            {slash ? (
              <motion.ul
                key="menu"
                role="listbox"
                aria-label="Card types"
                initial={{ opacity: 0, filter: "blur(6px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(6px)" }}
                transition={{ duration: 0.25 }}
                className="border-t p-1.5"
              >
                {menu.length === 0 && (
                  <li className="px-3 py-2.5 text-sm text-muted-foreground">Nothing matches “{filter}”</li>
                )}
                {menu.map((c, i) => {
                  const ItemIcon = ICONS[c.intent];
                  const isActive = i === activeIndex;
                  return (
                    <li
                      key={c.intent}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(i);
                      }}
                      className="relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5"
                    >
                      {isActive && (
                        <motion.span
                          layoutId="menu-highlight"
                          className="absolute inset-0 rounded-xl bg-muted"
                          transition={{ type: "spring", bounce: 0.15, duration: 0.3 }}
                        />
                      )}
                      <ItemIcon className="relative size-4 text-muted-foreground" />
                      <span className="relative min-w-0 flex-1">
                        <span className="text-sm font-medium">{c.label}</span>{" "}
                        <span className="text-sm text-muted-foreground">{c.hint}</span>
                        <span className="block truncate text-xs text-muted-foreground/80">
                          “{c.example}”
                        </span>
                      </span>
                      {isActive && (
                        <CornerDownLeft className="relative size-3.5 text-muted-foreground" />
                      )}
                    </li>
                  );
                })}
              </motion.ul>
            ) : card ? (
              <motion.div
                key={card.intent}
                initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -4, filter: "blur(6px)" }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="border-t p-4"
              >
                <CardBody card={card} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </motion.div>

      <p className="text-center text-xs text-muted-foreground">
        Type a request, or press <kbd className="rounded border px-1 font-mono">/</kbd> to see every card.
        <span className="hidden sm:inline"> Esc clears.</span>
      </p>
    </div>
  );
}
