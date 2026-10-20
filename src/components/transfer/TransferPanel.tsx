import { formatBytes, formatDuration, formatSpeed } from "@/lib/format";
import {
  type TransferHistoryEntry,
  type TransferItem,
  useTransferStore,
} from "@/stores/transferStore";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Pause,
  Play,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function TransferPanel() {
  const { t } = useTranslation();
  const transfers = useTransferStore((s) => s.transfers);
  const history = useTransferStore((s) => s.history);
  const fetchHistory = useTransferStore((s) => s.fetchHistory);
  const pauseTransfer = useTransferStore((s) => s.pauseTransfer);
  const resumeTransfer = useTransferStore((s) => s.resumeTransfer);
  const cancelTransfer = useTransferStore((s) => s.cancelTransfer);
  const clearCompleted = useTransferStore((s) => s.clearCompleted);

  const [tab, setTab] = useState<"active" | "history">("active");

  // Fetch history when the user switches to the tab (lazy load).
  useEffect(() => {
    if (tab === "history") fetchHistory();
  }, [tab, fetchHistory]);

  return (
    <div className="h-full flex flex-col border-t border-zinc-200 dark:border-zinc-800">
      {/* Header with tab toggle */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-(--border) bg-(--pane)">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`h-7 px-2.5 rounded-md text-xs font-medium ${tab === "active" ? "bg-(--pane-accent) text-(--foreground)" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
            onClick={() => setTab("active")}
          >
            {t("transfer.title")}
          </button>
          <button
            type="button"
            className={`h-7 px-2.5 rounded-md text-xs font-medium ${tab === "history" ? "bg-(--pane-accent) text-(--foreground)" : "text-(--muted-foreground) hover:text-(--foreground)"}`}
            onClick={() => setTab("history")}
          >
            {t("transfer.history")}
          </button>
        </div>
        {tab === "active" && (
          <button
            type="button"
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            onClick={clearCompleted}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "active" &&
          (transfers.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-zinc-400">
              {t("transfer.noTransfers")}
            </div>
          ) : (
            transfers.map((transfer) => (
              <TransferRow
                key={transfer.id}
                transfer={transfer}
                onPause={() => pauseTransfer(transfer.id)}
                onResume={() => resumeTransfer(transfer.id)}
                onCancel={() => cancelTransfer(transfer.id)}
              />
            ))
          ))}

        {tab === "history" &&
          (history.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-zinc-400">
              {t("transfer.noHistory")}
            </div>
          ) : (
            history.map((entry) => <HistoryRow key={entry.id} entry={entry} />)
          ))}
      </div>
    </div>
  );
}

function TransferRow({
  transfer,
  onPause,
  onResume,
  onCancel,
}: {
  transfer: TransferItem;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const progress =
    transfer.total_bytes > 0
      ? (transfer.transferred_bytes / transfer.total_bytes) * 100
      : 0;

  const fileName = transfer.key.split("/").pop() || transfer.key;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
      {/* Type icon */}
      {transfer.transfer_type === "upload" ? (
        <Upload size={14} className="text-brand-500 shrink-0" />
      ) : (
        <Download size={14} className="text-green-500 shrink-0" />
      )}

      {/* File info + progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs">
          <span className="truncate font-medium">{fileName}</span>
          <span className="text-zinc-400 ml-2 shrink-0">
            {formatBytes(transfer.transferred_bytes)} /{" "}
            {formatBytes(transfer.total_bytes)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${statusColor(transfer.status)}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Speed and ETA */}
        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-zinc-400">
          {transfer.status === "inprogress" && transfer.speed_bps != null && (
            <span>{formatSpeed(transfer.speed_bps)}</span>
          )}
          {transfer.status === "inprogress" && transfer.eta_secs != null && (
            <span>ETA {formatDuration(transfer.eta_secs)}</span>
          )}
          <StatusBadge status={transfer.status} />
          {transfer.error && (
            <span className="text-red-500 truncate">{transfer.error}</span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {transfer.status === "inprogress" && (
          <button
            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
            onClick={onPause}
            title={t("transfer.pause")}
          >
            <Pause size={12} />
          </button>
        )}
        {transfer.status === "paused" && (
          <button
            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
            onClick={onResume}
            title={t("transfer.resume")}
          >
            <Play size={12} />
          </button>
        )}
        {(transfer.status === "queued" ||
          transfer.status === "inprogress" ||
          transfer.status === "paused") && (
          <button
            className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-400 hover:text-red-500"
            onClick={onCancel}
            title={t("transfer.cancel")}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const icon = {
    queued: <Clock size={10} />,
    completed: <CheckCircle2 size={10} />,
    failed: <AlertCircle size={10} />,
  }[status];

  if (!icon) return null;

  return (
    <span
      className={`flex items-center gap-0.5 ${
        status === "completed"
          ? "text-green-500"
          : status === "failed"
            ? "text-red-500"
            : "text-zinc-400"
      }`}
    >
      {icon}
    </span>
  );
}

function HistoryRow({ entry }: { entry: TransferHistoryEntry }) {
  const fileName = entry.key.split("/").pop() || entry.key;
  const isSuccess = entry.status === "completed";

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800/50">
      {entry.transfer_type === "upload" ? (
        <Upload size={14} className="text-zinc-400 shrink-0" />
      ) : (
        <Download size={14} className="text-zinc-400 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs">
          <span className="truncate font-medium text-zinc-500">{fileName}</span>
          <span className="text-zinc-400 ml-2 shrink-0">
            {formatBytes(entry.total_bytes)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-400">
          <span
            className={`flex items-center gap-0.5 ${isSuccess ? "text-green-500" : "text-red-500"}`}
          >
            {isSuccess ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
            {entry.status}
          </span>
          {entry.completed_at && (
            <span>{new Date(entry.completed_at).toLocaleString()}</span>
          )}
          {entry.error && (
            <span className="text-red-500 truncate">{entry.error}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "inprogress":
      return "bg-brand-500";
    case "completed":
      return "bg-green-500";
    case "failed":
      return "bg-red-500";
    case "paused":
      return "bg-amber-500";
    default:
      return "bg-zinc-400";
  }
}
