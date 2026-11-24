// The flow map (moved from the old index.html).
// A file may carry one ```flow block. Its lines:
//   > now|you|wait: text          a call-out at the top (here / waits for you / waits for others)
//   == stage title | state | note
//   - step | state | tag | note   (indent two spaces for a step inside a step)
// States: done, now, you, wait, next, later, deferred, blocked.
import { esc, inline } from "./markdown";
import type { TFn } from "@/context/ConfigContext";

export const FLOW_RE = /```flow\r?\n([\s\S]*?)```/;
export type FlowState = "done" | "now" | "you" | "wait" | "next" | "later" | "deferred" | "blocked";
/** The labels in use (read by the canvas code). Set once per render with setFlowT. */
export const FLOW_STATES: Record<FlowState, string> = { done: "", now: "", you: "", wait: "", next: "", later: "", deferred: "", blocked: "" };
let ft: TFn = (k) => k;
/** The translator the flow/canvas HTML strings use (they are built outside React). A project profile may override the state labels with "flowLabels". */
export const flowT: TFn = (k, v) => ft(k, v);
export function setFlowT(t: TFn, override?: Partial<Record<FlowState, string>> | null) {
  ft = t;
  for (const k of Object.keys(FLOW_STATES) as FlowState[]) FLOW_STATES[k] = override?.[k] ?? t("inbox.flow.state." + k);
}
export const FLOW_ORDER: FlowState[] = ["done", "wait", "you", "now", "next", "later", "deferred", "blocked"];
const ATTENTION: FlowState[] = ["now", "you", "blocked"];

export type FlowStep = { label: string; status: FlowState; tag: string; note: string; children: FlowStep[] };
export type FlowStage = { title: string; status: FlowState; note: string; steps: FlowStep[] };
export type Callout = { kind: "now" | "you" | "wait"; text: string };
export type Flow = { callouts: Callout[]; stages: FlowStage[] };

const flowState = (s: string | undefined): FlowState => (s && s in FLOW_STATES ? (s as FlowState) : "later");

export function parseFlow(text: string): Flow | null {
  const m = text.match(FLOW_RE);
  if (!m) return null;
  const flow: Flow = { callouts: [], stages: [] };
  let stage: FlowStage | null = null,
    step: FlowStep | null = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const call = raw.match(/^>\s*(now|you|wait)\s*:\s*(.+)$/);
    if (call) {
      flow.callouts.push({ kind: call[1] as Callout["kind"], text: call[2].trim() });
      continue;
    }
    const st = raw.match(/^==\s*(.+)$/);
    if (st) {
      const [title, status, note = ""] = st[1].split("|").map((x) => x.trim());
      stage = { title, status: flowState(status), note, steps: [] };
      flow.stages.push(stage);
      step = null;
      continue;
    }
    const it = raw.match(/^(\s*)-\s*(.+)$/);
    if (it && stage) {
      const [label, status, tag = "", note = ""] = it[2].split("|").map((x) => x.trim());
      const item: FlowStep = { label, status: flowState(status), tag, note, children: [] };
      if (it[1].length >= 2 && step) step.children.push(item);
      else {
        stage.steps.push(item);
        step = item;
      }
    }
  }
  return flow;
}

/** An inline icon from the sprite (components/inbox/IconSprite.tsx), as an HTML string. */
export const I = (name: string, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// A stage marked later or next whose steps have partly finished says so, with how many.
function stageChip(s: FlowStage) {
  const started = s.steps.filter((x) => ["done", "wait", "you", "now"].includes(x.status)).length;
  if (["later", "next"].includes(s.status) && started)
    return `<span class="fl-chip s-next">${esc(ft("inbox.flow.partial", { started, total: s.steps.length }))}</span>`;
  return flowChip(s.status);
}
const flowChip = (s: FlowState) => `<span class="fl-chip s-${s}">${FLOW_STATES[s]}</span>`;
// Plural forms (Arabic needs four): 1, 2, 3-10, the rest. English reuses "few" and "many" alike.
const stepsWord = (n: number) => ft("inbox.flow.nest." + (n === 1 ? "one" : n === 2 ? "two" : n >= 3 && n <= 10 ? "few" : "many"), { n });

export type NestOpen = (key: string, n: number) => boolean;
// nest = { key, open } on the canvas: a step's inner steps fold there (the now/you/blocked ones stay in sight).
function flowStep(x: FlowStep, nest?: { key: string; open: NestOpen }): string {
  let kids = "";
  if (x.children.length && nest) {
    const k = nest.key + "›" + x.label,
      open = nest.open(k, x.children.length);
    const shown = open ? x.children : x.children.filter((c) => ATTENTION.includes(c.status));
    kids = `<div class="fl-nest"><button type="button" class="fl-more" data-nest="${esc(k)}" aria-expanded="${open}">${I("chevron-down", "s14")}<span>${ft(open ? "inbox.flow.hide" : "inbox.flow.show")} ${stepsWord(x.children.length)}</span><span class="fl-dots" aria-hidden="true">${x.children.map((c) => `<i class="s-${c.status}"></i>`).join("")}</span></button>${shown.length ? `<ul class="fl-rail fl-kids">${shown.map((c) => flowStep(c)).join("")}</ul>` : ""}</div>`;
  } else if (x.children.length) kids = `<ul class="fl-rail fl-kids">${x.children.map((c) => flowStep(c)).join("")}</ul>`;
  return `<li class="fl-step s-${x.status}"><span class="fl-dot"></span><div class="fl-body">
      <div class="fl-line"><span class="fl-label">${inline(x.label)}</span>${x.tag ? `<span class="fl-tag">${inline(x.tag)}</span>` : ""}${x.status === "now" ? `<span class="fl-here">${I("map-pin")}${ft("inbox.flow.here")}</span>` : ""}</div>
      <div class="fl-sub">${flowChip(x.status)}${x.note ? `<span class="fl-note">${inline(x.note)}</span>` : ""}</div>
      ${kids}
    </div></li>`;
}

export function stageCardHtml(s: FlowStage, i: number, key: string, open: NestOpen) {
  const counts: Partial<Record<FlowState, number>> = {};
  s.steps.forEach((x) => (counts[x.status] = (counts[x.status] || 0) + 1));
  const bar = FLOW_ORDER.filter((k) => counts[k])
    .map((k) => `<i class="s-${k}" style="flex:${counts[k]}" title="${FLOW_STATES[k]}: ${counts[k]}"></i>`)
    .join("");
  return `${s.status === "now" ? `<span class="fl-pin">${I("map-pin")}${ft("inbox.flow.youAreHere")}</span>` : ""}
    <header tabindex="0" title="${esc(ft("inbox.flow.stageTip"))}" aria-label="${esc(ft("inbox.flow.stageLabel", { n: i + 1 }))}: ${esc(s.title)} — ${esc(FLOW_STATES[s.status])}"><span class="fl-num">${i + 1}</span><h3>${esc(s.title)}</h3>${stageChip(s)}${I("grip", "cv-grip s14")}</header>
    ${s.note ? `<p class="fl-note">${inline(s.note)}</p>` : ""}
    ${bar ? `<div class="fl-bar">${bar}</div>` : ""}
    <ul class="fl-rail">${s.steps.map((x) => flowStep(x, { key, open })).join("")}</ul>`;
}
