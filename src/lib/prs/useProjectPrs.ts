"use client";
// A light read of one project's PR board for the overview cards: how many PRs wait for you and for the reviewer.
// Polls the cached board (/api/p/<id>/prs/board) every 60 s while the tab is visible; the board page itself uses the WebSocket.
import { useEffect, useState } from "react";
import type { Board } from "@/lib/prs/model";

export type PrSummary = { open: number; us: number; reviewer: number };

export function useProjectPrs(projectId: string): PrSummary | null {
  const [sum, setSum] = useState<PrSummary | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSum(null);
    const tick = async () => {
      if (!document.hidden) {
        try {
          const b = (await (await fetch(`/api/p/${projectId}/prs/board`, { cache: "no-store" })).json()) as Board;
          if (!stop && Array.isArray(b.prs) && !(b as { loading?: boolean }).loading)
            setSum({ open: b.prs.length, us: b.prs.filter((p) => p.who === "us").length, reviewer: b.prs.filter((p) => p.who === "reviewer").length });
        } catch {
          /* the board is not up yet */
        }
      }
      if (!stop) timer = setTimeout(tick, 60000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [projectId]);
  return sum;
}
