"use client";
// The app shell (VS Code-like): activity bar (48px) + collapsible side panel (220px) on the start side, a slim
// top bar, the page at full width, and a 24px status bar at the bottom. On phones the panel is a drawer.
import React from "react";
import { useSidebar } from "@/context/SidebarContext";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";
import Backdrop from "./Backdrop";
import StatusBar from "./StatusBar";
import Toasts from "@/components/inbox/Toasts";
import LoadBanner from "@/components/load/LoadBanner";
import { LoadProvider } from "@/components/load/LoadContext";
import NotifyHelpModal from "@/components/inbox/NotifyHelpModal";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { isExpanded } = useSidebar();
  const margin = isExpanded ? "lg:ms-[268px]" : "lg:ms-12";
  return (
    <LoadProvider>
      <div className="min-h-screen pb-6">
        <AppSidebar />
        <Backdrop />
        <div className={`content-backdrop ms-12 min-h-[calc(100vh-1.5rem)] min-w-0 transition-[margin] duration-200 ease-in-out ${margin}`}>
          <AppHeader />
          <main className="w-full min-w-0 p-2 md:p-2.5">{children}</main>
        </div>
        <StatusBar />
        <Toasts />
        <NotifyHelpModal />
        <LoadBanner />
      </div>
    </LoadProvider>
  );
}
