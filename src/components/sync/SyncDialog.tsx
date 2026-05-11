import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Play,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { tauriInvoke, tauriListen, type UnlistenFn } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";

type SyncDirection = "localtoremote" | "remotetolocal";
type SyncMode = "new" | "updated" | "mirror";
type SyncActionKind =
  | "upload"
  | "download"
  | "delete_local"
  | "delete_remote"
  | "skip";
type SyncActionStatus = "started" | "completed" | "failed";

interface SyncAction {
  kind: SyncActionKind;
  rel_path: string;
  size: number;
  reason: string;
}

interface SyncSummary {
  uploads: number;
  downloads: number;
  deletes_local: number;
  deletes_remote: number;
  skipped: number;
  total_bytes_to_transfer: number;
}

interface SyncPlan {
  actions: SyncAction[];
  summary: SyncSummary;
}

interface SyncActionEvent {
  sync_id: string;
  rel_path: string;
  kind: SyncActionKind;
  status: SyncActionStatus;
  error: string | null;
}

interface SyncCompleteEvent {
  sync_id: string;
  succeeded: number;
  failed: number;
  skipped: number;
}

interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  bucket: string | null;
  prefix: string;
}

type Phase = "config" | "planning" | "plan-ready" | "executing" | "done";

export function SyncDialog({
  open,
  onOpenChange,
  connectionId,
  bucket,
  prefix,
}: SyncDialogProps) {
  const { t } = useTranslation();

  // Config
  const [direction, setDirection] = useState<SyncDirection>("localtoremote");
  const [mode, setMode] = useState<SyncMode>("updated");
  const [localDir, setLocalDir] = useState("");
  const [remotePrefix, setRemotePrefix] = useState(prefix);

  // Plan / execution
  const [phase, setPhase] = useState<Phase>("config");
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [syncId, setSyncId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmMirror, setConfirmMirror] = useState(false);

  // Live action status keyed by rel_path
  const [statuses, setStatuses] = useState<
    Record<string, { status: SyncActionStatus; error: string | null }>
  >({});
  const [summary, setSummary] = useState<SyncCompleteEvent | null>(null);

  const unlistenRef = useRef<UnlistenFn[]>([]);

  // Reset when dialog opens fresh
  useEffect(() => {
    if (!open) return;
    setPhase("config");
    setPlan(null);
    setSyncId(null);
    setError(null);
    setConfirmMirror(false);
    setStatuses({});
    setSummary(null);
    setRemotePrefix(prefix);
  }, [open, prefix]);

  // Cleanup listeners on unmount / close
  useEffect(() => {
    return () => {
      for (const fn of unlistenRef.current) fn();
      unlistenRef.current = [];
    };
  }, []);

  const pickLocalDir = async () => {
    const picked = await openFileDialog({ directory: true });
    if (!picked) return;
    setLocalDir(picked);
  };

  const handlePlan = async () => {
    if (!connectionId || !bucket || !localDir) return;
    setPhase("planning");
    setError(null);
    try {
      const result = await tauriInvoke<SyncPlan>("plan_sync", {
        request: {
          connection_id: connectionId,
          bucket,
          prefix: remotePrefix,
          local_dir: localDir,
          direction,
          mode,
        },
      });
      setPlan(result);
      setPhase("plan-ready");
    } catch (e) {
      setError(String(e));
      setPhase("config");
    }
  };

  const hasDeletes = useMemo(
    () => (plan ? plan.summary.deletes_local + plan.summary.deletes_remote > 0 : false),
    [plan],
  );

  const canExecute = useMemo(() => {
    if (!plan) return false;
    const hasWork =
      plan.summary.uploads +
        plan.summary.downloads +
        plan.summary.deletes_local +
        plan.summary.deletes_remote >
      0;
    if (!hasWork) return false;
    if (hasDeletes && !confirmMirror) return false;
    return true;
  }, [plan, hasDeletes, confirmMirror]);

  const handleExecute = async () => {
    if (!plan || !connectionId || !bucket) return;
    setError(null);
    setStatuses({});
    setSummary(null);
    setPhase("executing");

    // Subscribe to action + complete events BEFORE firing the command so we
    // don't miss anything.
    const unAction = await tauriListen<SyncActionEvent>(
      "sync:action",
      (payload) => {
        if (syncId && payload.sync_id !== syncId) return;
        setStatuses((prev) => ({
          ...prev,
          [payload.rel_path]: { status: payload.status, error: payload.error },
        }));
      },
    );
    const unComplete = await tauriListen<SyncCompleteEvent>(
      "sync:complete",
      (payload) => {
        if (syncId && payload.sync_id !== syncId) return;
        setSummary(payload);
        setPhase("done");
      },
    );
    unlistenRef.current.push(unAction, unComplete);

    try {
      const returnedId = await tauriInvoke<string>("execute_sync", {
        request: {
          sync_id: "",
          connection_id: connectionId,
          bucket,
          prefix: remotePrefix,
          local_dir: localDir,
          actions: plan.actions,
        },
      });
      setSyncId(returnedId);
    } catch (e) {
      setError(String(e));
      setPhase("plan-ready");
    }
  };

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[760px] max-h-[85vh] bg-white dark:bg-zinc-900 rounded-lg shadow-xl flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <Dialog.Title className="text-base font-semibold">
              {t("sync.title")}
            </Dialog.Title>
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

          <div className="flex-1 overflow-auto px-6 py-4">
            {/* Config form */}
            {(phase === "config" || phase === "planning") && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1 block">
                    {t("sync.direction")}
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded border ${
                        direction === "localtoremote"
                          ? "bg-brand-600 text-white border-brand-600"
                          : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      }`}
                      onClick={() => setDirection("localtoremote")}
                    >
                      <ArrowUpFromLine size={14} />
                      {t("sync.localToRemote")}
                    </button>
                    <button
                      type="button"
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded border ${
                        direction === "remotetolocal"
                          ? "bg-brand-600 text-white border-brand-600"
                          : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      }`}
                      onClick={() => setDirection("remotetolocal")}
                    >
                      <ArrowDownToLine size={14} />
                      {t("sync.remoteToLocal")}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1 block">
                    {t("sync.mode")}
                  </label>
                  <div className="flex gap-2">
                    {(["new", "updated", "mirror"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`flex-1 px-3 py-2 text-sm rounded border ${
                          mode === m
                            ? "bg-brand-600 text-white border-brand-600"
                            : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        }`}
                        onClick={() => setMode(m)}
                      >
                        {t(`sync.mode_${m}`)}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    {t(`sync.modeHint_${mode}`)}
                  </p>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1 block">
                    {t("sync.localDir")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                      value={localDir}
                      placeholder="/home/user/Documents"
                      onChange={(e) => setLocalDir(e.target.value)}
                    />
                    <button
                      type="button"
                      className="px-2 py-1.5 text-xs border border-zinc-300 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
                      onClick={pickLocalDir}
                    >
                      <FolderOpen size={14} />
                      {t("sync.browse")}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1 block">
                    {t("sync.remote")}
                  </label>
                  <div className="flex gap-2 items-center">
                    <span className="text-xs font-mono text-zinc-500">
                      {bucket ?? "—"} /
                    </span>
                    <input
                      type="text"
                      className="flex-1 px-2 py-1.5 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                      value={remotePrefix}
                      placeholder="path/to/sync/root/"
                      onChange={(e) => setRemotePrefix(e.target.value)}
                    />
                  </div>
                </div>

                {phase === "planning" && (
                  <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 size={14} className="animate-spin" />
                    {t("sync.planning")}
                  </div>
                )}
              </div>
            )}

            {/* Plan preview */}
            {(phase === "plan-ready" ||
              phase === "executing" ||
              phase === "done") &&
              plan && (
                <div className="space-y-3">
                  <SummaryBar summary={plan.summary} />

                  {hasDeletes && phase === "plan-ready" && (
                    <div className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 rounded p-3">
                      <label className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={confirmMirror}
                          onChange={(e) => setConfirmMirror(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span>{t("sync.confirmDeletes")}</span>
                      </label>
                    </div>
                  )}

                  {summary && (
                    <div className="border border-zinc-200 dark:border-zinc-700 rounded p-3 text-xs">
                      <p className="font-medium mb-1">{t("sync.finalResult")}</p>
                      <div className="flex gap-4 text-zinc-600 dark:text-zinc-300">
                        <span>✓ {summary.succeeded}</span>
                        <span>✗ {summary.failed}</span>
                        <span>○ {summary.skipped}</span>
                      </div>
                    </div>
                  )}

                  <div className="border border-zinc-200 dark:border-zinc-700 rounded overflow-hidden">
                    <div className="max-h-[320px] overflow-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800">
                          <tr className="text-left text-zinc-600 dark:text-zinc-300">
                            <th className="px-2 py-1 w-8"></th>
                            <th className="px-2 py-1 w-24">
                              {t("sync.action")}
                            </th>
                            <th className="px-2 py-1">{t("sync.path")}</th>
                            <th className="px-2 py-1 w-20 text-right">
                              {t("sync.size")}
                            </th>
                            <th className="px-2 py-1">{t("sync.reason")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.actions.map((a) => {
                            const s = statuses[a.rel_path];
                            return (
                              <tr
                                key={a.rel_path}
                                className="border-t border-zinc-100 dark:border-zinc-800"
                              >
                                <td className="px-2 py-1">
                                  <StatusIcon
                                    kind={a.kind}
                                    status={s?.status}
                                  />
                                </td>
                                <td className="px-2 py-1 font-mono text-zinc-600 dark:text-zinc-300">
                                  {a.kind}
                                </td>
                                <td
                                  className="px-2 py-1 font-mono truncate max-w-[280px]"
                                  title={a.rel_path}
                                >
                                  {a.rel_path}
                                </td>
                                <td className="px-2 py-1 text-right text-zinc-500">
                                  {a.kind === "skip"
                                    ? "—"
                                    : formatBytes(a.size)}
                                </td>
                                <td className="px-2 py-1 text-zinc-500 truncate max-w-[200px]">
                                  {s?.error ?? a.reason}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
          </div>

          {error && (
            <div className="px-6 py-2 border-t border-zinc-200 dark:border-zinc-800 text-xs text-red-600 dark:text-red-400 break-words">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800">
            <Dialog.Close asChild>
              <button
                type="button"
                className="px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                {phase === "done" ? t("common.close") : t("common.cancel")}
              </button>
            </Dialog.Close>

            {phase === "config" && (
              <button
                type="button"
                className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
                disabled={!localDir || !bucket || !connectionId}
                onClick={handlePlan}
              >
                {t("sync.plan")}
              </button>
            )}

            {phase === "plan-ready" && (
              <>
                <button
                  type="button"
                  className="px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  onClick={() => setPhase("config")}
                >
                  {t("sync.back")}
                </button>
                <button
                  type="button"
                  className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1"
                  disabled={!canExecute}
                  onClick={handleExecute}
                >
                  <Play size={14} />
                  {t("sync.execute")}
                </button>
              </>
            )}

            {phase === "executing" && (
              <button
                type="button"
                className="px-4 py-2 text-sm bg-zinc-400 text-white rounded-md cursor-not-allowed flex items-center gap-1"
                disabled
              >
                <Loader2 size={14} className="animate-spin" />
                {t("sync.running")}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SummaryBar({ summary }: { summary: SyncSummary }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-5 gap-2 text-xs">
      <Stat
        icon={<ArrowUpFromLine size={12} />}
        label={t("sync.summary_uploads")}
        value={summary.uploads}
      />
      <Stat
        icon={<ArrowDownToLine size={12} />}
        label={t("sync.summary_downloads")}
        value={summary.downloads}
      />
      <Stat
        icon={<Trash2 size={12} />}
        label={t("sync.summary_deletesLocal")}
        value={summary.deletes_local}
        tone="danger"
      />
      <Stat
        icon={<Trash2 size={12} />}
        label={t("sync.summary_deletesRemote")}
        value={summary.deletes_remote}
        tone="danger"
      />
      <Stat
        label={t("sync.summary_skipped")}
        value={summary.skipped}
        tone="muted"
      />
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  tone?: "danger" | "muted";
}) {
  const color =
    tone === "danger"
      ? value > 0
        ? "text-red-600 dark:text-red-400"
        : "text-zinc-400"
      : tone === "muted"
        ? "text-zinc-500"
        : "text-zinc-700 dark:text-zinc-200";
  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1.5">
      <div className={`flex items-center gap-1 ${color}`}>
        {icon}
        <span className="font-medium">{value}</span>
      </div>
      <p className="text-[10px] text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}

function StatusIcon({
  kind,
  status,
}: {
  kind: SyncActionKind;
  status?: SyncActionStatus;
}) {
  if (status === "started") {
    return <Loader2 size={12} className="animate-spin text-zinc-400" />;
  }
  if (status === "completed") {
    return <CheckCircle2 size={12} className="text-green-500" />;
  }
  if (status === "failed") {
    return <XCircle size={12} className="text-red-500" />;
  }
  // No status yet — show kind-based pending glyph
  if (kind === "skip") return <span className="text-zinc-400 text-xs">○</span>;
  return <span className="text-zinc-400 text-xs">·</span>;
}
