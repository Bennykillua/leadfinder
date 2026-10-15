"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useLeads } from "@/lib/lead-store";

const LINKS = [
  { href: "/", label: "Find" },
  { href: "/board", label: "Board" },
];

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-6 px-4 md:px-6">
      <Link href="/" className="text-sm font-semibold tracking-tight">
        Lead Finder
      </Link>
      {children}
    </header>
  );
}

export function SiteNavSkeleton() {
  return (
    <Shell>
      <div className="h-8 w-36 animate-pulse rounded-full bg-muted" />
    </Shell>
  );
}

export function SiteNav({ user }: { user: { name: string | null; image: string | null } }) {
  const pathname = usePathname();
  const count = useLeads().length;
  return (
    <Shell>
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
      <Link
        href="/settings"
        aria-current={pathname === "/settings" ? "page" : undefined}
        className="ml-auto flex items-center gap-2 rounded-full py-1 pr-1 pl-3 text-sm text-muted-foreground hover:text-foreground"
        title="Settings"
      >
        <span className="hidden sm:inline">{user.name ?? "Settings"}</span>
        {user.image ? (
          // Google profile photo; plain img avoids configuring remote image domains.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {(user.name ?? "?").charAt(0).toUpperCase()}
          </span>
        )}
      </Link>
    </Shell>
  );
}
