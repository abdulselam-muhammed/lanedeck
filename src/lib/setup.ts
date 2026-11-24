// The "set up selam-deck in this project" client: the API (local-only, CSRF) and the dialog / button texts.
import { api, ApiError } from "@/lib/settings";
import { t } from "../../server/i18n/index.mjs";

export type SetupStatus = {
  exists: boolean;
  files: { protocol: boolean; setup: boolean };
  gitignore: { exists: boolean; hasLine: boolean; line: string };
  instructions: { name: string; exists: boolean; hasBlock: boolean }[];
  block: string;
  prompts: { plugin: string; any: string };
};
export type SetupResult = { ok: true; created: string[]; existed: string[]; gitignore: "added" | "present" | "skipped"; status: SetupStatus };
export type InstructionsResult = { ok: true; written: string[]; already: string[]; created: string[]; missing: string[]; status: SetupStatus };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  // The CSRF token comes from the settings endpoint (same local-only guard as the write itself).
  const csrf = method === "GET" ? "" : (await api.load()).csrf;
  const r = await fetch(url, {
    method,
    cache: "no-store",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || `HTTP ${r.status}`);
  return j as T;
}
export const setupApi = {
  status: (id: string) => call<SetupStatus>("GET", `/api/p/${id}/setup`),
  run: (id: string, gitignore: boolean) => call<SetupResult>("POST", `/api/p/${id}/setup`, { gitignore }),
  done: (id: string) => call<{ ok: true; archived: boolean }>("POST", `/api/p/${id}/setup/done`, {}),
  instructions: (id: string, files: string[], create: boolean) => call<InstructionsResult>("POST", `/api/p/${id}/setup/instructions`, { files, create }),
};

export type SetupKey = string;
export const setupText = (lang: string) => (k: SetupKey): string => t(lang, "setup." + k);
