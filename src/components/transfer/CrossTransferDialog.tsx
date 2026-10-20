import { tauriInvoke } from "@/lib/tauri";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTransferStore } from "@/stores/transferStore";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Bucket {
  name: string;
}

interface CrossTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceConnectionId: string;
  sourceBucket: string;
  sourceKeys: string[];
}

export function CrossTransferDialog({
  open,
  onOpenChange,
  sourceConnectionId,
  sourceBucket,
  sourceKeys,
}: CrossTransferDialogProps) {
  const { t } = useTranslation();
  const connections = useConnectionStore((s) => s.connections);
  const startCrossTransfer = useTransferStore((s) => s.startCrossTransfer);

  const [destConnId, setDestConnId] = useState("");
  const [destBucket, setDestBucket] = useState("");
  const [destPrefix, setDestPrefix] = useState("");
  const [preserveMeta, setPreserveMeta] = useState(true);
  const [buckets, setBuckets] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick first "other" connection by default
  useEffect(() => {
    if (!open) return;
    setError(null);
    setStarting(false);
    setDestPrefix("");
    setDestBucket("");
    setBuckets([]);
    const other = connections.find((c) => c.id !== sourceConnectionId);
    if (other) setDestConnId(other.id);
  }, [open, connections, sourceConnectionId]);

  // Load buckets when dest connection changes
  useEffect(() => {
    if (!destConnId) return;
    (async () => {
      try {
        const list = await tauriInvoke<Bucket[]>("list_buckets", {
          connectionId: destConnId,
        });
        const names = list.map((b) => b.name);
        setBuckets(names);
        if (names.length > 0 && !destBucket) setDestBucket(names[0]);
      } catch {
        setBuckets([]);
      }
    })();
  }, [destConnId]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      await startCrossTransfer(
        sourceConnectionId,
        sourceBucket,
        sourceKeys,
        destConnId,
        destBucket,
        destPrefix || null,
        preserveMeta,
      );
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/45 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] bg-(--popover) text-(--popover-foreground) border border-(--border) rounded-xl shadow-xl flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <Dialog.Title className="text-base font-semibold">
              {t("crossTransfer.title")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-6 py-4 space-y-4">
            <p className="text-xs text-zinc-500">
              {t("crossTransfer.description", { count: sourceKeys.length })}
            </p>

            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1 block">
                {t("crossTransfer.destConnection")}
              </label>
              <select
                className="w-full px-2 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                value={destConnId}
                onChange={(e) => {
                  setDestConnId(e.target.value);
                  setDestBucket("");
                }}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.id === sourceConnectionId ? " (source)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1 block">
                {t("crossTransfer.destBucket")}
              </label>
              {buckets.length > 0 ? (
                <select
                  className="w-full px-2 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                  value={destBucket}
                  onChange={(e) => setDestBucket(e.target.value)}
                >
                  {buckets.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  className="w-full px-2 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                  value={destBucket}
                  onChange={(e) => setDestBucket(e.target.value)}
                  placeholder="bucket-name"
                />
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1 block">
                {t("crossTransfer.destPrefix")}
              </label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-sm font-mono rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                value={destPrefix}
                onChange={(e) => setDestPrefix(e.target.value)}
                placeholder="optional/prefix/"
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={preserveMeta}
                onChange={(e) => setPreserveMeta(e.target.checked)}
              />
              {t("crossTransfer.preserveMetadata")}
            </label>
          </div>

          {error && (
            <div className="px-6 py-2 text-xs text-red-600 dark:text-red-400 break-words">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800">
            <Dialog.Close asChild>
              <button
                type="button"
                className="h-8 px-3 text-sm font-medium border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                {t("common.cancel")}
              </button>
            </Dialog.Close>
            <button
              type="button"
              className="h-8 px-3 text-sm font-medium bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
              disabled={!destConnId || !destBucket || starting}
              onClick={handleStart}
            >
              {starting
                ? t("crossTransfer.starting")
                : t("crossTransfer.start")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
