import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = { title: "Create account · Lead Finder" };

export default function SignUpPage() {
  return (
    <AuthShell title="Create your account" subtitle="Your leads, reminders and notes stay private to you.">
      <AuthForm mode="signup" />
    </AuthShell>
  );
}
