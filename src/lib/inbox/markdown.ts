// A small, safe markdown renderer (moved from the old index.html): everything is escaped first,
// so the returned HTML only carries the tags this file writes.

export const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function inline(s: string): string {
  const codes: string[] = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return "\u0000" + (codes.length - 1) + "\u0000";
  });
  s = s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) =>
      /^(https?:|file:|\.|\/|[A-Za-z]:)/.test(u) ? `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>` : t,
    );
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code dir="ltr">${codes[+i]}</code>`);
}

export function md(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let html = "",
    i = 0;
  const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<pre><code>${esc(buf.join("\n"))}</code></pre>`;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      html += `<h${n}>${inline(h[2])}</h${n}>`;
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      let t = `<div class="tbl"><table><thead><tr>` + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        t += "<tr>" + cells(lines[i]).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
        i++;
      }
      html += t + "</tbody></table></div>";
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const stack: string[] = [];
      while (i < lines.length && (/^\s*([-*]|\d+\.)\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && stack.length))) {
        const l = lines[i];
        const m = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!m) {
          html += " " + inline(l.trim());
          i++;
          continue;
        }
        const depth = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
        const tag = /\d/.test(m[2]) ? "ol" : "ul";
        while (stack.length > depth + 1) html += `</li></${stack.pop()}>`;
        if (stack.length === depth + 1) html += "</li>";
        while (stack.length < depth + 1) {
          html += `<${tag}>`;
          stack.push(tag);
        }
        html += `<li>${inline(m[3])}`;
        i++;
      }
      while (stack.length) html += `</li></${stack.pop()}>`;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      html += `<blockquote>${inline(buf.join(" "))}</blockquote>`;
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    )
      buf.push(lines[i++]);
    html += `<p>${inline(buf.join(" "))}</p>`;
  }
  return html;
}
