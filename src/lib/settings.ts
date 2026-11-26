// The settings page's client side: the config shape it edits, the API calls (CSRF token on every write), and a tiny
// text lookup (the strings live in server/i18n/areas/settings.mjs, keyed by ui.lang).
import { t } from "../../server/i18n/index.mjs";
export type Reviewer = { login: string; name?: string; role?: string };
export type ReviewMarkers = { fail: string[]; ask: string[]; pass: string[] };
export type ProjectCfg = {
  id: string; name: string; repoPath: string | null; repo: string | null; defaultBranch: string; gateCheck: string | null;
  inboxDir: string | null; claudeProjectDir: string | null; me: string | null; reviewers: Reviewer[]; reviewMarkers: ReviewMarkers;
  boardFiles: string[]; holds: Record<string, string>; profile: string | null; languages?: ("en" | "ar")[] | null;
};
export type MachineCfg = { id: string; label?: string; sshAlias?: string; ssh?: string };
export type Thresholds = { ram: number; cpu: number; disk: number; pagedPoolGB?: number };
export type Settings = {
  server: { port: number; host: string; allowedHosts: string[]; accessToken?: string | null; allowUnauthenticatedRemote?: boolean };
  tools: { gh: string | null; git: string | null };
  machine: {
    wslDistro: string | null; ciContainer: string | null; runnerImage: string | null; runnerName: string | null; teamName: string | null; localLabel: string;
    thresholds: Thresholds; remoteThresholds: Thresholds; machines: MachineCfg[];
  };
  github: { org: string | null; rateBudgetPerHour: number };
  notifications: { github: { enabled: boolean; sections: string[]; pollSeconds: number }; browser: boolean };
  projects: ProjectCfg[];
  ui: { lang: "ar" | "en"; dir: "rtl" | "ltr"; title: string; brand: string | null; runnerPrefix: string | null };
  [k: string]: unknown;
};
export type SettingsReply = { settings: Settings; csrf: string; path: string; hasFile: boolean; backups: string[]; invalid: string | null; accessToken: string | null };
export type LocalDevice = {
  id: "local"; label: string; os: string; hostname: string; cpu: { model: string | null; threads: number }; ramGB: number;
  wslDistros: string[]; wslDistro: string | null; docker: { available: boolean; via: string | null; containers: number };
  gh: { loggedIn: boolean; user: string | null };
  services: { ciRunner: { detected: boolean; containers: string[] }; monitoring: { on: boolean }; docker: { on: boolean } };
};
export type Devices = { local: LocalDevice; machines: { id: string; label: string; sshAlias: string }[] };
export type Probe = { ok: boolean; error?: string; uname?: string | null; cpus?: number | null; ramMB?: number | null; docker?: string | null };
export type Detected = {
  repoPath: string; repo: string | null; defaultBranch: string | null; defaultBranchFrom: string | null; name: string;
  claudeProjectDir: string; claudeProjectDirExists: boolean; checks: string[]; checksError: string | null;
};

export class ApiError extends Error {
  constructor(message: string, public key?: string) { super(message); }
}
async function call<T>(method: string, url: string, csrf?: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    cache: "no-store",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || `HTTP ${r.status}`, j.key);
  return j as T;
}
export const api = {
  load: () => call<SettingsReply>("GET", "/api/settings"),
  save: (csrf: string, settings: unknown) => call<{ ok: true; backup: string | null; restartRequired: boolean; backups: string[] }>("PUT", "/api/settings", csrf, settings),
  rotateToken: (csrf: string) => call<{ ok: true; accessToken: string; backup: string | null; backups: string[] }>("PUT", "/api/settings/token", csrf, {}),
  devices: (refresh = false) => call<Devices>("GET", `/api/devices${refresh ? "?refresh=1" : ""}`),
  test: (csrf: string, sshAlias: string) => call<Probe>("POST", "/api/devices/test", csrf, { sshAlias }),
  detect: (csrf: string, path: string) => call<Detected>("POST", "/api/projects/detect", csrf, { path }),
};

export type TextKey = string;
export const tr = (lang: "ar" | "en", k: TextKey, vars: Record<string, string | number> = {}): string => t(lang, "settings." + k, vars);
