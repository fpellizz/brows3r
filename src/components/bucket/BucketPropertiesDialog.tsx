import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X, History, Lock, FileText, Globe, Clock, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { tauriInvoke } from "@/lib/tauri";

interface BucketPropertiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  bucket: string;
}

type VersioningStatus = "Enabled" | "Suspended" | "Unversioned" | string;
interface BucketVersioning {
  status: VersioningStatus;
  mfa_delete: boolean;
}

export function BucketPropertiesDialog({
  open,
  onOpenChange,
  connectionId,
  bucket,
}: BucketPropertiesDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh] overflow-hidden bg-white dark:bg-zinc-900 rounded-lg shadow-xl z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold truncate">
                {t("bucketProperties.title")}
              </Dialog.Title>
              <p className="text-xs text-zinc-500 font-mono truncate">{bucket}</p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          {/* Tabs */}
          <Tabs.Root
            defaultValue="versioning"
            className="flex-1 flex flex-col min-h-0"
          >
            <Tabs.List className="flex border-b border-zinc-200 dark:border-zinc-800 px-6 shrink-0 overflow-x-auto">
              <TabTrigger value="versioning" icon={<History size={14} />} label={t("bucketProperties.tabs.versioning")} />
              <TabTrigger value="encryption" icon={<Lock size={14} />} label={t("bucketProperties.tabs.encryption")} />
              <TabTrigger value="policy" icon={<FileText size={14} />} label={t("bucketProperties.tabs.policy")} />
              <TabTrigger value="cors" icon={<Globe size={14} />} label="CORS" />
              <TabTrigger value="lifecycle" icon={<Clock size={14} />} label={t("bucketProperties.tabs.lifecycle")} />
            </Tabs.List>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <Tabs.Content value="versioning">
                <VersioningTab
                  connectionId={connectionId}
                  bucket={bucket}
                  active={open}
                />
              </Tabs.Content>
              <Tabs.Content value="encryption">
                <ComingSoon name="Encryption" />
              </Tabs.Content>
              <Tabs.Content value="policy">
                <ComingSoon name="Policy" />
              </Tabs.Content>
              <Tabs.Content value="cors">
                <ComingSoon name="CORS" />
              </Tabs.Content>
              <Tabs.Content value="lifecycle">
                <ComingSoon name="Lifecycle" />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TabTrigger({
  value,
  icon,
  label,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Tabs.Trigger
      value={value}
      className="flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 data-[state=active]:border-brand-500 data-[state=active]:text-zinc-900 dark:data-[state=active]:text-zinc-100"
    >
      {icon}
      {label}
    </Tabs.Trigger>
  );
}

function ComingSoon({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <div className="text-sm text-zinc-500 py-8 text-center">
      {t("bucketProperties.comingSoon", { feature: name })}
    </div>
  );
}

// --- Versioning tab -----------------------------------------------------

function VersioningTab({
  connectionId,
  bucket,
  active,
}: {
  connectionId: string;
  bucket: string;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BucketVersioning | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriInvoke<BucketVersioning>("get_bucket_versioning", {
        connectionId,
        bucket,
      });
      setStatus(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, connectionId, bucket]);

  const apply = async (enable: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      await tauriInvoke("set_bucket_versioning", {
        connectionId,
        bucket,
        enabled: enable,
      });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const isEnabled = status?.status === "Enabled";
  const isSuspended = status?.status === "Suspended";

  return (
    <div className="space-y-5">
      {/* Current status banner */}
      <div
        className={`rounded-md px-4 py-3 text-sm flex items-start gap-2 ${
          isEnabled
            ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
            : isSuspended
              ? "bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200"
              : "bg-zinc-50 dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {loading ? (
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
        ) : isEnabled ? (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        ) : (
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium">
            {loading
              ? t("bucketProperties.versioning.loading")
              : isEnabled
                ? t("bucketProperties.versioning.statusEnabled")
                : isSuspended
                  ? t("bucketProperties.versioning.statusSuspended")
                  : t("bucketProperties.versioning.statusUnversioned")}
          </p>
          {status?.mfa_delete && (
            <p className="text-xs mt-1 opacity-80">
              {t("bucketProperties.versioning.mfaDeleteOn")}
            </p>
          )}
        </div>
      </div>

      {/* Explanation */}
      <p className="text-xs text-zinc-500 leading-relaxed">
        {t("bucketProperties.versioning.description")}
      </p>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => apply(true)}
          disabled={loading || submitting || isEnabled}
          className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin inline mr-1.5" />
          ) : null}
          {t("bucketProperties.versioning.enable")}
        </button>
        <button
          type="button"
          onClick={() => apply(false)}
          disabled={loading || submitting || !isEnabled}
          className="px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("bucketProperties.versioning.suspend")}
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || submitting}
          className="ml-auto px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-40"
        >
          {t("common.refresh")}
        </button>
      </div>

      {error && (
        <div className="rounded-md px-3 py-2 text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 break-all">
          {error}
        </div>
      )}
    </div>
  );
}
