"use client";
import { Modal } from "@/components/ui/modal";
import Button from "@/components/ui/button/Button";
import { useInbox } from "./InboxContext";
import { useT } from "@/context/ConfigContext";
import { Icon } from "./IconSprite";

/** TailAdmin modal: how to unblock browser notifications for this page. */
export default function NotifyHelpModal() {
  const { notifyHelp, setNotifyHelp } = useInbox();
  const close = () => setNotifyHelp(false);
  const t = useT();
  return (
    <Modal isOpen={notifyHelp} onClose={close} className="m-4 max-w-[480px] p-3 lg:p-8" showCloseButton={false}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-strip text-gray-600 dark:text-gray-300">
          <Icon name="bell-off" className="s18" />
        </span>
        <div className="grid gap-2">
          <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90">{t("inbox.notifyHelp.title")}</h4>
          <p className="text-theme-sm leading-7 text-gray-500 dark:text-gray-400">
            {t("inbox.notifyHelp.before")} <code dir="ltr" className="mono">localhost:4280</code> {t("inbox.notifyHelp.after")}
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="solid" onClick={close}>
          {t("inbox.notifyHelp.ok")}
        </Button>
      </div>
    </Modal>
  );
}
