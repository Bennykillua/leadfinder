import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/dal";
import { signOutAction } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { OfferForm } from "@/components/offer-form";

export const metadata: Metadata = { title: "Settings · Lead Finder" };

export default function SettingsPage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-8 pb-16">
      <div className="flex w-full max-w-lg flex-col gap-8">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
          <SettingsBody />
        </Suspense>
      </div>
    </main>
  );
}

async function SettingsBody() {
  const user = await requireUser();
  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">What do you sell?</h2>
        <OfferForm offer={user.offer} offerDetail={user.offerDetail} next="settings" />
      </section>
      <section className="flex items-center justify-between gap-4 border-t pt-6">
        <div className="text-sm">
          <div className="font-medium">{user.name}</div>
          <div className="text-muted-foreground">{user.email}</div>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </section>
    </>
  );
}
