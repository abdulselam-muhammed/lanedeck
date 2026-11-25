"use client";
// /p/<project>/glossary: this project's own terms (profile glossary), then a link to the built-in general glossary.
import React from "react";
import Link from "next/link";
import { useConfig, useT } from "@/context/ConfigContext";
import { useInbox } from "@/components/inbox/InboxContext";
import GlossaryView, { type Group } from "@/components/pages/GlossaryView";

export default function Page() {
  const cfg = useConfig();
  const t = useT();
  const { protocol } = useInbox();
  // The profile glossary still works; .lanedeck/glossary.md is merged after it.
  const groups = [...((cfg.profile?.glossary as Group[] | undefined) ?? []), ...((protocol?.glossary as Group[] | undefined) ?? [])];
  return (
    <GlossaryView
      crumbs={[{ label: cfg.project.name }]}
      title={t("pages.glossary.projectTitle")}
      desc={t("glossary.desc")}
      groups={groups}
      placeholder={t("pages.glossary.search")}
    >
      <p className="mb-3 text-theme-sm text-gray-600 dark:text-gray-300">
        {t("pages.glossary.generalPre")}{" "}
        <Link href="/glossary" className="font-medium underline underline-offset-4">{t("pages.glossary.generalLink")}</Link>.
      </p>
    </GlossaryView>
  );
}
