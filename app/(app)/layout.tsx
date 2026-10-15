import { Suspense } from "react";
import { requireOnboardedUser, listLeads } from "@/lib/dal";
import { LeadsProvider } from "@/lib/lead-store";
import { SiteNav, SiteNavSkeleton } from "@/components/site-nav";

// Everything in this group needs a signed-in user who has answered "What do you sell?".
// The session read streams in behind Suspense, as Cache Components requires.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<SiteNavSkeleton />}>
      <SignedIn>{children}</SignedIn>
    </Suspense>
  );
}

async function SignedIn({ children }: { children: React.ReactNode }) {
  const user = await requireOnboardedUser();
  const leads = await listLeads(user.id);
  return (
    <LeadsProvider initial={leads}>
      <SiteNav user={{ name: user.name, image: user.image }} />
      {children}
    </LeadsProvider>
  );
}
