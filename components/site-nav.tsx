"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useLeads } from "@/lib/lead-store";

const LINKS = [
  { href: "/", label: "Find" },
  { href: "/board", label: "Board" },
];

export function SiteNav() {
  const pathname = usePathname();
  const count = useLeads().length;
  return (
    <header className="flex h-14 shrink-0 items-center gap-6 px-4 md:px-6">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Lead Finder
      </Link>
      <nav className="flex items-center gap-1 rounded-full bg-muted p-1">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors",
                active ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l.label}
              {l.href === "/board" && count > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
