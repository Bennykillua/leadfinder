import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/dal";
import { OfferForm } from "@/components/offer-form";

export const metadata: Metadata = { title: "Welcome · Lead Finder" };

export default function WelcomePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-[12vh] pb-16">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight">What do you sell?</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          One question, then you&apos;re in. You can change it later in Settings.
        </p>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
          <Question />
        </Suspense>
      </div>
    </main>
  );
}

async function Question() {
  const user = await requireUser();
  if (user.offer) redirect("/");
  return <OfferForm offer={null} offerDetail="" next="home" />;
}
