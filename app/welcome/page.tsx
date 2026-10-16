import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { isOnboarded, requireUser } from "@/lib/dal";
import { OfferForm } from "@/components/offer-form";

export const metadata: Metadata = { title: "Welcome · Lead Finder" };

export default function WelcomePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-[12vh] pb-16">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight">What do you do?</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          A short profile, then you&apos;re in. You can change it later in Settings.
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
  if (isOnboarded(user)) redirect("/");
  return <OfferForm profile={user} next="home" />;
}
