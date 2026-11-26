"use client";
// /inbox and /inbox/[file]: the source tabs on top (All / AI agents / GitHub, components/notify/UnifiedInbox.tsx); the AI agents
// tab is the agents' inbox as it always was: three columns in one card — the list (right), the document (middle), the
// agent column (left). Each column scrolls on its own on wide screens. Under 1536px the agent column
// moves under the document; under 1280px the list and the document are separate screens (phone).
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { hrefOf, isReadme, titleOf, whenOf } from "@/lib/inbox/model";
import { useInbox } from "@/components/inbox/InboxContext";
import { Icon } from "@/components/inbox/IconSprite";
import { Empty, Led } from "@/components/inbox/bits";
import InboxList from "@/components/inbox/InboxList";
import NodeView from "@/components/inbox/NodeView";
import AgentSide from "@/components/inbox/LivePanel";
import { ArchivedPanel, useArchivedCount } from "@/components/inbox/ArchiveUI";
import { archiveTotal } from "@/lib/notify/list.mjs";
import { useProject, useT } from "@/context/ConfigContext";
import { useNotify } from "@/lib/notify/useNotify";
import { AgentRow, AllList, GhChecked, GithubTab, InboxTab, InboxTabs, MarkAllButton, tabFromParams, useGhArchive } from "@/components/notify/UnifiedInbox";

export function useMedia(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = matchMedia(q);
    setM(mq.matches);
    const on = (e: MediaQueryListEvent) => setM(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

export default function InboxPage() {
  const { tree, selected, updatedAt, unreadOf, unreadCount, markAllRead, toast, pstore } = useInbox();
  const { id, base } = useProject();
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const gh = useNotify(id);
  const [saved, setSaved] = useState<InboxTab | null>(null);
  useEffect(() => setSaved(tabFromParams(pstore.get<string>("inbox.tab", "all"), null) ?? "all"), [pstore]);
  // A file or agent on screen is the AI agents tab; otherwise ?tab=, else the tab you used last.
  const onFile = !!selected && !selected.startsWith("__");
  const tab: InboxTab = onFile ? "agents" : (tabFromParams(params.get("tab"), params.get("view")) ?? saved ?? "all");
  const go = (v: InboxTab) => {
    if (v !== "archive") { pstore.set("inbox.tab", v); setSaved(v); }
    router.replace(`${base}/inbox${v === "agents" ? "" : `?tab=${v}`}`, { scroll: false });
  };
  const ghUnread = gh.data?.counts.unread ?? 0;
  const ghArch = useGhArchive(gh, toast);
  // The Archive tab: archived agent files and archived GitHub notifications, counted apart from All.
  const archived = archiveTotal(useArchivedCount(), gh.data?.counts.archived);
  const agentRows: AgentRow[] = [...tree.nodes.values()]
    .filter((n) => n.file && !isReadme(n.file))
    .map((n) => ({ key: n.key, href: hrefOf(n.key, base), title: titleOf(n), sub: n.file!.statusText || n.file!.name, at: whenOf(n), unread: unreadOf(n.file!), lead: <Led n={n} /> }));
  const markGh = async () => {
    const n = await gh.markAllRead();
    toast(n ? t("ntf.markedN", { n }) : t("ntf.nothingUnread"), t("ntf.localOnly"), "");
  };
  const mark = tab === "github" ? markGh : tab === "agents" || tab === "archive" ? markAllRead : async () => { if (ghUnread) await gh.markAllRead(); markAllRead(); };
  const unreadHere = tab === "github" ? ghUnread : tab === "agents" ? unreadCount : unreadCount + ghUnread;
  return (
    <>
      <InboxTabs tab={tab} onTab={go} counts={{ agents: unreadCount, github: ghUnread, archived }}>
        {(tab === "all" || tab === "github") && <GhChecked data={gh.data} onRefresh={gh.refresh} />}
        {tab !== "archive" && <MarkAllButton n={unreadHere} onClick={mark} />}
      </InboxTabs>
      {tab === "agents" && <AgentsInbox />}
      {tab === "all" && (updatedAt ? <AllList agents={agentRows} gh={gh.data} failed={gh.failed} onRead={gh.markRead} onUnread={gh.markUnread} arch={ghArch} /> : <Empty icon="loader">{t("inbox.connecting")}</Empty>)}
      {tab === "github" && <GithubTab data={gh.data} failed={gh.failed} onRead={gh.markRead} onUnread={gh.markUnread} arch={ghArch} />}
      {tab === "archive" && (updatedAt ? <ArchivedPanel ghScope={id} /> : <Empty icon="loader">{t("inbox.connecting")}</Empty>)}
    </>
  );
}

/** The AI agents tab: the agents' inbox, unchanged. */
function AgentsInbox() {
  const { tree, selected, updatedAt, modes, pstore } = useInbox();
  const { base } = useProject();
  const t = useT();
  const router = useRouter();
  const wide = useMedia("(min-width: 1280px)");
  const xwide = useMedia("(min-width: 1536px)");
  const n = selected && !selected.startsWith("__") ? tree.nodes.get(selected) : undefined;
  const flowMode = !!n?.file && modes[n.file.name] === "flow" && /```flow\r?\n/.test(n.file.text);

 // /inbox on a wide screen reopens the last file you had open (localStorage["laneDeck.selected"]).
 useEffect(() => {
 if (!wide || selected || !updatedAt) return;
 const last = pstore.get<string>("selected", "");
 if (last && !last.startsWith("__") && tree.nodes.has(last)) router.replace(hrefOf(last, base));
 }, [wide, selected, updatedAt, tree, router, pstore, base]);

 const showList = wide || !selected;
 const sideApart = xwide && !flowMode && !!n;
 const cols = !wide ? "" : sideApart ? "xl:grid-cols-[340px_minmax(0,1fr)_320px]" : "xl:grid-cols-[320px_minmax(0,1fr)]";

 if (!updatedAt) return <Empty icon="loader">{t("inbox.connecting")}</Empty>;
 return (
 <>
 {!wide && selected && (
 <Link href={base + "/inbox"} className="mb-3 inline-flex items-center gap-1.5 text-theme-sm font-medium text-gray-700 dark:text-gray-200">
 <Icon name="arrow-right" className="s14 ltr:rotate-180" />
 {t("inbox.title")}
 </Link>
 )}
 <div
 className={`panel-smoke grid overflow-hidden rounded-xl border border-line/70 bg-card shadow-theme-xs ${cols} ${
          wide ? "h-[calc(100dvh-128px)] min-h-[520px]" : ""
        }`}
 >
 {showList && (
 <div className={`flex min-h-0 flex-col ${wide ? "border-e border-line" : ""}`}>
 <InboxList />
 </div>
 )}
 {(wide || selected) && (
 <div className={`min-h-0 min-w-0 ${wide ? "custom-scrollbar overflow-y-auto" : ""}`}>
            {n ? (
              <>
                <NodeView n={n} />
                {!sideApart && (
                  <div className="border-t border-line px-3 py-2 ">
                    <AgentSide n={n} />
                  </div>
                )}
              </>
            ) : selected ? (
              <Empty icon="file-text">{t("inbox.page.gone")}</Empty>
            ) : (
              <Empty icon="inbox">{t("inbox.page.pick")}</Empty>
            )}
          </div>
        )}
        {sideApart && n && (
          <aside aria-label={t("inbox.live.agent")} className="custom-scrollbar min-h-0 overflow-y-auto border-s border-line px-3 py-2 ">
            <AgentSide n={n} />
          </aside>
        )}
      </div>
    </>
  );
}
