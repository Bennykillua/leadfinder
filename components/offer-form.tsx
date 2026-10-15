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

export function OfferForm({
  offer,
  offerDetail,
  next,
}: {
  offer: Offer | null;
  offerDetail: string;
  next: "home" | "settings";
}) {
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
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.saved && !pending && <p className="text-sm text-emerald-700">Saved.</p>}
      <Button type="submit" size="lg" disabled={pending || !choice} className="self-start">
        {pending ? "Saving…" : next === "home" ? "Continue" : "Save"}
      </Button>
    </form>
  );
}
