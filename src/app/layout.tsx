import type { Metadata } from "next";
import { JetBrains_Mono, Readex_Pro } from "next/font/google";
import "./globals.css";
import "./widgets.css";

import { SidebarProvider } from "@/context/SidebarContext";
import { ThemeProvider, themeBootScript } from "@/context/ThemeContext";
import IconSprite from "@/components/inbox/IconSprite";
import { ProjectInboxProvider } from "@/components/inbox/InboxContext";
import AppShell from "@/layout/AppShell";
import { DialogProvider } from "@/components/ui/dialog/DialogProvider";
import { ConfigProvider } from "@/context/ConfigContext";
import { publicConfig } from "../../server/config.mjs";
import { markOf } from "@/lib/mark";

// Self-hosted by next/font at build time: the page makes no font request at runtime.
// Readex Pro: one modern variable family for Arabic and Latin, heavier base weight (500).
const readex = Readex_Pro({
  subsets: ["arabic", "latin"],
  weight: "variable",
  variable: "--font-readex",
  display: "swap",
  fallback: ["Cairo", "system-ui"],
});
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jetbrains", display: "swap" });

// Read at request time (not baked in at build time): the config file can change without a rebuild.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const c = publicConfig();
  return { title: { default: c.ui.title, template: `%s - ${c.ui.title}` }, description: c.project.name, robots: { index: false, follow: false } };
}

// One shell for every page: the SSE connection, the sidebar and the top bar live here, so moving
// between pages never reconnects or loses state.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const config = publicConfig();
  return (
    <html lang={config.ui.lang} dir={config.ui.dir} suppressHydrationWarning className={`${readex.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link id="favicon" rel="icon" href={markOf(config).favicon} />
      </head>
      <body className="bg-page font-sans font-medium text-gray-800 dark:text-gray-200">
        <IconSprite />
        <ConfigProvider value={config}>
          <ThemeProvider>
            <SidebarProvider>
              <ProjectInboxProvider>
                <DialogProvider>
                  <AppShell>{children}</AppShell>
                </DialogProvider>
              </ProjectInboxProvider>
            </SidebarProvider>
          </ThemeProvider>
        </ConfigProvider>
      </body>
    </html>
  );
}
