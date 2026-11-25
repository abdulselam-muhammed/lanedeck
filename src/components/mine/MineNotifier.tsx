"use client";
// Raises the app's usual notification (toast, sound, desktop notification) when something new lands for you on the
// "Your work" page: a reply after your last activity, a review request, a mention. The first answer only seeds what is
// known, so opening the app never replays old news. Seen keys stay per project in localStorage (mine.seen).
import { useEffect, useRef } from "react";
import { useInbox } from "@/components/inbox/InboxContext";
import { useProject, useT } from "@/context/ConfigContext";
import { useMine } from "@/lib/mine/useMine";

export default function MineNotifier() {
  const { id } = useProject();
  const { data } = useMine(id);
  const { notify, pstore } = useInbox();
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!data || data.error || !data.counts) return;
    const seen = pstore.get<string[] | null>("mine.seen", null);
    const keys = data.attention.map((a) => a.key);
    if (seen) {
      const known = new Set(seen);
      const fresh = data.attention.filter((a) => !known.has(a.key));
      for (const a of fresh.slice(0, 3)) {
        const title =
          a.kind === "review" ? tRef.current("mine.notify.review", { n: a.number }) : a.kind === "mention" ? tRef.current("mine.notify.mention", { n: a.number, who: a.by ?? "" }) : tRef.current("mine.notify.reply", { n: a.number });
        notify(title, a.title, "__mine", "question");
      }
      if (!fresh.length) return;
    }
    pstore.set("mine.seen", [...new Set([...(seen ?? []), ...keys])].slice(-400));
  }, [data, notify, pstore]);
  return null;
}
