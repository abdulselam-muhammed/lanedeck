"use client";
// The slim top bar (40px): panel toggle · the Ctrl K search · sound · theme · the notifications bell.
// The live dot moved to the status bar at the bottom.
import React, { useEffect, useState } from "react";
import { useT } from "@/context/ConfigContext";
import { ThemeToggleButton } from "@/components/common/ThemeToggleButton";
import { useInbox } from "@/components/inbox/InboxContext";
import { Icon } from "@/components/inbox/IconSprite";
import NotificationDropdown from "@/components/inbox/NotificationDropdown";
import SearchPalette from "@/components/inbox/SearchPalette";

const AppHeader: React.FC = () => {
  const { sound, toggleSound, inboxError } = useInbox();
  const [search, setSearch] = useState(false);
  const t = useT();
  const soundLabel = t(sound ? "layout.soundOn" : "layout.soundOff");

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K" || e.code === "KeyK")) {
        e.preventDefault();
        setSearch((s) => !s);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return (
    <header className="sticky top-0 z-[60] flex h-10 w-full border-b border-line bg-shell">
      <div className="flex grow items-center justify-between gap-2 px-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => setSearch(true)}
            aria-label={t("layout.searchAria")}
            className="flex h-7 min-w-0 items-center gap-2 rounded-full bg-strip px-3 text-start text-theme-xs text-muted transition hover:ring-1 hover:ring-line sm:w-full sm:max-w-[420px]"
          >
            <Icon name="search" className="shrink-0" />
            <span className="hidden min-w-0 flex-1 truncate sm:inline">{t("layout.searchHint")}</span>
            <kbd dir="ltr" className="hidden rounded border border-line bg-card px-1.5 py-0.5 text-[11px] text-gray-500 mono sm:inline dark:text-gray-400">
              Ctrl K
            </kbd>
          </button>
          {inboxError && <span className="hidden text-theme-xs font-medium text-error-600 md:inline dark:text-error-400">{t("layout.inboxMissing")}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={toggleSound} className="header-icon-btn" title={t("layout.soundToggle", { label: soundLabel })} aria-label={soundLabel} aria-pressed={sound}>
            <Icon name={sound ? "volume" : "volume-x"} />
          </button>
          <ThemeToggleButton />
          <NotificationDropdown />
        </div>
      </div>
      <SearchPalette open={search} onClose={() => setSearch(false)} />
    </header>
  );
};

export default AppHeader;
