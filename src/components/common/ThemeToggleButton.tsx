"use client";
import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { Icon } from "../inbox/IconSprite";
import { useT } from "@/context/ConfigContext";

const THEMES = {
  system: ["monitor", "layout.theme.system"],
  dark: ["moon", "layout.theme.dark"],
  light: ["sun", "layout.theme.light"],
} as const;

/** TailAdmin's round header button, cycling system → dark → light. */
export const ThemeToggleButton: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const t = useT();
  const [icon, key] = THEMES[theme];
  const label = t(key);
  return (
    <button onClick={toggleTheme} title={label} aria-label={label} className="header-icon-btn">
      <Icon name={icon} />
    </button>
  );
};
