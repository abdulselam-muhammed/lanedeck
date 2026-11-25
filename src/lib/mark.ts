import type { PublicConfig } from "../../server/config.mjs";

/** The app mark: ui.brand is an image prefix under public/ (<brand>-light.png, -dark.png, -light-favicon.png); without it, the neutral lanedeck mark. */
export function markOf(c: PublicConfig) {
  const b = c.ui.brand;
  return b
    ? { light: `${b}-light.png`, dark: `${b}-dark.png`, favicon: `${b}-light-favicon.png`, icon: `${b}-light-favicon.png`, branded: true }
    : { light: "/brand/lanedeck.svg", dark: "/brand/lanedeck.svg", favicon: "/brand/lanedeck-32.png", icon: "/brand/lanedeck-192.png", branded: false };
}
