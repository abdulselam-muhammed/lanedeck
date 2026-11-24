"use client";
// The public part of the config (project, ui, profile), read by the root layout on the server and handed down here.
// No paths, hosts or tool locations ever reach the client (server/config.mjs publicConfig()).
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { PublicConfig } from "../../server/config.mjs";
import { t as translate, fill, type Vars } from "../../server/i18n/index.mjs";
import { markOf } from "@/lib/mark";
import { lsRead, lsWrite } from "@/lib/storage";

const FALLBACK: PublicConfig = {
  project: { id: "default", name: "Project", repo: null, defaultBranch: "main", me: null, reviewers: [], boardFiles: [], profile: null },
  projects: [],
  github: { org: null },
  machine: { wslDistro: null, ciContainer: null, localLabel: "This PC (WSL)" },
  ui: { lang: "en", dir: "ltr", title: "selam-deck", brand: null, runnerPrefix: null },
  profile: null,
};
const Ctx = createContext<PublicConfig>(FALLBACK);

/** The project in the URL (`/p/<id>/...`), or "" on a machine page. */
export const projectIdOfPath = (path: string | null): string => /^\/p\/([\w-]+)(?:\/|$)/.exec(path || "")?.[1] ?? "";
const LAST_KEY = "selamDeck.lastProject";
export type ProjectCtx = {
  /** The current project: the one in the URL, else the last one used, else the first. */
  id: string;
  /** "/p/<id>": the prefix of every project page. */
  base: string;
  /** True when the URL itself names the project (a project page), false on machine pages. */
  onProjectPage: boolean;
  projects: PublicConfig["projects"];
  /** href("/prs") -> "/p/<id>/prs" */
  href: (sub?: string) => string;
};
const PCtx = createContext<ProjectCtx>({ id: "default", base: "/p/default", onProjectPage: false, projects: [], href: (s = "") => "/p/default" + s });

/**
 * The public config for the current project: `project` and `profile` follow the project in the URL (or the last one used on a
 * machine page), so every component that reads useConfig()/useT()/useBranch() shows the right project without knowing about routing.
 */
export function ConfigProvider({ value, children }: { value: PublicConfig; children: React.ReactNode }) {
  const pathname = usePathname();
  const inPath = projectIdOfPath(pathname);
  const [last, setLast] = useState("");
  useEffect(() => { setLast(lsRead(LAST_KEY) ?? ""); }, []);
  useEffect(() => { if (inPath) lsWrite(LAST_KEY, inPath); }, [inPath]);
  const known = (id: string) => value.projects.some((p) => p.id === id);
  const id = known(inPath) ? inPath : known(last) ? last : value.project.id;
  const cur = value.projects.find((p) => p.id === id);
  const cfg = useMemo<PublicConfig>(() => (cur ? { ...value, project: cur, profile: cur.profileData ?? null } : value), [value, cur]);
  const pc = useMemo<ProjectCtx>(
    () => ({ id, base: `/p/${id}`, onProjectPage: !!inPath && known(inPath), projects: value.projects, href: (sub = "") => `/p/${id}${sub}` }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, inPath, value.projects],
  );
  return (
    <Ctx.Provider value={cfg}>
      <PCtx.Provider value={pc}>{children}</PCtx.Provider>
    </Ctx.Provider>
  );
}
export const useProject = () => useContext(PCtx);

export const useConfig = () => useContext(Ctx);

/** https://github.com/<repo> or null when the project has no repo. */
export function repoUrl(c: PublicConfig): string | null {
  return c.project.repo ? `https://github.com/${c.project.repo}` : null;
}
/** The first reviewer's display name (config reviewers[].name, else the login), or a neutral word. */
export function reviewerName(c: PublicConfig): string {
  const r = c.project.reviewers[0];
  return r?.name || r?.login || "the reviewer";
}
/** The project's default branch (`main` unless the config says otherwise). */
export const useBranch = () => useContext(Ctx).project.defaultBranch;

/**
 * Display text: the profile's own wording (profiles/<name>/profile.json "text") or the neutral default, with
 * {reviewer}, {branch} and the caller's variables filled in.
 */
export type TFn = (key: string, vars?: Vars) => string;
export function useT(): TFn {
  const c = useContext(Ctx);
  const text = (c.profile?.text ?? {}) as Record<string, string | { en?: string; ar?: string }>;
  const base = { reviewer: reviewerName(c), branch: c.project.defaultBranch };
  const lang = c.ui.lang;
  return (key, vars = {}) => {
    const v = { ...base, ...vars };
    const raw = text[key];
    const o = typeof raw === "string" ? raw : raw?.[lang]; // a profile may word a key once, or per language: { "en": "...", "ar": "..." }
    return o != null ? fill(o, v) : translate(lang, key, v);
  };
}

export const useMark = () => markOf(useContext(Ctx));
