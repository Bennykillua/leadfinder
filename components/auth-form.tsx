"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, signUpAction, type AuthState } from "@/lib/actions";

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "signin" ? signInAction : signUpAction,
    {},
  );
  const signup = mode === "signup";

  return (
    <form action={action} className="flex w-full flex-col gap-4 text-left">
      {signup && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" required maxLength={100} defaultValue={state.name} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={200}
          defaultValue={state.email}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          minLength={signup ? 8 : undefined}
          maxLength={200}
        />
        {signup && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
      </div>
      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {signup ? "Already have an account? " : "New here? "}
        <Link href={signup ? "/signin" : "/signup"} className="font-medium text-foreground underline-offset-4 hover:underline">
          {signup ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
