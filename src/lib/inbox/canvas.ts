/* eslint-disable @typescript-eslint/no-explicit-any */
// The flow canvas: pan, zoom, drag the stage cards (moved from the old index.html, logic unchanged).
// Real DOM on a board moved by one CSS transform (translate + scale): Arabic stays crisp and selectable.
// Per viewer and per file: the cards the user moved (flowLayout, by stage title), zoom/pan (flowView), folds (flowNest).
// React renders the shell (components/inbox/FlowCanvas.tsx); this module owns the board inside it.
import { Flow, flowT, stageCardHtml } from "./flow";
import { objOf, store } from "./model";

const CV = { W: 360, GX: 76, GY: 100, MIN: 0.25, MAX: 2.5, TOP: 60, PAD: 32, HY: 25 };
let flowLayout: Record<string, any> = {};
let flowView: Record<string, any> = {};
let flowNest: Record<string, any> = {};
let loaded = false;
let cv: any = null;
const clampK = (k: number) => Math.min(CV.MAX, Math.max(CV.MIN, k));
const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function stageKeys(stages: Flow["stages"]) {
  const seen: Record<string, number> = {};
  return stages.map((s) => {
    const n = (seen[s.title] = (seen[s.title] || 0) + 1);
    return n === 1 ? s.title : `${s.title} #${n}`;
  });
}
const nestOpen = (file: string) => (key: string, n: number) => {
  const m = objOf(flowNest[file]);
  return key in m ? !!m[key] : n <= 4;
};

export function dropCanvas() {
  if (!cv) return;
  cv.ro.disconnect();
  cv.vro.disconnect();
  clearTimeout(cv.saveT);
  clearTimeout(cv.animT);
  cancelAnimationFrame(cv.raf);
  cv = null;
}

export function mountCanvas(vp: HTMLElement, fileName: string, flow: Flow) {
  if (!loaded) {
    flowLayout = objOf(store.get("flowLayout", {}));
    flowView = objOf(store.get("flowView", {}));
    flowNest = objOf(store.get("flowNest", {}));
    bindGlobal();
    loaded = true;
  }
  dropCanvas();
  vp.querySelectorAll(".cv-board > .cv-card").forEach((e) => e.remove()); // a previous file's cards
  cv = {
    file: fileName,
    vp,
    board: vp.querySelector(".cv-board"),
    links: vp.querySelector(".cv-links"),
    mini: vp.querySelector(".cv-mini"),
    miniSvg: vp.querySelector(".cv-mini svg"),
    cards: new Map(),
    order: [],
    stages: [],
    flow,
    t: { x: 0, y: 0, k: 1 },
    cols: 0,
    autoFit: false,
    pointers: new Map(),
    gesture: null,
    pinch: null,
    hover: false,
    space: false,
    z: 1,
  };
  cv.ro = new ResizeObserver(() => scheduleLayout());
  cv.vro = new ResizeObserver(() => {
    if (!cv) return;
    if (cv.autoFit) {
      cv.cols = chooseCols();
      layout();
    } else drawMini();
  });
  bindCanvas(vp);
  syncCards(flow, true);
  const saved = objOf(flowView[fileName]);
  if (Number.isFinite(saved.k) && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    cv.cols = saved.cols > 0 ? saved.cols : chooseCols();
    layout();
    setT(saved.x, saved.y, saved.k);
  } else {
    cv.autoFit = true;
    cv.cols = chooseCols();
    layout();
  } // first open: fit to screen
  cv.vro.observe(vp);
  syncFullBtn();
}

/** A new snapshot of the same file: change only what changed; the view and the layout stay put. */
export function patchCanvas(vp: HTMLElement, fileName: string, flow: Flow) {
  if (!cv || cv.file !== fileName || cv.vp !== vp || !vp.isConnected) return false;
  cv.flow = flow;
  syncCards(flow);
  return true;
}

function syncCards(flow: Flow, quiet?: boolean) {
  const keys = stageKeys(flow.stages),
    live = new Set(keys),
    open = nestOpen(cv.file);
  for (const [k, c] of cv.cards)
    if (!live.has(k)) {
      cv.ro.unobserve(c.el);
      c.el.remove();
      cv.cards.delete(k);
    }
  keys.forEach((key, i) => {
    const s = flow.stages[i];
    let c = cv.cards.get(key);
    if (!c) {
      const el = document.createElement("section");
      el.dataset.key = key;
      c = { el, x: 0, y: 0, h: 0, html: "" };
      cv.cards.set(key, c);
      cv.board.appendChild(el);
      cv.ro.observe(el);
    }
    const held = cv.gesture && cv.gesture.key === key && cv.gesture.moved;
    c.el.className = `fl-card cv-card s-${s.status}` + (held ? " dragging" : "");
    const html = stageCardHtml(s, i, key, open);
    if (c.html !== html) {
      const ae = document.activeElement as HTMLElement | null,
        focusHeader = !!ae && c.el.contains(ae) && ae.matches("header");
      c.el.innerHTML = html;
      c.html = html;
      if (focusHeader) c.el.querySelector("header").focus({ preventScroll: true });
    }
  });
  cv.order = keys;
  cv.stages = flow.stages;
  if (!quiet) layout();
}
function scheduleLayout() {
  if (!cv || cv.raf) return;
  cv.raf = requestAnimationFrame(() => {
    if (!cv) return;
    cv.raf = 0;
    layout();
  });
}
// The automatic layout: stages in order from the right (RTL), wrapping into rows of cv.cols.
function autoPositions() {
  const n = cv.order.length,
    cols = Math.max(1, Math.min(cv.cols || 1, n)),
    out: { x: number; y: number }[] = [];
  let y = 0;
  for (let r = 0; r * cols < n; r++) {
    const row = cv.order.slice(r * cols, r * cols + cols);
    row.forEach((k: string, j: number) => out.push({ x: (cols - 1 - j) * (CV.W + CV.GX), y }));
    y += Math.max(...row.map((k: string) => cv.cards.get(k).h)) + CV.GY;
  }
  return out;
}
// The column count whose grid fits the canvas at the largest zoom.
function chooseCols() {
  const n = cv.order.length;
  if (!n) return 1;
  for (const c of cv.cards.values()) c.h = c.el.offsetHeight;
  const hs = cv.order.map((k: string) => cv.cards.get(k).h);
  const pad = cv.vp.clientWidth < 600 ? 12 : CV.PAD;
  const vw = cv.vp.clientWidth - 2 * pad,
    vh = cv.vp.clientHeight - CV.TOP - pad;
  if (vw <= 0 || vh <= 0) return Math.min(n, 4);
  let best = 1,
    bestK = -1;
  for (let c = 1; c <= Math.min(n, 6); c++) {
    let h = 0;
    for (let r = 0; r * c < n; r++) h += Math.max(...hs.slice(r * c, r * c + c)) + (r ? CV.GY : 0);
    const k = Math.min(vw / (c * CV.W + (c - 1) * CV.GX), vh / (h + 34));
    if (k > bestK * 1.03) {
      best = c;
      bestK = k;
    }
  }
  return best;
}
function layout() {
  if (!cv) return;
  for (const c of cv.cards.values()) c.h = c.el.offsetHeight;
  const saved = objOf(flowLayout[cv.file]),
    auto = autoPositions();
  cv.order.forEach((key: string, i: number) => {
    const c = cv.cards.get(key);
    if (cv.gesture && cv.gesture.key === key && cv.gesture.moved) return; // the hand holds it
    const s = saved[key],
      p = s && Number.isFinite(s.x) && Number.isFinite(s.y) ? s : auto[i];
    c.x = p.x;
    c.y = p.y;
    c.el.style.left = p.x + "px";
    c.el.style.top = p.y + "px";
  });
  drawLinks();
  if (cv.autoFit) fit(false);
  else drawMini();
  cv.vp.querySelector('[data-cv="reset"]').disabled = !Object.keys(saved).some((k) => cv.cards.has(k));
}
// One connector per consecutive pair, coloured by the stage it leaves: orthogonal, rounded, ending in an arrow.
function linkSvg(a: any, b: any, st: string) {
  const R = 12,
    AH = 9,
    W = CV.W;
  const aB = a.y + a.h,
    bB = b.y + b.h,
    aR = a.x + W,
    bR = b.x + W;
  const elbowV = (x1: number, y1: number, x2: number, y2: number, m: number) => {
    const dx = x2 - x1,
      sx = Math.sign(dx),
      sy = Math.sign(y2 - y1) || 1;
    const r = Math.min(R, Math.abs(dx) / 2, Math.abs(m - y1), Math.abs(y2 - m));
    return Math.abs(dx) < 1
      ? `M${x1} ${y1}V${y2}`
      : `M${x1} ${y1}V${m - sy * r}Q${x1} ${m} ${x1 + sx * r} ${m}H${x2 - sx * r}Q${x2} ${m} ${x2} ${m + sy * r}V${y2}`;
  };
  const elbowH = (x1: number, y1: number, x2: number, y2: number, m: number) => {
    const dy = y2 - y1,
      sy = Math.sign(dy),
      sx = Math.sign(x2 - x1) || 1;
    const r = Math.min(R, Math.abs(dy) / 2, Math.abs(m - x1), Math.abs(x2 - m));
    return Math.abs(dy) < 1
      ? `M${x1} ${y1}H${x2}`
      : `M${x1} ${y1}H${m - sx * r}Q${m} ${y1} ${m} ${y1 + sy * r}V${y2 - sy * r}Q${m} ${y2} ${m + sx * r} ${y2}H${x2}`;
  };
  let d, tip, x1, y1;
  if (b.y >= aB + 24) {
    // below: down, across just above it, down into its top
    x1 = a.x + W / 2;
    y1 = aB;
    const x2 = b.x + W / 2,
      m = b.y - Math.min(CV.GY / 2, (b.y - aB) / 2);
    d = elbowV(x1, y1, x2, b.y - AH, m);
    tip = `${x2 - 5},${b.y - AH - 1} ${x2 + 5},${b.y - AH - 1} ${x2},${b.y}`;
  } else if (a.y >= bB + 24) {
    // above
    x1 = a.x + W / 2;
    y1 = a.y;
    const x2 = b.x + W / 2,
      m = bB + Math.min(CV.GY / 2, (a.y - bB) / 2);
    d = elbowV(x1, y1, x2, bB + AH, m);
    tip = `${x2 - 5},${bB + AH + 1} ${x2 + 5},${bB + AH + 1} ${x2},${bB}`;
  } else if (bR <= a.x - 16) {
    // to the left: the reading direction
    x1 = a.x;
    y1 = a.y + CV.HY;
    const y2 = b.y + CV.HY,
      m = (a.x + bR) / 2;
    d = elbowH(x1, y1, bR + AH, y2, m);
    tip = `${bR + AH + 1},${y2 - 5} ${bR + AH + 1},${y2 + 5} ${bR},${y2}`;
  } else if (b.x >= aR + 16) {
    // to the right
    x1 = aR;
    y1 = a.y + CV.HY;
    const y2 = b.y + CV.HY,
      m = (aR + b.x) / 2;
    d = elbowH(x1, y1, b.x - AH, y2, m);
    tip = `${b.x - AH - 1},${y2 - 5} ${b.x - AH - 1},${y2 + 5} ${b.x},${y2}`;
  } else return ""; // overlapping cards: no room for an arrow
  return `<g class="s-${st}"><path d="${d}"/><polygon points="${tip}"/><circle cx="${x1}" cy="${y1}" r="3.5"/></g>`;
}
function drawLinks() {
  let html = "";
  for (let i = 0; i + 1 < cv.order.length; i++)
    html += linkSvg(cv.cards.get(cv.order[i]), cv.cards.get(cv.order[i + 1]), cv.stages[i].status);
  cv.links.innerHTML = html;
}
function cardsBox() {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const c of cv.cards.values()) {
    x0 = Math.min(x0, c.x);
    x1 = Math.max(x1, c.x + CV.W);
    y0 = Math.min(y0, c.y - (c.el.classList.contains("s-now") ? 34 : 0));
    y1 = Math.max(y1, c.y + c.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function setT(x: number, y: number, k: number, anim?: boolean) {
  k = clampK(k);
  cv.t = { x, y, k };
  if (anim && !reduceMotion()) {
    cv.vp.classList.add("anim");
    clearTimeout(cv.animT);
    cv.animT = setTimeout(() => cv && cv.vp.classList.remove("anim"), 260);
  } else cv.vp.classList.remove("anim");
  cv.board.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  let g = 24 * k;
  while (g < 14) g *= 2;
  cv.vp.style.backgroundSize = `${g}px ${g}px`;
  cv.vp.style.backgroundPosition = `${x}px ${y}px`;
  cv.vp.querySelector(".cv-zoom").textContent = Math.round(k * 100) + "%";
  cv.vp.querySelector('[data-cv="in"]').disabled = k >= CV.MAX - 1e-6;
  cv.vp.querySelector('[data-cv="out"]').disabled = k <= CV.MIN + 1e-6;
  drawMini();
}
// The user moved the view: it stops following "fit", and is remembered.
function touched() {
  if (cv) {
    cv.autoFit = false;
    saveView();
  }
}
function saveView() {
  clearTimeout(cv.saveT);
  const file = cv.file;
  cv.saveT = setTimeout(() => {
    if (!cv || cv.file !== file) return;
    flowView[file] = cv.autoFit
      ? { fit: true }
      : { x: Math.round(cv.t.x), y: Math.round(cv.t.y), k: +cv.t.k.toFixed(4), cols: cv.cols };
    store.set("flowView", flowView);
  }, 250);
}
function zoomAt(px: number, py: number, k: number, anim?: boolean) {
  const t = cv.t,
    k2 = clampK(k),
    bx = (px - t.x) / t.k,
    by = (py - t.y) / t.k;
  setT(px - bx * k2, py - by * k2, k2, anim);
}
function zoomBy(f: number) {
  zoomAt(cv.vp.clientWidth / 2, cv.vp.clientHeight / 2, cv.t.k * f, true);
  touched();
}
function fitBox(b: any, anim: boolean, maxK = 1) {
  const vw = cv.vp.clientWidth,
    vh = cv.vp.clientHeight;
  if (!b || vw <= 0 || vh <= 0) return;
  const pad = vw < 600 ? 12 : CV.PAD,
    aw = vw - 2 * pad,
    ah = vh - CV.TOP - pad;
  const k = clampK(Math.min(maxK, aw / b.w, ah / b.h));
  // Too wide at the smallest zoom: keep the first stage (on the right) in view. Too tall: keep the top.
  const x = b.w * k > aw ? vw - pad - (b.x + b.w) * k : (vw - b.w * k) / 2 - b.x * k;
  const y = b.h * k > ah ? CV.TOP - b.y * k : CV.TOP + (ah - b.h * k) / 2 - b.y * k;
  setT(x, y, k, anim);
}
function fit(anim: boolean) {
  fitBox(cardsBox(), anim);
}
// Full screen for the canvas panel: the browser's Fullscreen API, or a fixed overlay where it is missing. Esc leaves either.
function isFull() {
  const p = document.querySelector(".cv-panel");
  return !!p && (document.fullscreenElement === p || p.classList.contains("cv-full"));
}
function syncFullBtn() {
  const b = document.querySelector('[data-cv="full"]');
  if (!b) return;
  const on = isFull();
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("title", flowT(on ? "inbox.cv.fullExitTip" : "inbox.cv.fullTip"));
  b.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-${on ? "shrink" : "expand"}"/></svg><span class="cv-lbl">${flowT(on ? "inbox.cv.exit" : "inbox.cv.full")}</span>`;
}
function toggleFull() {
  const p = document.querySelector(".cv-panel") as HTMLElement | null;
  if (!p) return;
  if (isFull()) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    p.classList.remove("cv-full");
  } else if (p.requestFullscreen) {
    p.requestFullscreen().catch(() => p.classList.add("cv-full"));
  } else p.classList.add("cv-full");
  setTimeout(() => {
    syncFullBtn();
    if (cv && cv.autoFit) fit(true);
    document.getElementById("cv")?.focus();
  }, 60);
}
function zoomToCard(key: string) {
  const c = cv.cards.get(key);
  if (!c) return;
  // Readable first: fit the card's width; a card taller than the canvas starts at its top.
  const vw = cv.vp.clientWidth,
    vh = cv.vp.clientHeight,
    pad = vw < 600 ? 12 : CV.PAD;
  const b = { x: c.x - 24, y: c.y - 44, w: CV.W + 48, h: c.h + 68 },
    ah = vh - CV.TOP - pad;
  const k = clampK(Math.min(1.25, (vw - 2 * pad) / b.w));
  const y = b.h * k > ah ? CV.TOP - b.y * k : CV.TOP + (ah - b.h * k) / 2 - b.y * k;
  setT((vw - b.w * k) / 2 - b.x * k, y, k, true);
  touched();
}
function worldBox() {
  const b = cardsBox() || { x: 0, y: 0, w: 1, h: 1 },
    t = cv.t;
  const v = { x: -t.x / t.k, y: -t.y / t.k, w: cv.vp.clientWidth / t.k, h: cv.vp.clientHeight / t.k };
  const x0 = Math.min(b.x, v.x),
    y0 = Math.min(b.y, v.y),
    x1 = Math.max(b.x + b.w, v.x + v.w),
    y1 = Math.max(b.y + b.h, v.y + v.h);
  const p = 0.04 * Math.max(x1 - x0, y1 - y0);
  return { x: x0 - p, y: y0 - p, w: x1 - x0 + 2 * p, h: y1 - y0 + 2 * p, v };
}
function drawMini() {
  if (!cv || !cv.mini.offsetWidth) return;
  const w = worldBox(),
    b = cv.miniBox || w,
    v = w.v;
  cv.miniSvg.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
  cv.miniSvg.querySelector("g").innerHTML = cv.order
    .map((k: string, i: number) => {
      const c = cv.cards.get(k);
      return `<rect class="m-card s-${cv.stages[i].status}" x="${c.x}" y="${c.y}" width="${CV.W}" height="${c.h}" rx="16"/>`;
    })
    .join("");
  const r = cv.miniSvg.querySelector(".m-view");
  r.setAttribute("x", v.x);
  r.setAttribute("y", v.y);
  r.setAttribute("width", v.w);
  r.setAttribute("height", v.h);
}
function miniGo(e: PointerEvent) {
  const pt = cv.miniSvg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const w = pt.matrixTransform(cv.miniSvg.getScreenCTM().inverse());
  setT(cv.vp.clientWidth / 2 - w.x * cv.t.k, cv.vp.clientHeight / 2 - w.y * cv.t.k, cv.t.k);
}
function saveCard(key: string) {
  const c = cv.cards.get(key),
    m = (flowLayout[cv.file] = objOf(flowLayout[cv.file]));
  m[key] = { x: Math.round(c.x), y: Math.round(c.y) };
  store.set("flowLayout", flowLayout);
  layout();
}
function moveCard(key: string, x: number, y: number) {
  const c = cv.cards.get(key);
  c.x = x;
  c.y = y;
  c.el.style.left = x + "px";
  c.el.style.top = y + "px";
  drawLinks();
  drawMini();
}
function resetLayout() {
  delete flowLayout[cv.file];
  store.set("flowLayout", flowLayout);
  cv.autoFit = false;
  cv.cols = chooseCols();
  layout();
  fit(true);
  cv.autoFit = true;
  saveView();
}
function bindCanvas(vp: HTMLElement) {
  if ((vp as any).__cvBound) return; // React keeps the same element across patches; bind once
  (vp as any).__cvBound = true;
  const local = (e: MouseEvent) => {
    const r = vp.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  vp.addEventListener("pointerenter", () => cv && (cv.hover = true));
  vp.addEventListener("pointerleave", () => cv && (cv.hover = false));
  vp.addEventListener(
    "wheel",
    (e) => {
      if (!cv) return;
      e.preventDefault(); // the wheel belongs to the canvas: the page must not scroll under it
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.shiftKey && !e.ctrlKey) {
        setT(cv.t.x - (e.deltaY || e.deltaX) * unit, cv.t.y, cv.t.k);
        touched();
        return;
      }
      const [px, py] = local(e);
      zoomAt(px, py, cv.t.k * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)));
      touched();
    },
    { passive: false },
  );
  vp.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    if (!cv || target.closest(".cv-tools, .cv-mini")) return;
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    cv.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (cv.pointers.size === 2) return startPinch();
    if (cv.pointers.size > 2) return;
    const card = target.closest(".cv-card") as HTMLElement | null,
      header = target.closest(".cv-card > header") as HTMLElement | null;
    const control = target.closest("button, a, input, textarea, select"),
      mouse = e.pointerType === "mouse";
    let kind: string | null = "pan";
    if (cv.space || e.button === 1) kind = "pan";
    else if (header && !control) kind = "card";
    else if ((control || card) && mouse) kind = null; // a mouse on a card's body selects text and clicks
    if (!kind) {
      cv.pointers.delete(e.pointerId);
      return;
    }
    if (mouse) {
      e.preventDefault();
      (header || vp).focus({ preventScroll: true });
    }
    const c = card && cv.cards.get(card.dataset.key);
    cv.gesture = {
      kind,
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      t0: { ...cv.t },
      moved: false,
      key: kind === "card" && card ? card.dataset.key : null,
      c0: c ? { x: c.x, y: c.y } : null,
    };
  });
  vp.addEventListener(
    "click",
    (e) => {
      if (cv && cv.suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  vp.addEventListener("click", (e) => {
    if (!cv) return;
    const target = e.target as HTMLElement;
    const tool = target.closest("[data-cv]") as HTMLElement | null;
    if (tool) {
      const a = tool.dataset.cv;
      if (a === "in") zoomBy(1.25);
      else if (a === "out") zoomBy(1 / 1.25);
      else if (a === "100") {
        zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1, true);
        touched();
      } else if (a === "fit") {
        fit(true);
        cv.autoFit = true;
        saveView();
      } else if (a === "reset") resetLayout();
      else if (a === "full") toggleFull();
      return;
    }
    const nest = target.closest("[data-nest]") as HTMLElement | null;
    if (nest) {
      const m = (flowNest[cv.file] = objOf(flowNest[cv.file])),
        k = nest.dataset.nest as string;
      m[k] = nest.getAttribute("aria-expanded") !== "true";
      store.set("flowNest", flowNest);
      syncCards(cv.flow);
      const again = [...vp.querySelectorAll<HTMLElement>("[data-nest]")].find((b) => b.dataset.nest === k);
      if (again) again.focus({ preventScroll: true });
    }
  });
  vp.addEventListener("dblclick", (e) => {
    const h = (e.target as HTMLElement).closest(".cv-card > header");
    if (h && cv) zoomToCard((h.parentElement as HTMLElement).dataset.key as string);
  });
  vp.addEventListener("keydown", (e) => {
    if (!cv) return;
    const target = e.target as HTMLElement;
    const header = target.closest && (target.closest(".cv-card > header") as HTMLElement | null);
    if (target !== vp && !header) return;
    const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (dir && header) {
      // a focused card header: the arrows move that card
      const key = (header.parentElement as HTMLElement).dataset.key as string,
        c = cv.cards.get(key),
        s = e.shiftKey ? 64 : 16;
      e.preventDefault();
      moveCard(key, c.x + dir[0] * s, c.y + dir[1] * s);
      saveCard(key);
    } else if (dir) {
      const s = e.shiftKey ? 240 : 60;
      e.preventDefault();
      setT(cv.t.x - dir[0] * s, cv.t.y - dir[1] * s, cv.t.k);
      touched();
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomBy(1.25);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomBy(1 / 1.25);
    } else if (e.key === "0") {
      e.preventDefault();
      zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1, true);
      touched();
    } else if (e.key === "F" && e.shiftKey) {
      e.preventDefault();
      toggleFull();
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      fit(true);
      cv.autoFit = true;
      saveView();
    } else if (e.key === "Enter" && header) {
      e.preventDefault();
      zoomToCard((header.parentElement as HTMLElement).dataset.key as string);
    }
  });
  const mini = vp.querySelector(".cv-mini") as HTMLElement;
  mini.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    cv.miniDrag = e.pointerId;
    cv.miniBox = worldBox(); // frozen while dragging, so the map holds still
    try {
      mini.setPointerCapture(e.pointerId);
    } catch {}
    miniGo(e);
  });
  mini.addEventListener("pointermove", (e) => {
    if (cv && cv.miniDrag === e.pointerId) miniGo(e);
  });
  const miniEnd = (e: PointerEvent) => {
    if (cv && cv.miniDrag === e.pointerId) {
      cv.miniDrag = null;
      cv.miniBox = null;
      drawMini();
      touched();
    }
  };
  mini.addEventListener("pointerup", miniEnd);
  mini.addEventListener("pointercancel", miniEnd);
}
function startPinch() {
  const g = cv.gesture;
  if (g && g.kind === "card" && g.moved) {
    cv.cards.get(g.key).el.classList.remove("dragging");
    cv.gesture = null;
    saveCard(g.key);
  }
  cv.gesture = null;
  cv.vp.classList.remove("panning", "moving");
  const [a, b] = [...cv.pointers.values()],
    r = cv.vp.getBoundingClientRect();
  const mx = (a.x + b.x) / 2 - r.left,
    my = (a.y + b.y) / 2 - r.top;
  cv.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: cv.t.k, bx: (mx - cv.t.x) / cv.t.k, by: (my - cv.t.y) / cv.t.k };
}
function pointerEnd(e: PointerEvent) {
  if (!cv || !cv.pointers.has(e.pointerId)) return;
  cv.pointers.delete(e.pointerId);
  const quietClick = () => {
    cv.suppressClick = true;
    setTimeout(() => cv && (cv.suppressClick = false), 0);
  };
  if (cv.pinch) {
    if (cv.pointers.size < 2) {
      cv.pinch = null;
      touched();
      quietClick();
      const rest = [...cv.pointers.entries()][0]; // the finger left down keeps panning
      cv.gesture = rest ? { kind: "pan", id: rest[0], sx: rest[1].x, sy: rest[1].y, t0: { ...cv.t }, moved: true } : null;
    }
    return;
  }
  const g = cv.gesture;
  if (!g || g.id !== e.pointerId) return;
  cv.gesture = null;
  cv.vp.classList.remove("panning", "moving");
  if (!g.moved) return;
  quietClick();
  if (g.kind === "pan") touched();
  else {
    cv.cards.get(g.key).el.classList.remove("dragging");
    saveCard(g.key);
  }
}
/** Window-level listeners, registered once: drags follow the pointer on the window, Space+drag, Esc, fullscreen. */
function bindGlobal() {
  document.addEventListener("fullscreenchange", () => {
    syncFullBtn();
    if (cv && cv.autoFit) setTimeout(() => fit(true), 60);
  });
  document.addEventListener("keydown", (e) => {
    const p = document.querySelector(".cv-panel.cv-full");
    if (e.key === "Escape" && p) {
      p.classList.remove("cv-full");
      syncFullBtn();
    }
  });
  window.addEventListener("pointermove", (e) => {
    if (!cv || !cv.pointers.has(e.pointerId)) return;
    cv.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (cv.pinch) {
      if (cv.pointers.size < 2) return;
      const [a, b] = [...cv.pointers.values()],
        r = cv.vp.getBoundingClientRect(),
        p = cv.pinch;
      const mx = (a.x + b.x) / 2 - r.left,
        my = (a.y + b.y) / 2 - r.top;
      const k = clampK((p.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / p.d0);
      setT(mx - p.bx * k, my - p.by * k, k);
      return;
    }
    const g = cv.gesture;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.sx,
      dy = e.clientY - g.sy;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 5) return; // below this it is still a click
      g.moved = true;
      cv.vp.classList.add(g.kind === "pan" ? "panning" : "moving");
      if (g.kind === "card") {
        const el = cv.cards.get(g.key).el;
        el.classList.add("dragging");
        el.style.zIndex = ++cv.z;
      }
      try {
        window.getSelection()?.removeAllRanges();
      } catch {}
    }
    if (g.kind === "pan") setT(g.t0.x + dx, g.t0.y + dy, cv.t.k);
    else moveCard(g.key, Math.round(g.c0.x + dx / cv.t.k), Math.round(g.c0.y + dy / cv.t.k));
  });
  window.addEventListener("pointerup", pointerEnd);
  window.addEventListener("pointercancel", pointerEnd);
  // Space + drag pans from anywhere on the canvas, cards included.
  window.addEventListener("keydown", (e) => {
    if (!cv || e.code !== "Space" || !(cv.hover || cv.vp.contains(document.activeElement))) return;
    const t = e.target as HTMLElement;
    if (t.closest && t.closest("button, a, input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    if (!cv.space) {
      cv.space = true;
      cv.vp.classList.add("space");
    }
  });
  const spaceUp = () => {
    if (cv && cv.space) {
      cv.space = false;
      cv.vp.classList.remove("space");
    }
  };
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") spaceUp();
  });
  window.addEventListener("blur", spaceUp);
}
