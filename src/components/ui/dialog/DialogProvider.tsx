"use client";
// The app's own confirm / notice dialogs: they replace window.confirm and window.alert (the browser's "localhost says" boxes, which
// ignore the theme and the page direction). Usage:
//   const confirm = useConfirm();
//   if (await confirm({ title, body, confirmLabel, tone: "danger" })) ...
// Several requests queue and show one after the other. The logic (queue, keys, focus wrap) is in src/lib/dialogs.mjs.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "@/context/ConfigContext";
import { Icon } from "@/components/inbox/IconSprite";
import { createDialogs, keyAction, nextFocus, type DialogOpts, type Dialogs } from "@/lib/dialogs.mjs";

const Ctx = createContext<Dialogs | null>(null);

function useDialogs(): Dialogs {
  const d = useContext(Ctx);
  if (!d) throw new Error("useConfirm needs <DialogProvider>");
  return d;
}
/** Ask a yes/no question; resolves true on confirm, false on Cancel, Esc or a click outside. */
export function useConfirm(): Dialogs["confirm"] {
  const d = useDialogs();
  return useCallback((o) => d.confirm(o), [d]);
}
/** Tell the user something; resolves when they close it. */
export function useNotice(): Dialogs["notice"] {
  const d = useDialogs();
  return useCallback((o) => d.notice(o), [d]);
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialogs] = useState(createDialogs);
  return (
    <Ctx.Provider value={dialogs}>
      {children}
      <DialogHost dialogs={dialogs} />
    </Ctx.Provider>
  );
}

const FOCUSABLE = "button:not([disabled])";

function DialogHost({ dialogs }: { dialogs: Dialogs }) {
  const req = useSyncExternalStore(dialogs.subscribe, dialogs.current, () => null);
  if (!req) return null;
  return <Dialog key={req.id} kind={req.kind} opts={req.opts} onSettle={dialogs.settle} />;
}

function Dialog({ kind, opts, onSettle }: { kind: "confirm" | "notice"; opts: DialogOpts; onSettle: (v: boolean) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const danger = opts.tone === "danger";
  const isConfirm = kind === "confirm";

  // Remember what had focus, lock the page scroll, put focus on the safe button (Cancel on a danger dialog), and give both back on close.
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (danger && isConfirm ? cancelRef : okRef).current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (back && back.isConnected) back.focus();
    };
  }, [danger, isConfirm]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") { // the focus trap
      const els = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const i = nextFocus(els.indexOf(document.activeElement as HTMLElement), els.length, e.shiftKey);
      if (i >= 0) { e.preventDefault(); els[i].focus(); }
      return;
    }
    const a = keyAction({ key: e.key, repeat: e.repeat, onCancelButton: e.target === cancelRef.current });
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    onSettle(a === "confirm");
  };

  const iconName = opts.icon ?? (danger ? "alert" : isConfirm ? "help" : "circle-dot");
  const tone = danger
    ? { disc: "bg-error-500/15 text-error-600 dark:text-error-400", ring: "border-error-500/40" }
    : { disc: "bg-strip text-brand-600 dark:text-brand-300", ring: "border-line" };

  return (
    <div className="fixed inset-0 z-99999 flex items-center justify-center overflow-y-auto p-4">
      <div className="fixed inset-0 bg-gray-950/50 backdrop-blur-[6px]" onClick={() => onSettle(false)} aria-hidden="true" />
      <div
        ref={ref} role={isConfirm ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={titleId} aria-describedby={opts.body ? bodyId : undefined}
        onKeyDown={onKeyDown}
        className={`relative w-full max-w-[440px] rounded-2xl border bg-[var(--pop)] p-5 shadow-[0_0_44px_var(--glow),0_18px_48px_rgb(0_0_0/.28)] sm:p-6 ${tone.ring}`}
      >
        <div className="flex items-start gap-3.5">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone.disc}`}>
            <Icon name={iconName} className="s18" />
          </span>
          <div className="grid min-w-0 gap-1.5 pt-0.5">
            <h2 id={titleId} className="text-base font-semibold text-gray-800 dark:text-white/90">{opts.title}</h2>
            {opts.body && <p id={bodyId} className="text-theme-sm leading-6 text-gray-500 dark:text-gray-400">{opts.body}</p>}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {isConfirm && (
            <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={() => onSettle(false)}>
              {opts.cancelLabel ?? t("dialog.cancel")}
            </button>
          )}
          <button ref={okRef} type="button" className={`btn ${danger ? "btn-danger" : "btn-solid"}`} onClick={() => onSettle(true)}>
            <Icon name={danger ? "alert" : "check"} className="s14" />
            {opts.confirmLabel ?? (isConfirm ? t("dialog.confirm") : t("dialog.ok"))}
          </button>
        </div>
      </div>
    </div>
  );
}
