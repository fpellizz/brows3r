import { type UnlistenFn, tauriInvoke, tauriListen } from "@/lib/tauri";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface BatchOperationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  bucket: string;
  keys: string[];
  /** Called once the operation completes so the caller can refresh. */
  onCompleted?: () => void;
}

type OpKind = "set_storage_class" | "set_content_type" | "set_acl";

interface ProgressEvent {
  batch_id: string;
  key: string;
  status: "ok" | "error";
  error: string | null;
  completed: number;
  total: number;
}
interface CompleteEvent {
  batch_id: string;
  succeeded: number;
  failed: number;
}

const STORAGE_CLASSES = [
  "STANDARD",
  "STANDARD_IA",
  "ONEZONE_IA",
  "INTELLIGENT_TIERING",
  "GLACIER_IR",
  "GLACIER",
  "DEEP_ARCHIVE",
  "REDUCED_REDUNDANCY",
];

const CANNED_ACLS = [
  "private",
  "public-read",
  "public-read-write",
  "authenticated-read",
  "bucket-owner-read",
  "bucket-owner-full-control",
];

export function BatchOperationsDialog({
  open,
  onOpenChange,
  connectionId,
  bucket,
  keys,
  onCompleted,
}: BatchOperationsDialogProps) {
  const { t } = useTranslation();
  const [opKind, setOpKind] = useState<OpKind>("set_storage_class");
  const [storageClass, setStorageClass] = useState("STANDARD_IA");
  const [contentType, setContentType] = useState("");
  const [acl, setAcl] = useState("private");
  const [running, setRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [complete, setComplete] = useState<CompleteEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Reset state when the dialog is reopened so a previous run does not
  // bleed through.
  useEffect(() => {
    if (open) {
      setRunning(false);
      setBatchId(null);
      setProgress([]);
      setComplete(null);
      setError(null);
    }
  }, [open]);

  // Listen for events, filter by our batch id.
  useEffect(() => {
    if (!batchId) return;
    let unlistenA: UnlistenFn | null = null;
    let unlistenB: UnlistenFn | null = null;
    (async () => {
      unlistenA = await tauriListen<ProgressEvent>("batch:progress", (p) => {
        if (p.batch_id !== batchId) return;
        setProgress((prev) => [...prev, p]);
      });
      unlistenB = await tauriListen<CompleteEvent>("batch:complete", (c) => {
        if (c.batch_id !== batchId) return;
        setComplete(c);
        setRunning(false);
        onCompleted?.();
      });
    })();
    return () => {
      unlistenA?.();
      unlistenB?.();
    };
  }, [batchId, onCompleted]);

  // Auto-scroll log to the bottom on new events.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [progress.length]);

  const start = async () => {
    setError(null);
    setProgress([]);
    setComplete(null);
    let operation: Record<string, unknown>;
    if (opKind === "set_storage_class") {
      operation = { type: "set_storage_class", storage_class: storageClass };
    } else if (opKind === "set_content_type") {
      if (!contentType.trim()) {
        setError(t("batch.errorContentTypeEmpty"));
        return;
      }
      operation = {
        type: "set_content_type",
        content_type: contentType.trim(),
      };
    } else {
      operation = { type: "set_acl", acl };
    }
    setRunning(true);
    try {
      const id = await tauriInvoke<string>("start_batch_operation", {
        connectionId,
        bucket,
        keys,
        operation,
      });
      setBatchId(id);
    } catch (e) {
      setError(String(e));
      setRunning(false);
    }
  };

  const lastEvent = progress[progress.length - 1];
  const pct = lastEvent ? (lastEvent.completed / lastEvent.total) * 100 : 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/45 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[85vh] overflow-hidden bg-(--popover) text-(--popover-foreground) border border-(--border) rounded-xl shadow-xl z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold">
                {t("batch.title")}
              </Dialog.Title>
              <p className="text-xs text-zinc-500">
                {t("batch.targetCount", { count: keys.length })} · {bucket}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={running}
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* Operation chooser */}
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1">
                {t("batch.operation")}
              </label>
              <select
                className="select-field w-full"
                value={opKind}
                onChange={(e) => setOpKind(e.target.value as OpKind)}
                disabled={running}
              >
                <option value="set_storage_class">
                  {t("batch.opStorageClass")}
                </option>
                <option value="set_content_type">
                  {t("batch.opContentType")}
                </option>
                <option value="set_acl">{t("batch.opAcl")}</option>
              </select>
            </div>

            {opKind === "set_storage_class" && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">
                  {t("batch.storageClass")}
                </label>
                <select
                  className="select-field w-full"
                  value={storageClass}
                  onChange={(e) => setStorageClass(e.target.value)}
                  disabled={running}
                >
                  {STORAGE_CLASSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500 mt-1">
                  {t("batch.storageClassHint")}
                </p>
              </div>
            )}

            {opKind === "set_content_type" && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">
                  {t("batch.contentType")}
                </label>
                <input
                  type="text"
                  className="input-field w-full font-mono text-xs"
                  placeholder="application/octet-stream"
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  disabled={running}
                />
              </div>
            )}

            {opKind === "set_acl" && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">
                  {t("batch.acl")}
                </label>
                <select
                  className="select-field w-full"
                  value={acl}
                  onChange={(e) => setAcl(e.target.value)}
                  disabled={running}
                >
                  {CANNED_ACLS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500 mt-1">
                  {t("batch.aclHint")}
                </p>
              </div>
            )}

            {/* Progress */}
            {(running || progress.length > 0) && (
              <div className="space-y-2">
                <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-brand-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div
                  ref={logRef}
                  className="max-h-48 overflow-y-auto text-[11px] font-mono space-y-0.5 border border-zinc-200 dark:border-zinc-800 rounded p-2"
                >
                  {progress.map((p, i) => (
                    <div
                      key={i}
                      className={
                        p.status === "ok"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }
                    >
                      [{p.status === "ok" ? "OK" : "ERR"}] {p.key}
                      {p.error ? ` — ${p.error}` : ""}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {complete && (
              <div
                className={`rounded-md px-3 py-2 text-sm flex items-start gap-2 ${
                  complete.failed === 0
                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
                    : "bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200"
                }`}
              >
                {complete.failed === 0 ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                )}
                <span>
                  {t("batch.summary", {
                    succeeded: complete.succeeded,
                    failed: complete.failed,
                  })}
                </span>
              </div>
            )}

            {error && (
              <div className="rounded-md px-3 py-2 text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 break-all">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={running}
                className="h-8 px-3 text-sm font-medium border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
              >
                {complete ? t("common.close") : t("connection.cancel")}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={start}
              disabled={running || keys.length === 0 || complete !== null}
              className="h-8 px-3 text-sm font-medium bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running ? (
                <Loader2 size={14} className="animate-spin inline mr-1.5" />
              ) : null}
              {t("batch.apply")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
