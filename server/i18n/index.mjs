// The one dictionary of the interface: every user-facing string lives in server/i18n/areas/<area>.mjs as { en: {...}, ar: {...} }
// and is read through t(lang, key, vars). Used by the client (useT() in ConfigContext) and by the server (ts() in ./server.mjs).
// Rules: every key exists in both languages (scripts/check-i18n.mjs enforces it and rejects Arabic literals outside this folder);
// {name} placeholders are filled from vars; an unknown key returns the key itself so a gap is visible, never blank.
import * as common from "./areas/common.mjs";
import * as layout from "./areas/layout.mjs";
import * as pages from "./areas/pages.mjs";
import * as prs from "./areas/prs.mjs";
import * as inbox from "./areas/inbox.mjs";
import * as load from "./areas/load.mjs";
import * as settings from "./areas/settings.mjs";
import * as setup from "./areas/setup.mjs";

const AREAS = [common, layout, pages, prs, inbox, load, settings, setup];
export const DICT = { en: Object.assign({}, ...AREAS.map((a) => a.en)), ar: Object.assign({}, ...AREAS.map((a) => a.ar)) };

/** Text direction that goes with a language, used when the config does not set ui.dir. */
export const dirOf = (lang) => (lang === "ar" ? "rtl" : "ltr");

export const fill = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));

/** The text for `key` in `lang` (en when that language lacks it, the key when neither has it). */
export function t(lang, key, vars = {}) {
  return fill(DICT[lang]?.[key] ?? DICT.en[key] ?? key, vars);
}
