"use client";
// /flow and /flow/[file]: the completion map at the page's full width. /flow opens 00-status (today's
// map); any other file with a ```flow block is one click away. The canvas itself is unchanged
// (zoom, pan, fit, minimap, moving cards, legend, folding).
import React, { useMemo } from "react";
import Link from "next/link";
import { parseFlow } from "@/lib/inbox/flow";
import { hasFlow, hrefOf, InboxFile } from "@/lib/inbox/model";
import { inline } from "@/lib/inbox/markdown";
import { useInbox } from "@/components/inbox/InboxContext";
import { Icon } from "@/components/inbox/IconSprite";
import { Card, Empty, PageHeader } from "@/components/inbox/bits";
import FlowCanvas from "@/components/inbox/FlowCanvas";
import { useProject, useT } from "@/context/ConfigContext";

export default function FlowPage() {
 const { files, selected, updatedAt, protocol } = useInbox();
 // Protocol projects: .selam-deck/map.md is THE map, flow blocks in inbox files are ignored.
 const mapText = protocol?.map ?? null;
 const { base } = useProject();
 const t = useT();
 const withFlow = useMemo(
 () => (mapText ? [] : files).filter(hasFlow).sort((a, b) => (a.name === "00-status.md" ? -1 : b.name === "00-status.md" ? 1 : b.mtime - a.mtime)),
 [files, mapText],
 );
 const f: InboxFile | undefined = withFlow.find((x) => x.name === selected) ?? (selected ? undefined : withFlow[0]);
 const flow = useMemo(() => (mapText ? parseFlow(mapText) : f ? parseFlow(f.text) : null), [f, mapText]);
 const title = mapText ? (mapText.match(/^#\s+(.+)$/m)?.[1] ?? "map.md") : f ? (f.text.match(/^#\s+(.+)$/m)?.[1] ?? f.name) : t("nav.flow");

 return (
 <>
 <PageHeader
 crumbs={[{ label: t("inbox.branch.crumb") }, { label: t("nav.flow"), href: base + "/flow" }]}
 title={<span dangerouslySetInnerHTML={{ __html: inline(title) }} />}
 desc={
 mapText ? (
 <span dir="ltr" className="mono">
 .selam-deck/map.md
 </span>
 ) : f ? (
 <span dir="ltr" className="mono">
 {f.name}
 </span>
 ) : (
 t("inbox.flowPage.desc")
          )
        }
      >
        {withFlow.length > 1 && (
          <div role="tablist" aria-label={t("inbox.flowPage.filesWithMap")} className="flex flex-wrap gap-1 rounded-lg bg-strip p-1">
            {withFlow.map((x) => (
              <Link
                key={x.name}
                href={base + "/flow/" + encodeURIComponent(x.name)}
                role="tab"
                aria-selected={x === f}
                className={`rounded-md px-3 py-1.5 text-theme-xs font-medium ${
 x === f ? "bg-card text-gray-900 shadow-theme-xs dark:bg-white/10 dark:text-white" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
 }`}
              >
                {withFlow.filter((y) => y.title === x.title).length > 1 ? x.name : x.title}
              </Link>
            ))}
          </div>
        )}
        {f && !mapText && (
          <Link
            href={hrefOf(f.name, base)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-card px-3 text-theme-sm font-medium text-gray-700 shadow-theme-xs hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.05]"
          >
            <Icon name="file-text" />
            {t("inbox.flowPage.textInInbox")}
          </Link>
        )}
      </PageHeader>
      {!updatedAt ? (
        <Empty icon="loader">{t("inbox.connecting")}</Empty>
      ) : !flow ? (
        <Card>
          <Empty icon="map">{selected && !mapText ? t("inbox.flowPage.noMapHere") : t("inbox.flowPage.noMapAny")}</Empty>
        </Card>
      ) : (
        <FlowCanvas key={mapText ? "map.md" : f!.name} file={mapText ? "map.md" : f!.name} flow={flow} />
      )}
    </>
  );
}
