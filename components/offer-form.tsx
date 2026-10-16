"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { saveOfferAction, type OfferState } from "@/lib/actions";
import type { Offer } from "@/lib/db/schema";

const CHOICES: { value: Offer; label: string; hint: string }[] = [
  { value: "video", label: "Video editing", hint: "Reels, promos, event videos" },
  { value: "websites", label: "Websites", hint: "Sites, landing pages, booking" },
  { value: "social", label: "Social media", hint: "Content, page management, ads" },
  { value: "other", label: "Something else", hint: "Tell us below" },
];

const NICHE_PLACEHOLDER: Record<Offer, string> = {
  video: "e.g. shortlet and real-estate tours",
  websites: "e.g. clinics and dental practices",
  social: "e.g. restaurants and lounges",
  other: "e.g. fashion brands",
};

export type Profile = {
  offer: Offer | null;
  offerDetail: string;
  niche: string;
  portfolioLinks: string[];
  rate: string;
};

// The freelancer's profile: what they do, their niche, 1–3 links to their work, and
// an optional rate. Used at first sign-in (/welcome) and in Settings.
export function OfferForm({ profile, next }: { profile: Profile; next: "home" | "settings" }) {
  const { offer, offerDetail } = profile;
  const [state, action, pending] = useActionState<OfferState, FormData>(saveOfferAction, {});
  const [choice, setChoice] = useState<Offer | null>(offer);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">What do you sell?</legend>
        {CHOICES.map((c) => (
          <label
            key={c.value}
            className={cn(
              "flex cursor-pointer flex-col gap-0.5 rounded-xl border bg-card p-3 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/40",
              choice === c.value ? "border-foreground/60 bg-muted/60" : "hover:bg-muted/40",
            )}
          >
            <input
              type="radio"
              name="offer"
              value={c.value}
              checked={choice === c.value}
              onChange={() => setChoice(c.value)}
              className="sr-only"
              required
            />
            <span className="text-sm font-medium">{c.label}</span>
            <span className="text-xs text-muted-foreground">{c.hint}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="offerDetail" className="text-sm font-medium">
          {choice === "other" ? "What do you sell?" : "Anything to add? (optional)"}
        </label>
        <Input
          id="offerDetail"
          name="offerDetail"
          defaultValue={offerDetail}
          maxLength={200}
          required={choice === "other"}
          placeholder={choice === "other" ? "e.g. product photography" : "e.g. I mostly do wedding and event reels"}
        />
        <p className="text-xs text-muted-foreground">This shapes what audits look for and how pitches read.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="niche" className="text-sm font-medium">
          Your niche
        </label>
        <Input
          id="niche"
          name="niche"
          defaultValue={profile.niche}
          maxLength={120}
          required
          placeholder={NICHE_PLACEHOLDER[choice ?? "other"]}
        />
        <p className="text-xs text-muted-foreground">Who or what you mostly work on. Used to find people asking for it.</p>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Links to your work (1–3)</legend>
        {[0, 1, 2].map((i) => (
          <Input
            key={i}
            name="portfolio"
            type="text"
            inputMode="url"
            autoComplete="url"
            aria-label={`Portfolio link ${i + 1}`}
            defaultValue={profile.portfolioLinks[i] ?? ""}
            maxLength={300}
            required={i === 0}
            placeholder={i === 0 ? "e.g. instagram.com/yourwork or a Drive folder" : "Another link (optional)"}
          />
        ))}
        <p className="text-xs text-muted-foreground">A pitch may include one of these, so pick your best work.</p>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="rate" className="text-sm font-medium">
          Your rate (optional)
        </label>
        <Input id="rate" name="rate" defaultValue={profile.rate} maxLength={80} placeholder="e.g. from ₦50k per video" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.saved && !pending && <p className="text-sm text-emerald-700">Saved.</p>}
      <Button type="submit" size="lg" disabled={pending || !choice} className="self-start">
        {pending ? "Saving…" : next === "home" ? "Continue" : "Save"}
      </Button>
    </form>
  );
}
