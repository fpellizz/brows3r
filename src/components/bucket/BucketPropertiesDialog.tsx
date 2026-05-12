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
                <EncryptionTab
                  connectionId={connectionId}
                  bucket={bucket}
                  active={open}
                />
              </Tabs.Content>
              <Tabs.Content value="policy">
                <PolicyTab
                  connectionId={connectionId}
                  bucket={bucket}
                  active={open}
                />
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

// --- Encryption tab -----------------------------------------------------

interface BucketEncryption {
  algorithm: string;
  kms_master_key_id: string | null;
  bucket_key_enabled: boolean | null;
}

type AlgorithmChoice = "none" | "AES256" | "aws:kms";

function EncryptionTab({
  connectionId,
  bucket,
  active,
}: {
  connectionId: string;
  bucket: string;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<BucketEncryption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [algorithm, setAlgorithm] = useState<AlgorithmChoice>("none");
  const [kmsKey, setKmsKey] = useState("");
  const [bucketKey, setBucketKey] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriInvoke<BucketEncryption | null>(
        "get_bucket_encryption",
        { connectionId, bucket },
      );
      setCurrent(result);
      if (result) {
        setAlgorithm(
          result.algorithm === "AES256"
            ? "AES256"
            : result.algorithm.startsWith("aws:kms")
              ? "aws:kms"
              : "none",
        );
        setKmsKey(result.kms_master_key_id ?? "");
        setBucketKey(result.bucket_key_enabled ?? false);
      } else {
        setAlgorithm("none");
        setKmsKey("");
        setBucketKey(false);
      }
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

  const apply = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (algorithm === "none") {
        await tauriInvoke("delete_bucket_encryption", { connectionId, bucket });
      } else {
        await tauriInvoke("set_bucket_encryption", {
          connectionId,
          bucket,
          algorithm,
          kmsMasterKeyId: algorithm === "aws:kms" && kmsKey.trim() ? kmsKey.trim() : null,
          bucketKeyEnabled: algorithm === "aws:kms" ? bucketKey : null,
        });
      }
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const currentLabel =
    !current ? t("bucketProperties.encryption.statusNone")
      : current.algorithm === "AES256" ? t("bucketProperties.encryption.statusSseS3")
      : current.algorithm.startsWith("aws:kms") ? t("bucketProperties.encryption.statusSseKms")
      : current.algorithm;

  return (
    <div className="space-y-5">
      <div className="rounded-md px-4 py-3 text-sm bg-zinc-50 dark:bg-zinc-800/50 flex items-start gap-2">
        {loading ? (
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
        ) : current ? (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-zinc-400" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium">{loading ? t("bucketProperties.encryption.loading") : currentLabel}</p>
          {current?.kms_master_key_id && (
            <p className="text-xs mt-1 text-zinc-500 font-mono break-all">
              {current.kms_master_key_id}
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-zinc-500 leading-relaxed">
        {t("bucketProperties.encryption.description")}
      </p>

      <div className="space-y-3">
        <label className="block text-xs font-medium text-zinc-500">
          {t("bucketProperties.encryption.algorithm")}
        </label>
        <select
          className="select-field w-full"
          value={algorithm}
          onChange={(e) => setAlgorithm(e.target.value as AlgorithmChoice)}
          disabled={loading || submitting}
        >
          <option value="none">{t("bucketProperties.encryption.algoNone")}</option>
          <option value="AES256">SSE-S3 (AES256)</option>
          <option value="aws:kms">SSE-KMS</option>
        </select>

        {algorithm === "aws:kms" && (
          <>
            <label className="block text-xs font-medium text-zinc-500 mt-3">
              {t("bucketProperties.encryption.kmsKey")}
            </label>
            <input
              type="text"
              className="input-field w-full font-mono text-xs"
              placeholder="arn:aws:kms:region:account:key/uuid (default key if empty)"
              value={kmsKey}
              onChange={(e) => setKmsKey(e.target.value)}
              disabled={loading || submitting}
            />
            <label className="flex items-center gap-2 mt-2 text-sm">
              <input
                type="checkbox"
                checked={bucketKey}
                onChange={(e) => setBucketKey(e.target.checked)}
                disabled={loading || submitting}
              />
              <span>{t("bucketProperties.encryption.bucketKey")}</span>
            </label>
            <p className="text-xs text-zinc-500">
              {t("bucketProperties.encryption.bucketKeyHint")}
            </p>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={loading || submitting}
          className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 size={14} className="animate-spin inline mr-1.5" /> : null}
          {t("common.save")}
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

// --- Policy tab ---------------------------------------------------------

function PolicyTab({
  connectionId,
  bucket,
  active,
}: {
  connectionId: string;
  bucket: string;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriInvoke<string | null>("get_bucket_policy", {
        connectionId,
        bucket,
      });
      setOriginal(result);
      setDraft(result ? prettify(result) : "");
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

  const format = () => {
    setParseError(null);
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, 2));
    } catch (e) {
      setParseError(String(e));
    }
  };

  const save = async () => {
    setParseError(null);
    setError(null);
    // Validate JSON client-side so the user sees the syntax error
    // immediately rather than as an S3 MalformedPolicy at network time.
    try {
      JSON.parse(draft);
    } catch (e) {
      setParseError(String(e));
      return;
    }
    setSubmitting(true);
    try {
      await tauriInvoke("set_bucket_policy", {
        connectionId,
        bucket,
        policy: draft,
      });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!original) return;
    setError(null);
    setSubmitting(true);
    try {
      await tauriInvoke("delete_bucket_policy", { connectionId, bucket });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const hasPolicy = original !== null;
  const dirty = draft.trim() !== (original ? prettify(original) : "").trim();

  return (
    <div className="space-y-4">
      <div className="rounded-md px-4 py-3 text-sm bg-zinc-50 dark:bg-zinc-800/50 flex items-start gap-2">
        {loading ? (
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
        ) : hasPolicy ? (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-zinc-400" />
        )}
        <p className="font-medium flex-1">
          {loading
            ? t("bucketProperties.policy.loading")
            : hasPolicy
              ? t("bucketProperties.policy.statusAttached")
              : t("bucketProperties.policy.statusNone")}
        </p>
      </div>

      <p className="text-xs text-zinc-500 leading-relaxed">
        {t("bucketProperties.policy.description")}
      </p>

      <textarea
        className="input-field w-full font-mono text-xs"
        rows={14}
        spellCheck={false}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (parseError) setParseError(null);
        }}
        disabled={loading || submitting}
        placeholder='{ "Version": "2012-10-17", "Statement": [ ... ] }'
      />

      {parseError && (
        <div className="rounded-md px-3 py-2 text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 break-all">
          {t("bucketProperties.policy.invalidJson")}: {parseError}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={loading || submitting || !draft.trim() || !dirty}
          className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? <Loader2 size={14} className="animate-spin inline mr-1.5" /> : null}
          {t("common.save")}
        </button>
        <button
          type="button"
          onClick={format}
          disabled={loading || submitting || !draft.trim()}
          className="px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
        >
          {t("bucketProperties.policy.format")}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={loading || submitting || !hasPolicy}
          className="px-3 py-2 text-sm border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"
        >
          {t("bucketProperties.policy.deletePolicy")}
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

function prettify(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
