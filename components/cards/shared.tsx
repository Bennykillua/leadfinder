import { Phone, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WhatsAppLabel } from "@/lib/cards";

export function CardHeading({
  icon,
  title,
  subtitle,
  aside,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium leading-snug">{title}</div>
        {subtitle && <div className="truncate text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {aside}
    </div>
  );
}

export function ScoreDots({ score, className }: { score: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-0.5", className)} aria-label={`Lead score ${score} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn("size-1.5 rounded-full", n <= score ? "bg-emerald-500" : "bg-foreground/15")}
        />
      ))}
    </div>
  );
}

export function Rating({ rating, reviews }: { rating: number; reviews: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Star className="size-3 fill-amber-400 text-amber-400" />
      {rating.toFixed(1)} · {reviews}
    </span>
  );
}

const WA_LABEL: Record<WhatsAppLabel, string> = {
  confirmed: "WhatsApp confirmed",
  likely: "Likely WhatsApp",
  call: "Call only",
};

export function WhatsAppBadge({ label }: { label: WhatsAppLabel }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        label === "confirmed" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
        label === "likely" && "border-emerald-500/20 text-emerald-700/80",
        label === "call" && "text-muted-foreground",
      )}
    >
      {label === "call" && <Phone />}
      {WA_LABEL[label]}
    </Badge>
  );
}

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.04c-.25.69-1.44 1.33-1.98 1.38-.51.05-.98.24-3.3-.69-2.79-1.1-4.56-3.96-4.7-4.14-.13-.18-1.12-1.49-1.12-2.85 0-1.35.71-2.02.96-2.29.25-.28.55-.35.73-.35l.53.01c.17 0 .4-.06.62.48.25.6.84 2.05.91 2.2.07.14.12.31.02.5-.09.18-.14.3-.28.46-.14.16-.29.36-.42.48-.14.14-.28.29-.12.57.16.27.72 1.19 1.55 1.93 1.07.95 1.97 1.25 2.25 1.39.27.14.43.11.6-.07.16-.18.69-.8.87-1.08.18-.27.37-.23.62-.14.25.09 1.6.76 1.87.9.28.13.46.2.53.32.07.11.07.66-.18 1.35Z" />
    </svg>
  );
}
