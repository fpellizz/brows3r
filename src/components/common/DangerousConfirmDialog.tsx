import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface DangerousConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Main warning shown above the input. */
  warning: string;
  /** Optional secondary detail block (rendered as a list of paragraphs). */
  details?: string[];
  /** Phrase the user must type literally to enable the confirm button. */
  confirmPhrase: string;
  /** Button label when ready. */
  confirmLabel: string;
  /** Async handler. Errors are caught and shown inline. */
  onConfirm: () => Promise<void>;
}

export function DangerousConfirmDialog({
  open,
  onOpenChange,
  title,
  warning,
  details,
  confirmPhrase,
  confirmLabel,
  onConfirm,
}: DangerousConfirmDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const matches = value === confirmPhrase;

  const handleConfirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(
        typeof e === "string" ? e : ((e as Error)?.message ?? String(e)),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-zinc-900 rounded-lg shadow-xl p-6 z-50">
          <div className="flex items-start gap-3">
            <AlertTriangle
              size={22}
              className="text-amber-500 shrink-0 mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-lg font-semibold">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {warning}
              </Dialog.Description>
              {details && details.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-zinc-500 dark:text-zinc-400 list-disc pl-4">
                  {details.map((d, i) => (
                    <li key={`${i}-${d.slice(0, 16)}`}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="mt-5">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t("common.dangerousConfirm.typeToConfirm", {
                phrase: confirmPhrase,
              })}
            </label>
            <input
              className="input-field w-full font-mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches) handleConfirm();
              }}
              placeholder={confirmPhrase}
              autoFocus
              disabled={busy}
            />
          </div>

          {error && (
            <div className="mt-3 text-xs text-red-600 dark:text-red-400 break-words">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button
              className="px-4 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("common.cancel")}
            </button>
            <button
              className="px-4 py-2 text-sm rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleConfirm}
              disabled={!matches || busy}
            >
              {busy ? t("common.dangerousConfirm.working") : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
