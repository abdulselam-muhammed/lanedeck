// t() for strings the server builds itself (load alerts, board reasons, errors): reads ui.lang from the live config.
import { getConfig } from "../config.mjs";
import { t } from "./index.mjs";

/** The language of the interface right now. */
export const serverLang = () => getConfig().ui.lang;
/** ts("key", { n: 3 }) -> the text in ui.lang. */
export const ts = (key, vars) => t(serverLang(), key, vars);
