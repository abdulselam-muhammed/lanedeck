"use client";
import { useInbox } from "./InboxContext";

const EDGE = { "": "border-s-gray-400", done: "border-s-gray-400", question: "border-s-gray-400" } as const;

/** Toasts (TailAdmin alert style): newest on top, 9 s each, a click opens the file it is about. */
export default function Toasts() {
  const { toasts, dismissToast, select } = useInbox();
  return (
    <div aria-live="polite" className="fixed bottom-4 start-4 z-99999 grid w-[min(380px,calc(100vw-32px))] gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => {
            if (t.key) select(t.key);
            dismissToast(t.id);
          }}
          className={`toast-in grid gap-0.5 rounded-xl border border-line border-s-4 bg-pop px-3 py-1.5 text-start shadow-theme-lg ${EDGE[t.kind]}`}
        >
          <b dir="auto" className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
            {t.title}
          </b>
          {t.body && (
            <span dir="auto" className="text-theme-xs text-gray-500 dark:text-gray-400">
              {t.body}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
