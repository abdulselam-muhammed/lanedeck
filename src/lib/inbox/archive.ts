// The Inbox archive's client side: the API calls (server/archive.mjs) and the small shared types.
export type ArchivedItem = {
  id: string;
  original: string;
  kind: "file" | "dir";
  archivedAt: string;
  by: "manual" | "auto";
  mtime: number | null;
  size: number | null;
  title: string | null;
  missing: boolean;
};
export type ArchiveResult = { archived: { name: string; id: string }[]; skipped: { name: string; code: string }[] };
export type RestoreResult = { restored: { id: string; to: string; renamed: boolean }[]; failed: { id: string; code: string }[] };

/** Other parts of the page (the list's counter) refetch when the archive changed. */
export const ARCHIVE_CHANGED = "lanedeck:archive-changed";

async function call<T>(project: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/p/${encodeURIComponent(project)}/archive${path}`, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error || "request"), { code: j?.error || "request" });
  return j as T;
}
const changed = <T,>(v: T): T => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ARCHIVE_CHANGED));
  return v;
};

export const listArchived = (project: string) => call<{ items: ArchivedItem[] }>(project, "GET", "").then((r) => r.items);
export const archiveFiles = (project: string, names: string[], o: { skipOpenQuestions?: boolean; olderThanDays?: number } = {}) =>
  call<ArchiveResult>(project, "POST", "", { names, ...o }).then(changed);
export const restoreArchived = (project: string, ids: string[] | "all") =>
  call<RestoreResult>(project, "POST", "/restore", ids === "all" ? { all: true } : { ids }).then(changed);
