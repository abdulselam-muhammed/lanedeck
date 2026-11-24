"use client";
// TailAdmin's theme context, extended to the viewer's three modes: system → dark → light.
// Stored as before in localStorage["selamDeck.theme"]; TailAdmin's `.dark` class on <html> does the rest.
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { store } from "@/lib/inbox/model";

export type ThemeMode = "system" | "dark" | "light";
type ThemeContextType = { theme: ThemeMode; dark: boolean; toggleTheme: () => void };
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [osDark, setOsDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = store.get<string>("theme", "dark");
    setTheme(t === "dark" || t === "light" ? t : "system");
    const mq = matchMedia("(prefers-color-scheme: dark)");
    setOsDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener("change", on);
    setReady(true);
    return () => mq.removeEventListener("change", on);
  }, []);

  const dark = theme === "dark" || (theme === "system" && osDark);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark, ready]);

  const toggleTheme = () =>
    setTheme((t) => {
      const next = ({ system: "dark", dark: "light", light: "system" } as const)[t];
      store.set("theme", next);
      return next;
    });

  return <ThemeContext.Provider value={{ theme, dark, toggleTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};

/** Runs before paint (in <head>), so the page never flashes the wrong theme. */
export const themeBootScript = `try{var t=JSON.parse(localStorage.getItem("selamDeck.theme"));var d=t!=="light"&&(t!=="system"||matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}`;
