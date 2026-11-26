"use client";
// /notifications: the Inbox of every project at once. The same three tabs as a project's Inbox: All (newest first, each row
// with its source and project), AI agents (the inbox files of every project; a click opens the file in its project's Inbox)
// and GitHub (the notifications of every linked repo, one list with filter chips). The agent files come from each project's snapshot
// (/api/p/<id>/snapshot, read every 60 s); "unread" uses each project's own read marks in this browser.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { contentLanguages, localizeText } from "../../../server/i18n/content.mjs";
import { PageHeader } from "@/components/inbox/bits";
import { useInbox } from "@/components/inbox/InboxContext";
import { useConfig, useProject, useT } from "@/context/ConfigContext";
import { hrefOf, isReadme, parseFile, RawFile, Snapshot, store } from "@/lib/inbox/model";
import { useNotify } from "@/lib/notify/useNotify";
import { AgentRow, AllList, GhChecked, GithubTab, InboxTab, InboxTabs, MarkAllButton, tabOf } from "@/components/notify/UnifiedInbox";

type ProjFiles = { id: string; name: string; ns: string; files: { name: string; hash: number; title: string; sub: string; at: number }[] };

/** Every project's inbox files, read from the snapshots every 60 s while the page is open. */
function useAllFiles() {
  const { projects } = useProject();
  const lang = useConfig().ui.lang;
  const [data, setData] = useState<ProjFiles[] | null>(null);
  const load = useCallback(async () => {
    const out = await Promise.all(
      projects.map(async (p, i): Promise<ProjFiles> => {
        const ns = i === 0 ? "" : `${p.id}.`;
        try {
          const r = await fetch(`/api/p/${encodeURIComponent(p.id)}/snapshot`, { cache: "no-store" });
          const snap = (await r.json()) as Snapshot;
          const langs = contentLanguages(snap.protocol?.languages, p.languages ?? null);
          const files = (snap.files || [])
            .map((f: RawFile) => parseFile({ ...f, text: localizeText(f.text, lang, langs), rawText: f.text }))
            .filter((f) => !isReadme(f))
            .map((f) => ({ name: f.name, hash: f.hash, title: f.title, sub: f.statusText || f.name, at: f.mtime }));
          return { id: p.id, name: p.name, ns, files };
        } catch {
          return { id: p.id, name: p.name, ns, files: [] };
        }
      }),
    );
    setData(out);
  }, [projects, lang]);
  useEffect(() => {
    load();
    const iv = setInterval(() => !document.hidden && load(), 60000);
    return () => clearInterval(iv);
  }, [load]);
  return { data, reload: load };
}

export default function AllInboxPage() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { id: current, projects } = useProject();
  const { markAllRead: markCurrent, unreadOf, files: currentFiles } = useInbox();
  const gh = useNotify("all");
  const { data: all, reload } = useAllFiles();
  const [saved, setSaved] = useState<InboxTab | null>(null);
  const [marks, setMarks] = useState(0); // bumps after a mark-all, so the unread dots are read again
  useEffect(() => setSaved(tabOf(store.get<string>("inboxAll.tab", "all")) ?? "all"), []);
  const tab: InboxTab = tabOf(params.get("tab")) ?? saved ?? "all";
  const go = (v: InboxTab) => {
    store.set("inboxAll.tab", v);
    setSaved(v);
    router.replace(`/notifications?tab=${v}`, { scroll: false });
  };

  const agentRows: AgentRow[] = useMemo(() => {
    void marks;
    const multi = projects.length > 1;
    return (all ?? []).flatMap((p) => {
      // The current project's read marks are live in its Inbox; the others are read from this browser's storage.
      const seen = p.id === current ? null : store.get<Record<string, number> | null>(p.ns + "seenHash", null);
      const cur = p.id === current ? new Map(currentFiles.map((f) => [f.name, f])) : null;
      return p.files.map((f) => ({
        key: `${p.id}/${f.name}`,
        href: hrefOf(f.name, `/p/${p.id}`),
        title: f.title,
        sub: f.sub,
        at: f.at,
        unread: cur ? !!cur.get(f.name) && unreadOf(cur.get(f.name)!) : !!seen && seen[f.name] !== f.hash,
        project: multi ? p.name : undefined,
      }));
    });
  }, [all, current, currentFiles, unreadOf, projects.length, marks]);
  const agentUnread = agentRows.filter((r) => r.unread).length;
  const ghUnread = gh.data?.counts.unread ?? 0;

  const markAgents = () => {
    for (const p of all ?? []) {
      if (p.id === current) continue;
      if (store.get(p.ns + "seenHash", null) === null) continue; // never opened here: nothing counts as unread
      store.set(p.ns + "seenHash", Object.fromEntries(p.files.map((f) => [f.name, f.hash])));
    }
    markCurrent();
    setMarks((n) => n + 1);
    reload();
  };
  const mark = tab === "github" ? () => gh.markAllRead() : tab === "agents" ? markAgents : async () => { if (ghUnread) await gh.markAllRead(); markAgents(); };
  const unreadHere = tab === "github" ? ghUnread : tab === "agents" ? agentUnread : agentUnread + ghUnread;

  return (
    <div>
      <PageHeader title={t("ntf.all.title")} desc={t("ntf.all.desc")} />
      <InboxTabs tab={tab} onTab={go} counts={{ agents: agentUnread, github: ghUnread }}>
        {tab !== "agents" && <GhChecked data={gh.data} onRefresh={gh.refresh} />}
        <MarkAllButton n={unreadHere} onClick={mark} />
      </InboxTabs>
      {tab === "all" && <AllList agents={agentRows} gh={gh.data} failed={gh.failed} onRead={gh.markRead} onUnread={gh.markUnread} />}
      {tab === "agents" && <AllList agents={agentRows} gh={null} onRead={gh.markRead} onUnread={gh.markUnread} empty={all ? t("ntf.all.noFiles") : t("inbox.connecting")} />}
      {tab === "github" && <GithubTab data={gh.data} failed={gh.failed} onRead={gh.markRead} onUnread={gh.markUnread} />}
    </div>
  );
}
