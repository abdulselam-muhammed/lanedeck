"use client";
// VS Code-like navigation: a 48px activity bar (icons only, tooltips) for the machine sections, and a
// collapsible 220px side panel for the current project (switcher + its pages). On phones the activity bar
// stays and the panel is a drawer. The panel collapse is remembered (laneDeck.panelCollapsed).
import { useBranch, useConfig, useMark, useProject, useT } from "@/context/ConfigContext";
import { useAllAgents } from "@/components/pages/AgentsPage";
import { tr } from "@/lib/settings";
import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSidebar } from "../context/SidebarContext";
import { useInbox } from "@/components/inbox/InboxContext";
import { CountBadge } from "@/components/inbox/bits";
import { Icon } from "@/components/inbox/IconSprite";
import MineNotifier from "@/components/mine/MineNotifier";
import { useMine } from "@/lib/mine/useMine";

type NavItem = { href: string; icon: string; label: string; match: (p: string) => boolean; pill?: React.ReactNode; tag?: string };

/** The current project (name, base, glossary flag) from the config list. */
function useCurrentProject() {
  const { id, base, projects } = useProject();
  const p = projects.find((x) => x.id === id);
  return { id, base, name: p?.name ?? id, hasGlossary: !!p?.hasGlossary };
}

/** Top of the panel: the project in use; a menu lists every configured project, then «Add project» and «Manage projects». */
function ProjectSwitcher() {
  const { id, projects, onProjectPage } = useProject();
  const { ui } = useConfig();
  const lang = ui.lang;
  const pathname = usePathname() || "/";
  const { closeMobileSidebar } = useSidebar();
  const [menu, setMenu] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [menu]);
  const cur = projects.find((p) => p.id === id);
  const section = onProjectPage ? (/^\/p\/[\w-]+(\/(?:questions|inbox|mine|prs|flow|branch|glossary))/.exec(pathname)?.[1] ?? "") : "";
  const initial = (cur?.name ?? "?").slice(0, 1).toUpperCase();
  const go = () => { setMenu(false); closeMobileSidebar(); };
  const itemCls = "flex items-center gap-2 px-2.5 py-1.5 text-theme-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]";
  return (
    <div ref={box} className="relative mb-1">
      <button
        type="button"
        onClick={() => setMenu(!menu)}
        aria-haspopup="listbox"
        aria-expanded={menu}
        className="flex w-full items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-start hover:bg-gray-50 dark:hover:bg-white/[0.04]"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-strip text-theme-xs font-semibold text-gray-800 dark:text-white">{initial}</span>
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-theme-sm font-medium text-gray-900 dark:text-white">{cur?.name}</span>
          <span className="truncate text-[11px] text-muted" dir="ltr">{cur?.repo ?? cur?.id}</span>
        </span>
        <Icon name="chevron-down" className={`s14 shrink-0 text-gray-400 transition-transform ${menu ? "rotate-180" : ""}`} />
      </button>
      {menu && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-line bg-page py-1 shadow-theme-lg">
          <ul role="listbox">
            {projects.map((p) => (
              <li key={p.id} role="option" aria-selected={p.id === id}>
                <Link
                  href={`/p/${p.id}${section}`}
                  onClick={go}
                  className={`${itemCls} ${p.id === id ? "font-semibold text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-200"}`}
                >
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate">{p.name}</span>
                    <span className="truncate text-[11px] font-normal text-muted" dir="ltr">{p.repo ?? p.id}</span>
                  </span>
                  <span className="mono truncate text-theme-xs text-muted" dir="ltr">{p.defaultBranch}</span>
                  {p.id === id && <Icon name="check" className="s14" />}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-1 border-t border-line pt-1">
            <Link href="/settings?tab=projects&add=1" onClick={go} className={`${itemCls} font-medium text-brand-600 dark:text-brand-400`}>
              <Icon name="plus" className="s14" />
              {tr(lang, "prj.add")}
            </Link>
            <Link href="/settings?tab=projects" onClick={go} className={`${itemCls} text-gray-700 dark:text-gray-200`}>
              <Icon name="settings" className="s14" />
              {tr(lang, "prj.manage")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Icon-only link; the tooltip is the native title (also the accessible name). */
function BarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`group relative grid h-10 w-12 shrink-0 place-items-center transition-colors ${
        active ? "text-brand-600 dark:text-brand-400" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      }`}
    >
      {active && <span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-500" />}
      <span className="relative">
        <Icon name={item.icon} className="s20" />
        {item.pill && <span aria-hidden="true" className="absolute -top-0.5 -end-1 h-2 w-2 rounded-full bg-brand-500" />}
      </span>
    </Link>
  );
}

function BarLogo() {
  const mark = useMark();
  const { ui } = useConfig();
  return (
    <Link href="/" aria-label={ui.title} title={ui.title} className="grid h-10 w-12 shrink-0 place-items-center">
      <Image src={mark.light} alt="" width={64} height={64} priority unoptimized={!mark.branded} className={`h-6 w-6 object-contain ${mark.branded ? "dark:hidden" : ""}`} />
      {mark.branded && <Image src={mark.dark} alt="" width={64} height={64} priority className="hidden h-6 w-6 object-contain dark:block" />}
    </Link>
  );
}

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, toggleSidebar, toggleMobileSidebar, closeMobileSidebar } = useSidebar();
  const { counts, unreadCount, branchData } = useInbox();
  const project = useCurrentProject();
  const { data: agentsAll } = useAllAgents(15000);
  const machineRunning = agentsAll ? agentsAll.agents.filter((a) => a.state === "run").length : 0;
  const pathname = usePathname() || "/";
  const branch = useBranch();
  const t = useT();
  const { ui } = useConfig();
  const lang = ui.lang;

  const mine = useMine(project.id).data;
  const needsYou = mine?.counts?.needsYou ?? 0;
  const branchPill = branchData && branchData.behind != null ? <CountBadge>{branchData.behind ? branchData.behind : "✓"}</CountBadge> : null;
  const P = project.base;
  const here = (sub: string) => (p: string) => (sub === "" ? p === P : p.startsWith(P + sub));
  const projectItems: NavItem[] = [
    { href: P, icon: "home", label: t("layout.nav.overview"), match: here("") },
    { href: `${P}/questions`, icon: "help", label: t("layout.nav.questions"), match: here("/questions"), pill: counts.questions ? <CountBadge>{counts.questions}</CountBadge> : null },
    { href: `${P}/inbox`, icon: "inbox", label: t("layout.nav.inbox"), match: here("/inbox"), pill: unreadCount ? <CountBadge>{unreadCount}</CountBadge> : null },
    { href: `${P}/mine`, icon: "circle-check", label: t("mine.nav"), match: here("/mine"), pill: needsYou ? <CountBadge>{needsYou}</CountBadge> : null },
    { href: `${P}/prs`, icon: "list-checks", label: t("layout.nav.prs"), match: here("/prs") },
    { href: `${P}/flow`, icon: "map", label: t("nav.flow"), match: here("/flow") },
    { href: `${P}/branch`, icon: "git-fork", label: t("nav.branch"), match: here("/branch"), pill: branchPill, tag: branch },
    ...(project.hasGlossary ? [{ href: `${P}/glossary`, icon: "file-text", label: t("layout.nav.projectGlossary"), match: here("/glossary") }] : []),
  ];
  const machineItems: NavItem[] = [
    { href: "/", icon: "layout-grid", label: t("layout.nav.machine"), match: (p) => p === "/" },
    { href: "/devices", icon: "monitor", label: t("layout.nav.devices"), match: (p) => p.startsWith("/devices") },
    { href: "/ci", icon: "terminal", label: "Runners", match: (p) => p.startsWith("/ci") },
    { href: "/load", icon: "gauge", label: t("layout.nav.load"), match: (p) => p.startsWith("/load") },
    { href: "/agents", icon: "bot", label: t("layout.nav.agents"), match: (p) => p.startsWith("/agents"), pill: machineRunning ? <CountBadge>{machineRunning}</CountBadge> : null },
    { href: "/glossary", icon: "file-text", label: t("layout.nav.glossary"), match: (p) => p.startsWith("/glossary") },
    { href: "/skills", icon: "sparkles", label: t("nav.skills"), match: (p) => p.startsWith("/skills") },
  ];
  const settings: NavItem = { href: "/settings", icon: "settings", label: tr(lang, "title"), match: (p) => p.startsWith("/settings") };
  const panelShown = isMobileOpen || isExpanded;
  const label = t("layout.panelToggle");
  const off = "ltr:-translate-x-[268px] rtl:translate-x-[268px]";

  return (
    <>
      <nav aria-label={t("layout.sections")} className="fixed inset-y-0 start-0 bottom-6 z-50 flex w-12 flex-col border-e border-line bg-shell panel-glow">
        <BarLogo />
        <button
          type="button"
          onClick={() => (window.innerWidth >= 1024 ? toggleSidebar() : toggleMobileSidebar())}
          title={label}
          aria-label={label}
          aria-expanded={panelShown}
          className={`grid h-10 w-12 shrink-0 place-items-center transition-colors ${panelShown ? "text-gray-900 dark:text-white" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"}`}
        >
          <Icon name="panel" className="s20" />
        </button>
        <div className="mx-auto my-1 h-px w-6 shrink-0 bg-line" />
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
          {machineItems.map((it) => <BarLink key={it.href} item={it} active={it.match(pathname)} />)}
        </div>
        <BarLink item={settings} active={settings.match(pathname)} />
      </nav>
      <aside
        aria-label={t("layout.projectMenu")}
        className={`fixed inset-y-0 bottom-6 start-12 z-[45] flex w-[220px] flex-col border-e border-line bg-shell panel-glow px-2 pt-2 transition-transform duration-200 ease-in-out ${
          isMobileOpen ? "translate-x-0" : off
        } ${isExpanded ? "lg:translate-x-0!" : ""}`}
      >
        <MineNotifier />
        <ProjectSwitcher />
        <p className="mt-2 mb-1 px-2 text-[11px] font-medium tracking-wider text-muted uppercase">{project.name}</p>
        <ul className="no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2">
          {projectItems.map((it) => {
            const active = it.match(pathname);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={closeMobileSidebar}
                  aria-current={active ? "page" : undefined}
                  className={`menu-item group ${active ? "menu-item-active" : "menu-item-inactive"}`}
                >
                  <span className={active ? "menu-item-icon-active" : "menu-item-icon-inactive"}>
                    <Icon name={it.icon} className="s16" />
                  </span>
                  <span className="menu-item-text min-w-0 flex-1 truncate text-start">{it.label}</span>
                  {it.tag && <span dir="ltr" className="mono max-w-20 shrink-0 truncate rounded bg-strip px-1.5 text-[10.5px] leading-4 text-muted" title={it.tag}>{it.tag}</span>}
                  {it.pill}
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>
    </>
  );
};

export default AppSidebar;
