"use client";
// TailAdmin's NotificationDropdown, for the inbox: the unread files (newest first), "Mark all as read",
// and the browser-notifications switch (its blocked state opens the help modal, as before).
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { byActivity, hrefOf, titleOf } from "@/lib/inbox/model";
import { RelTime } from "@/components/common/RelTime";
import { useInbox } from "./InboxContext";
import { useConfig, useMark, useProject, useT } from "@/context/ConfigContext";
import { Icon } from "./IconSprite";
import { CountBadge, Led } from "./bits";

function useNotifyPerm() {
  const [perm, setPerm] = useState<NotificationPermission | "none">("default");
  useEffect(() => setPerm("Notification" in window ? Notification.permission : "none"), []);
  return [perm, setPerm] as const;
}

export default function NotificationDropdown() {
  const cfg = useConfig();
  const t = useT();
  const markUrl = useMark().icon;
  const { tree, unreadOf, unreadCount, markAllRead, setNotifyHelp } = useInbox();
  const { base } = useProject();
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useNotifyPerm();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const unread = [...tree.nodes.values()].filter((n) => n.file && unreadOf(n.file)).sort(byActivity);
  const [nIcon, nLabel] =
    perm === "granted"
      ? ["bell-ring", t("inbox.notif.on")]
      : perm === "denied"
        ? ["bell-off", t("inbox.notif.denied")]
        : ["bell", t("inbox.notif.enable")];
  const notifyClick = async () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") await Notification.requestPermission();
    else if (Notification.permission === "denied") {
      setOpen(false);
      setNotifyHelp(true);
    } else {
      try {
        new Notification(cfg.ui.title, { body: t("inbox.notif.works"), icon: markUrl, badge: markUrl });
      } catch {}
    }
    setPerm(Notification.permission);
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="header-icon-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unreadCount ? t("inbox.notif.labelUnread", { n: unreadCount }) : t("inbox.notif.title")}
        title={unreadCount ? t("inbox.notif.unreadN", { n: unreadCount }) : t("inbox.notif.title")}
      >
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -end-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white mono dark:bg-brand-500 dark:text-gray-900">
            {unreadCount}
          </span>
        )}
        <Icon name="bell" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("inbox.notif.title")}
          className="fixed inset-x-3 top-[44px] z-[70] flex max-h-[min(560px,80dvh)] flex-col rounded-xl border border-line bg-pop p-3 shadow-theme-lg sm:absolute sm:inset-x-auto sm:end-0 sm:top-9 sm:w-[380px] "
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-2 pb-3 ">
            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-white/90">
              {t("inbox.notif.title")} {unreadCount > 0 && <CountBadge tone="brand">{unreadCount}</CountBadge>}
            </h3>
            <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5" aria-label={t("inbox.notif.close")}>
              <Icon name="x" />
            </button>
          </div>
          <ul className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
            {unread.length === 0 ? (
              <li className="flex items-center gap-2 px-2 py-3 text-theme-sm text-gray-500 dark:text-gray-400">
                <Icon name="check-check" /> {t("inbox.notif.none")}
              </li>
            ) : (
              unread.map((n) => (
                <li key={n.key}>
                  <Link
                    href={hrefOf(n.key, base)}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-white/5"
                  >
                    <span className="mt-1.5">
                      <Led n={n} />
                    </span>
                    <span className="grid min-w-0 flex-1">
                      <b dir="auto" className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                        {titleOf(n)}
                      </b>
                      <span dir="auto" className="truncate text-theme-xs text-gray-500 dark:text-gray-400">
                        {n.file?.statusText || n.file?.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-gray-500 tnum dark:text-gray-400"><RelTime at={n.file?.mtime} /></span>
                  </Link>
                </li>
              ))
            )}
          </ul>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={markAllRead}
              disabled={!unreadCount}
              className="btn btn-tonal"
            >
              <Icon name={unreadCount ? "check-check" : "check"} className="s14" />
              {unreadCount ? t("inbox.notif.markAll", { n: unreadCount }) : t("inbox.notif.none")}
            </button>
            {perm !== "none" && (
              <button type="button" onClick={notifyClick} className="btn btn-ghost">
                <Icon name={nIcon} className="s14" />
                {nLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
