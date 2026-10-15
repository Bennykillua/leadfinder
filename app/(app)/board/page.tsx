import type { Metadata } from "next";
import { Board } from "@/components/board/board";

export const metadata: Metadata = { title: "Board · Lead Finder" };

export default function BoardPage() {
  return (
    <main className="flex min-h-0 flex-1 flex-col bg-muted/40 pt-4">
      <Board />
    </main>
  );
}
