"use client";
// The flow map of a file: the call-outs, the legend, and the canvas. React renders the shell once;
// lib/inbox/canvas.ts owns the board (cards, connectors, zoom/pan, minimap, fullscreen) and is
// patched in place on every new snapshot, so zoom, pan and card positions never reset.
import React, { useEffect, useRef } from "react";
import { inline } from "@/lib/inbox/markdown";
import { Flow, FLOW_ORDER, FLOW_STATES, setFlowT } from "@/lib/inbox/flow";
import { useConfig, useT } from "@/context/ConfigContext";
import { dropCanvas, mountCanvas, patchCanvas } from "@/lib/inbox/canvas";
import { Icon } from "./IconSprite";

const HEAD = { now: ["map-pin", "inbox.flow.youAreHere"], you: ["hourglass", "inbox.flow.state.you"], wait: ["eye", "inbox.flow.state.wait"] } as const;

export default function FlowCanvas({ file, flow }: { file: string; flow: Flow }) {
  const cfg = useConfig();
  // the profile may word the states its own way (profiles/<name>/profile.json "flowLabels"); set before the canvas is drawn
  const t = useT();
  setFlowT(t, cfg.profile?.flowLabels as Record<string, string> | undefined);
  const vp = useRef<HTMLDivElement>(null);
  const mounted = useRef<string | null>(null);

  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    if (mounted.current === file && patchCanvas(el, file, flow)) return;
    mountCanvas(el, file, flow);
    mounted.current = file;
  }, [file, flow]);
  useEffect(
    () => () => {
      dropCanvas();
      mounted.current = null;
    },
    [],
  );

  return (
    <div className="fl">
      {flow.callouts.length > 0 && (
        <div className="fl-callouts">
          {flow.callouts.map((c, i) => (
            <div key={i} className={`fl-call s-${c.kind}`}>
              <b>
                <Icon name={HEAD[c.kind][0]} />
                {t(HEAD[c.kind][1])}
              </b>
              <span dangerouslySetInnerHTML={{ __html: inline(c.text) }} />
            </div>
          ))}
        </div>
      )}
      <section className="cv-panel" aria-label={t("inbox.cv.map")}>
        <div className="cv-head">
          {FLOW_ORDER.map((k) => (
            <span key={k} className={`fl-key s-${k}`}>
              <i />
              {FLOW_STATES[k]}
            </span>
          ))}
        </div>
        <div className="cv" id="cv" ref={vp} tabIndex={0} role="region" aria-roledescription={t("inbox.cv.board")} aria-label={t("inbox.cv.boardLabel")} aria-describedby="cv-help">
          <div className="cv-board">
            <svg className="cv-links" aria-hidden="true" />
          </div>
          <div className="cv-tools" role="toolbar" aria-label={t("inbox.cv.tools")}>
            <button type="button" className="cv-btn" data-cv="out" title={t("inbox.cv.zoomOutTip")} aria-label={t("inbox.cv.zoomOut")}>
              <Icon name="minus" />
            </button>
            <button type="button" className="cv-btn cv-zoom" data-cv="100" title={t("inbox.cv.actualTip")} aria-label={t("inbox.cv.actual")}>
              100%
            </button>
            <button type="button" className="cv-btn" data-cv="in" title={t("inbox.cv.zoomInTip")} aria-label={t("inbox.cv.zoomIn")}>
              <Icon name="plus" />
            </button>
            <span className="cv-sep" />
            <button type="button" className="cv-btn" data-cv="fit" title={t("inbox.cv.fitTip")} aria-label={t("inbox.cv.fitLabel")}>
              <Icon name="maximize" />
              <span className="cv-lbl">{t("inbox.cv.fit")}</span>
            </button>
            <button type="button" className="cv-btn" data-cv="full" title={t("inbox.cv.fullTip")} aria-label={t("inbox.cv.full")} aria-pressed="false" />
            <button type="button" className="cv-btn" data-cv="reset" title={t("inbox.cv.resetTip")} aria-label={t("inbox.cv.reset")}>
              <Icon name="layout-grid" />
              <span className="cv-lbl">{t("inbox.cv.resetShort")}</span>
            </button>
          </div>
          <div className="cv-mini" title={t("inbox.cv.miniTip")}>
            <svg preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <g />
              <rect className="m-view" />
            </svg>
          </div>
        </div>
      </section>
      <p className="cv-foot" id="cv-help">
        <span>{t("inbox.cv.hintPan")}</span>
        <span>{t("inbox.cv.hintWheel")}</span>
        <span>{t("inbox.cv.hintMove")}</span>
        <span>
          <kbd>Space</kbd>+{t("inbox.cv.hintDrag")}
        </span>
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {t("inbox.cv.hintArrows")}
        </span>
        <span>
          <kbd>F</kbd> {t("inbox.cv.fit")}
        </span>
        <span>
          <kbd>Shift</kbd>+<kbd>F</kbd> {t("inbox.cv.full")}
        </span>
      </p>
    </div>
  );
}
