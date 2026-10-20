import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Optional list of items to display (e.g. files to delete) */
  items?: string[];
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  confirmLabel,
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/45 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-(--popover) text-(--popover-foreground) border border-(--border) rounded-xl shadow-xl p-6 z-50">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-zinc-500">
            {description}
          </Dialog.Description>
          {items && items.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-2">
              <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-0.5">
                {items.slice(0, 50).map((item) => (
                  <li key={item} className="truncate">
                    {item}
                  </li>
                ))}
                {items.length > 50 && (
                  <li className="text-zinc-400 italic">
                    ...and {items.length - 50} more
                  </li>
                )}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-6">
            <Dialog.Close asChild>
              <button className="h-8 px-3 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                {t("common.cancel")}
              </button>
            </Dialog.Close>
            <button
              className={`h-8 px-3 text-sm font-medium rounded-md text-white ${
                destructive
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-brand-600 hover:bg-brand-700"
              }`}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel ?? t("common.confirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
