import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import { signInWithGoogle } from "@/lib/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in · Lead Finder" };

export default function SignInPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 pb-24">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Lead Finder</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find Lagos businesses, see what&apos;s weak online, and work them from pitch to won.
          </p>
        </div>
        <form action={signInWithGoogle} className="w-full">
          <Button type="submit" size="lg" variant="outline" className="w-full">
            <GoogleIcon />
            Continue with Google
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">Your leads, reminders and notes are private to your account.</p>
      </div>
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
    </main>
  );
}

async function RedirectIfSignedIn() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return null;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.5 5.5 0 0 1-2.39 3.62v3h3.86c2.26-2.09 3.58-5.17 3.58-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.86-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l3.98-3.1Z" />
      <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.94 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.87 8.87 4.76 12 4.76Z" />
    </svg>
  );
}
