import type { PublicConfig } from "../../server/config.mjs";

/** The app mark: ui.brand is an image prefix under public/ (<brand>-light.png, -dark.png, -light-favicon.png); without it, the neutral selam-deck mark. */
export function markOf(c: PublicConfig) {
  const b = c.ui.brand;
  return b
    ? { light: `${b}-light.png`, dark: `${b}-dark.png`, favicon: `${b}-light-favicon.png`, icon: `${b}-light-favicon.png`, branded: true }
    : { light: "/brand/selam-deck.svg", dark: "/brand/selam-deck.svg", favicon: "/brand/selam-deck-32.png", icon: "/brand/selam-deck-192.png", branded: false };
}
