import { formatBytes } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import { useTransferStore } from "@/stores/transferStore";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface UploadedPart {
  part_number: number;
  etag: string;
  size: number;
}

interface RecoverableUpload {
  id: string;
  connection_id: string;
  connection_name: string | null;
  bucket: string;
  key: string;
  local_path: string;
  total_bytes: number;
  uploaded_bytes: number;
  upload_id: string;
  part_size_bytes: number;
  uploaded_parts: UploadedPart[];
  created_at: string;
  updated_at: string | null;
}

/**
 * Mounted at the app root. On first render, asks the backend whether there
 * are any multipart uploads left over from a previous session (crash, kill,
 * power loss). If so, shows a modal with Resume / Discard for each one.
 */
export function RecoveryDialog() {
  const { t } = useTranslation();
  const fetchTransfers = useTransferStore((s) => s.fetchTransfers);
  const [uploads, setUploads] = useState<RecoverableUpload[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<
    Record<string, "resume" | "discard" | undefined>
  >({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await tauriInvoke<RecoverableUpload[]>(
          "list_recoverable_uploads",
        );
        if (cancelled) return;
        if (list.length > 0) {
          setUploads(list);
          setOpen(true);
        }
      } catch (e) {
        // Don't block the app if recovery lookup fails — just log.
        console.error("Failed to list recoverable uploads:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResume = async (upload: RecoverableUpload) => {
    setBusy((b) => ({ ...b, [upload.id]: "resume" }));
    setError(null);
    try {
      await tauriInvoke("resume_upload", { transferId: upload.id });
      // The backend re-enqueues the item into the in-memory queue; refresh
      // the frontend store so the transfer panel picks it up and the
      // incoming `transfer:progress` events have a matching row to update.
      await fetchTransfers();
      // Drop from the dialog.
      setUploads((u) => u.filter((x) => x.id !== upload.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[upload.id];
        return next;
      });
    }
  };

  const handleDiscard = async (upload: RecoverableUpload) => {
    setBusy((b) => ({ ...b, [upload.id]: "discard" }));
    setError(null);
    try {
      await tauriInvoke("discard_upload", { transferId: upload.id });
      setUploads((u) => u.filter((x) => x.id !== upload.id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[upload.id];
        return next;
      });
    }
  };

  // Auto-close once the user has handled every upload.
  useEffect(() => {
    if (open && uploads.length === 0) {
      setOpen(false);
    }
  }, [open, uploads.length]);

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/45 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] max-h-[80vh] bg-(--popover) text-(--popover-foreground) border border-(--border) rounded-xl shadow-xl flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              <Dialog.Title className="text-base font-semibold">
                {t("recovery.title")}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={t("common.close")}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-6 py-3 text-sm text-zinc-600 dark:text-zinc-400">
            {t("recovery.description", { count: uploads.length })}
          </div>

          <div className="flex-1 overflow-auto px-3 pb-3">
            <div className="space-y-2">
              {uploads.map((u) => {
                const pct =
                  u.total_bytes > 0
                    ? Math.round((u.uploaded_bytes / u.total_bytes) * 100)
                    : 0;
                const orphaned = u.connection_name === null;
                const action = busy[u.id];

                return (
                  <div
                    key={u.id}
                    className="border border-zinc-200 dark:border-zinc-800 rounded-md p-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono truncate text-zinc-900 dark:text-zinc-100">
                          {u.key}
                        </p>
                        <p className="text-zinc-500 mt-0.5 truncate">
                          {orphaned
                            ? t("recovery.connectionRemoved")
                            : `${u.connection_name} · ${u.bucket}`}
                        </p>
                        <p className="text-zinc-500 mt-0.5 truncate">
                          {u.local_path}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-medium text-zinc-700 dark:text-zinc-300">
                          {pct}%
                        </p>
                        <p className="text-zinc-500 mt-0.5">
                          {formatBytes(u.uploaded_bytes)} /{" "}
                          {formatBytes(u.total_bytes)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 text-xs flex items-center gap-1 text-zinc-600 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                        disabled={!!action}
                        onClick={() => handleDiscard(u)}
                      >
                        <Trash2 size={12} />
                        {action === "discard"
                          ? t("recovery.discarding")
                          : t("recovery.discard")}
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs flex items-center gap-1 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
                        disabled={!!action || orphaned}
                        title={
                          orphaned ? t("recovery.connectionRemoved") : undefined
                        }
                        onClick={() => handleResume(u)}
                      >
                        <RotateCcw size={12} />
                        {action === "resume"
                          ? t("recovery.resuming")
                          : t("recovery.resume")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 text-xs text-red-600 dark:text-red-400 break-words">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800">
            <Dialog.Close asChild>
              <button
                type="button"
                className="h-8 px-3 text-sm font-medium border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                {t("recovery.later")}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
