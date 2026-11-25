"use client";
// /inbox and /inbox/[file]: three columns in one card — the list (right), the document (middle), the
// agent column (left). Each column scrolls on its own on wide screens. Under 1536px the agent column
// moves under the document; under 1280px the list and the document are separate screens (phone).
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hrefOf } from "@/lib/inbox/model";
import { useInbox } from "@/components/inbox/InboxContext";
import { Icon } from "@/components/inbox/IconSprite";
import { Empty } from "@/components/inbox/bits";
import InboxList from "@/components/inbox/InboxList";
import NodeView from "@/components/inbox/NodeView";
import AgentSide from "@/components/inbox/LivePanel";
import { useProject, useT } from "@/context/ConfigContext";

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
          wide ? "h-[calc(100dvh-80px)] min-h-[520px]" : ""
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
