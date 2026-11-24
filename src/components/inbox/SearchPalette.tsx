"use client";
// The Ctrl K search (VR4): pages, file titles and names, agent names / branches / ids, and open
// questions — every word typed must match; Enter or a click goes there. Built on what the page
// already holds (the snapshot): no request, nothing stored.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { hrefOf, isReadme, openQuestions, titleOf } from "@/lib/inbox/model";
import { useInbox } from "./InboxContext";
import { useBranch, useProject, useT } from "@/context/ConfigContext";
import { Icon } from "./IconSprite";

type Hit = { id: string; group: string; icon: string; title: string; sub: string; href: string; hay: string };

// A path starting with "~" belongs to the current project ("~/prs" -> "/p/<id>/prs"); the others are machine pages.
const PAGES: [string, string, string][] = [
  ["/", "home", "inbox.search.p.machine"],
  ["~", "home", "inbox.search.p.project"],
  ["~/questions", "help", "inbox.search.p.questions"],
  ["~/inbox", "inbox", "inbox.search.p.inbox"],
  ["~/prs", "list-checks", "inbox.search.p.prs"],
  ["~/flow", "map", "{flow}"],
  ["~/branch", "git-fork", "{branchPage} ({branch})"],
  ["/agents", "bot", "inbox.search.p.agents"],
  ["/devices", "monitor", "inbox.search.p.devices"],
  ["/ci", "terminal", "inbox.search.p.runners"],
  ["/load", "gauge", "inbox.search.p.load"],
  ["/skills", "sparkles", "{skills}"],
  ["/settings", "settings", "inbox.search.p.settings"],
];

export default function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tree, files } = useInbox();
  const { base } = useProject();
  const router = useRouter();
  const branch = useBranch();
  const t = useT();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const all = useMemo<Hit[]>(() => {
    const out: Hit[] = PAGES.map(([h0, icon, raw]) => { const href = h0.startsWith("~") ? base + h0.slice(1) : h0; const title = (raw.startsWith("inbox.") ? t(raw) : raw).replace("{branch}", branch).replace("{flow}", t("nav.flow")).replace("{skills}", t("nav.skills")).replace("{branchPage}", t("nav.branch")); return { id: "p:" + href, group: "pages", icon, title, sub: href, href, hay: title + " " + href }; });
    for (const n of tree.nodes.values()) {
      const a = n.agent;
      const f = n.file;
      out.push({
        id: "n:" + n.key,
        group: f ? "files" : "agents",
        icon: f ? (a ? "bot" : "file-text") : "bot",
        title: titleOf(n),
        sub: [f?.name, a?.branch, a && !f ? a.id : ""].filter(Boolean).join(" · "),
        href: hrefOf(n.key, base),
        hay: [titleOf(n), f?.name, a?.name, a?.branch, a?.id, a?.model, f?.statusText].filter(Boolean).join(" "),
      });
    }
    for (const { f, q: qq } of openQuestions(files))
      if (!isReadme(f))
        out.push({
          id: "q:" + f.name + "|" + qq.id,
          group: "questions",
          icon: "help",
          title: qq.title,
          sub: f.name,
          href: hrefOf(f.name, base),
          hay: qq.title + " " + f.name + " " + f.title,
        });
    return out;
  }, [tree, files, branch, base, t]);

  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const found = words.length ? all.filter((h) => words.every((w) => h.hay.toLowerCase().includes(w))) : all.filter((h) => h.group === "pages");
    return found.slice(0, 40);
  }, [q, all]);

  useEffect(() => {
    if (open) {
      setQ("");
      setAt(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (!open) return null;
  const go = (h: Hit | undefined) => {
    if (!h) return;
    onClose();
    router.push(h.href);
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[at]);
    }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-99999 flex items-start justify-center bg-gray-900/50 px-3 pt-[10vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("inbox.search.label")}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-line bg-pop shadow-theme-xl "
      >
        <div className="flex items-center gap-2 border-b border-line px-3 ">
          <Icon name="search" className="s18 text-gray-400" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={key}
            placeholder={t("inbox.search.placeholder")}
            aria-label={t("inbox.search.text")}
            role="combobox"
            aria-expanded="true"
            aria-controls="search-hits"
            aria-activedescendant={hits[at] ? "hit-" + at : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-gray-800 outline-none placeholder:text-gray-400 dark:text-white/90"
          />
          <kbd dir="ltr" className="rounded border border-line px-1.5 py-0.5 text-[11px] text-gray-500 mono ">
            Esc
          </kbd>
        </div>
        <ul id="search-hits" ref={list} role="listbox" className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
          {hits.length === 0 && <li className="px-3 py-4 text-center text-theme-sm text-gray-500">{t("inbox.search.noResults", { q })}</li>}
          {hits.map((h, i) => {
            const head = h.group !== lastGroup;
            lastGroup = h.group;
            return (
              <React.Fragment key={h.id}>
                {head && <li className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t("inbox.search.g." + h.group)}</li>}
                <li
                  id={"hit-" + i}
                  data-i={i}
                  role="option"
                  aria-selected={i === at}
                  onMouseMove={() => setAt(i)}
                  onClick={() => go(h)}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 ${i === at ? "bg-strip" : ""}`}
                >
                  <Icon name={h.icon} className={i === at ? "text-gray-700 dark:text-gray-200" : "text-gray-400"} />
                  <span className="grid min-w-0 flex-1">
                    <span dir="auto" className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                      {h.title}
                    </span>
                    {h.sub && (
                      <span dir="ltr" className="truncate text-end text-theme-xs text-gray-500 mono dark:text-gray-400">
                        {h.sub}
                      </span>
                    )}
                  </span>
                  {i === at && <Icon name="corner" className="s14 text-gray-400" />}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
