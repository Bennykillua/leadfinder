import { Composer } from "@/components/composer";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center bg-muted/40 px-4 pt-[18vh] pb-16">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Lead Finder</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find Lagos businesses, see what&apos;s weak online, pitch them on WhatsApp.
        </p>
      </div>
      <Composer />
    </main>
  );
}
