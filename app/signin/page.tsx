import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Sign in · Lead Finder" };

export default function SignInPage() {
  return (
    <AuthShell title="Sign in" subtitle="Find Lagos businesses, see what's weak online, and work them from pitch to won.">
      <AuthForm mode="signin" />
    </AuthShell>
  );
}
