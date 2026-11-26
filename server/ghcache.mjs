// A conditional (ETag) GitHub GET through `gh api -i`.
// `gh api` exits 1 for every HTTP status >= 300, including 304 Not Modified ("gh: HTTP 304"), but still prints the
// response head on stdout. So a non-zero exit with an HTTP status line on stdout is an answer, not a failure.

const STATUS_LINE = /^HTTP\/[\d.]+\s+\d+/;

/** The text a `gh` run printed when it is an HTTP answer (even with a non-zero exit), else null. */
export function httpOut(err, out) {
  const text = String(out == null ? "" : out).trim();
  if (!err) return text;
  return STATUS_LINE.test(text) ? text : null;
}

/**
 * One cached GET: { body } | { denied } | { failed }. A 304 costs nothing (refunded) and returns the cached body.
 * @param {object} o
 * @param {Function} o.exec     (args) -> Promise<{ err, out }>, never rejects
 * @param {Function} o.spend    () -> boolean (false = budget used up)
 * @param {Function} o.refund   () -> void
 * @param {Map} o.etags         url -> { etag, body }
 */
export async function cachedGet({ exec, spend, refund, etags, url }) {
  if (!spend()) return { denied: true };
  const prev = etags.get(url);
  const args = ["api", "-i", url, ...(prev ? ["-H", `If-None-Match: ${prev.etag}`] : [])];
  const r = await exec(args);
  const out = httpOut(r.err, r.out);
  if (out == null) { refund(); return { failed: true }; }
  const i = out.search(/\r?\n\r?\n/);
  const head = i < 0 ? out : out.slice(0, i);
  const status = Number((/^HTTP\/[\d.]+\s+(\d+)/m.exec(head) || [])[1] || 0);
  if (status === 304 && prev) { refund(); return { body: prev.body }; }
  if (status !== 200) return { failed: true };
  try {
    const body = JSON.parse(out.slice(i).trim());
    const etag = (/^etag:\s*(.+?)\s*$/im.exec(head) || [])[1];
    if (etag) etags.set(url, { etag, body });
    return { body };
  } catch { return { failed: true }; }
}
