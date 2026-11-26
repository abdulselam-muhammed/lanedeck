"use client";
// New GitHub notifications while the app is open: an in-app toast (a click opens the Inbox's GitHub tab), and, only when
// Settings -> Notifications turns it on (off by default) and the browser allows it, a desktop notification. The server sends
// only rows that became unread since its last poll, never on its first poll, so opening the app never replays old news.
import { useEffect, useRef } from "react";
import { useInbox } from "@/components/inbox/InboxContext";
import { useMark, useProject, useT } from "@/context/ConfigContext";
import { onFresh, useNotify } from "@/lib/notify/useNotify";
import { kindOf } from "@/lib/notify/list.mjs";

export default function NotifyNotifier() {
  const { id } = useProject();
  const { data } = useNotify(id); // keeps the browser setting at hand (and the project's count warm for the badge)
  const { toast } = useInbox();
  const t = useT();
  const icon = useMark().icon;
  const ref = useRef({ t, toast, browser: false, icon, id });
  ref.current = { t, toast, browser: !!data?.settings.browser, icon, id };
  useEffect(
    () =>
      onFresh(({ fresh }) => {
        const { t, toast, browser, icon } = ref.current;
        for (const it of fresh.slice(0, 3)) {
          const title = t("ntf.toast.title", { section: t(`ntf.kindLabel.${kindOf(it)}`) });
          const body = `${it.actor ? `${it.actor} · ` : ""}${it.repo}${it.number != null ? `#${it.number}` : ""} · ${it.title}`;
          toast(title, body, "", it.projects.includes(ref.current.id) ? "__github" : "__github_all");
          if (browser && "Notification" in window && Notification.permission === "granted") {
            try {
              const n = new Notification(title, { body, tag: "gh" + it.id + it.at, icon });
              n.onclick = () => {
                window.focus();
                if (it.url) window.open(it.url, "_blank", "noopener,noreferrer");
                n.close();
              };
            } catch {
              /* not allowed here */
            }
          }
        }
        if (fresh.length > 3) toast(t("ntf.toast.more", { n: fresh.length - 3 }), "", "", "__github_all");
      }),
    [],
  );
  return null;
}
