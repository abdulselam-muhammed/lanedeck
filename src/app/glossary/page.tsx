"use client";
// /glossary (machine level): the built-in general glossary, English or Arabic by ui.lang. Nothing project-specific.
import React from "react";
import { useConfig, useT } from "@/context/ConfigContext";
import { GENERAL_GLOSSARY } from "@/lib/glossary";
import GlossaryView, { type Group } from "@/components/pages/GlossaryView";

export default function Page() {
  const { ui } = useConfig();
  const ar = ui.lang === "ar";
  const t = useT();
  const groups: Group[] = GENERAL_GLOSSARY.map((g) => ({
    title: ar ? g.title.ar : g.title.en,
    desc: ar ? g.desc.ar : g.desc.en,
    entries: g.terms.map((x) => ({ terms: [{ term: x.term, meaning: ar ? x.ar : x.en }] })),
  }));
  return (
    <GlossaryView
      crumbs={[{ label: t("pages.glossary.machineCrumb") }]}
      title={t("pages.glossary.generalTitle")}
      desc={t("pages.glossary.generalDesc")}
      groups={groups}
      placeholder={t("pages.glossary.search")}
    />
  );
}
