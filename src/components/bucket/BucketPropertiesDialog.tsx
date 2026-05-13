import { tauriInvoke } from "@/lib/tauri";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  History,
  Loader2,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
              <p className="text-xs text-zinc-500 font-mono truncate">
                {bucket}
              </p>
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
              <TabTrigger
                value="versioning"
                icon={<History size={14} />}
                label={t("bucketProperties.tabs.versioning")}
              />
              <TabTrigger
                value="encryption"
                icon={<Lock size={14} />}
                label={t("bucketProperties.tabs.encryption")}
              />
              <TabTrigger
                value="policy"
                icon={<FileText size={14} />}
                label={t("bucketProperties.tabs.policy")}
              />
              <TabTrigger
                value="cors"
                icon={<Globe size={14} />}
                label="CORS"
              />
              <TabTrigger
                value="lifecycle"
                icon={<Clock size={14} />}
                label={t("bucketProperties.tabs.lifecycle")}
              />
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
                <CorsTab
                  connectionId={connectionId}
                  bucket={bucket}
                  active={open}
                />
              </Tabs.Content>
              <Tabs.Content value="lifecycle">
                <LifecycleTab
                  connectionId={connectionId}
                  bucket={bucket}
                  active={open}
                />
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
      const result = await tauriInvoke<BucketVersioning>(
        "get_bucket_versioning",
        {
          connectionId,
          bucket,
        },
      );
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
          kmsMasterKeyId:
            algorithm === "aws:kms" && kmsKey.trim() ? kmsKey.trim() : null,
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

  const currentLabel = !current
    ? t("bucketProperties.encryption.statusNone")
    : current.algorithm === "AES256"
      ? t("bucketProperties.encryption.statusSseS3")
      : current.algorithm.startsWith("aws:kms")
        ? t("bucketProperties.encryption.statusSseKms")
        : current.algorithm;

  return (
    <div className="space-y-5">
      <div className="rounded-md px-4 py-3 text-sm bg-zinc-50 dark:bg-zinc-800/50 flex items-start gap-2">
        {loading ? (
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
        ) : current ? (
          <CheckCircle2
            size={16}
            className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
        ) : (
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-zinc-400" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium">
            {loading ? t("bucketProperties.encryption.loading") : currentLabel}
          </p>
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
          <option value="none">
            {t("bucketProperties.encryption.algoNone")}
          </option>
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
          {submitting ? (
            <Loader2 size={14} className="animate-spin inline mr-1.5" />
          ) : null}
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
          <CheckCircle2
            size={16}
            className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
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
          {submitting ? (
            <Loader2 size={14} className="animate-spin inline mr-1.5" />
          ) : null}
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

// --- CORS tab -----------------------------------------------------------

interface CorsRule {
  id: string | null;
  allowed_methods: string[];
  allowed_origins: string[];
  allowed_headers: string[];
  expose_headers: string[];
  max_age_seconds: number | null;
}

const HTTP_METHODS = ["GET", "PUT", "POST", "DELETE", "HEAD"] as const;

function emptyRule(): CorsRule {
  return {
    id: null,
    allowed_methods: ["GET"],
    allowed_origins: ["*"],
    allowed_headers: [],
    expose_headers: [],
    max_age_seconds: null,
  };
}

function CorsTab({
  connectionId,
  bucket,
  active,
}: {
  connectionId: string;
  bucket: string;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [original, setOriginal] = useState<CorsRule[] | null>(null);
  const [rules, setRules] = useState<CorsRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriInvoke<CorsRule[] | null>("get_bucket_cors", {
        connectionId,
        bucket,
      });
      setOriginal(result);
      setRules(result ? structuredClone(result) : []);
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

  const save = async () => {
    setError(null);
    // Server-side will reject empty methods/origins but a quick check
    // makes the error clearer.
    for (const r of rules) {
      if (r.allowed_methods.length === 0) {
        setError(t("bucketProperties.cors.errorNoMethods"));
        return;
      }
      if (r.allowed_origins.length === 0) {
        setError(t("bucketProperties.cors.errorNoOrigins"));
        return;
      }
    }
    setSubmitting(true);
    try {
      await tauriInvoke("set_bucket_cors", { connectionId, bucket, rules });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const removeAll = async () => {
    if (!original) return;
    setError(null);
    setSubmitting(true);
    try {
      await tauriInvoke("delete_bucket_cors", { connectionId, bucket });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const updateRule = (idx: number, patch: Partial<CorsRule>) => {
    setRules((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  };
  const removeRule = (idx: number) => {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  };
  const addRule = () => {
    setRules((prev) => [...prev, emptyRule()]);
  };

  const hasCors = original !== null;
  const dirty = JSON.stringify(rules) !== JSON.stringify(original ?? []);

  return (
    <div className="space-y-4">
      <div className="rounded-md px-4 py-3 text-sm bg-zinc-50 dark:bg-zinc-800/50 flex items-start gap-2">
        {loading ? (
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
        ) : hasCors ? (
          <CheckCircle2
            size={16}
            className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
        ) : (
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-zinc-400" />
        )}
        <p className="font-medium flex-1">
          {loading
            ? t("bucketProperties.cors.loading")
            : hasCors
              ? t("bucketProperties.cors.statusAttached", {
                  count: original.length,
                })
              : t("bucketProperties.cors.statusNone")}
        </p>
      </div>

      <p className="text-xs text-zinc-500 leading-relaxed">
        {t("bucketProperties.cors.description")}
      </p>

      <div className="space-y-3">
        {rules.map((rule, idx) => (
          <CorsRuleCard
            key={idx}
            rule={rule}
            onChange={(patch) => updateRule(idx, patch)}
            onRemove={() => removeRule(idx)}
            disabled={loading || submitting}
          />
        ))}
        {rules.length === 0 && !loading && (
          <div className="text-xs text-zinc-500 py-4 text-center border border-dashed border-zinc-200 dark:border-zinc-700 rounded-md">
            {t("bucketProperties.cors.empty")}
          </div>
        )}
        <button
          type="button"
          onClick={addRule}
          disabled={loading || submitting}
          className="w-full px-3 py-2 text-xs border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600 rounded-md disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          <Plus size={12} />
          {t("bucketProperties.cors.addRule")}
        </button>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={save}
          disabled={loading || submitting || !dirty || rules.length === 0}
          className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin inline mr-1.5" />
          ) : null}
          {t("common.save")}
        </button>
        <button
          type="button"
          onClick={removeAll}
          disabled={loading || submitting || !hasCors}
          className="px-3 py-2 text-sm border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"
        >
          {t("bucketProperties.cors.deleteAll")}
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

function CorsRuleCard({
  rule,
  onChange,
  onRemove,
  disabled,
}: {
  rule: CorsRule;
  onChange: (patch: Partial<CorsRule>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();

  const toggleMethod = (m: string) => {
    const has = rule.allowed_methods.includes(m);
    onChange({
      allowed_methods: has
        ? rule.allowed_methods.filter((x) => x !== m)
        : [...rule.allowed_methods, m],
    });
  };

  const setLines = (key: keyof CorsRule, raw: string) => {
    const lines = raw
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    onChange({ [key]: lines } as Partial<CorsRule>);
  };

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-md p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          className="input-field text-xs flex-1"
          placeholder={t("bucketProperties.cors.ruleIdPlaceholder")}
          value={rule.id ?? ""}
          onChange={(e) => onChange({ id: e.target.value || null })}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-zinc-400 hover:text-red-500 disabled:opacity-40"
          title={t("bucketProperties.cors.removeRule")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-zinc-500 mb-1.5">
          {t("bucketProperties.cors.methods")}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {HTTP_METHODS.map((m) => {
            const active = rule.allowed_methods.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleMethod(m)}
                disabled={disabled}
                className={`px-2 py-1 text-[11px] rounded border font-mono ${
                  active
                    ? "bg-brand-600 text-white border-brand-600"
                    : "border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      <CorsList
        label={t("bucketProperties.cors.origins")}
        placeholder="*"
        values={rule.allowed_origins}
        onChange={(v) => setLines("allowed_origins", v)}
        disabled={disabled}
      />
      <CorsList
        label={t("bucketProperties.cors.headers")}
        placeholder="Content-Type"
        values={rule.allowed_headers}
        onChange={(v) => setLines("allowed_headers", v)}
        disabled={disabled}
      />
      <CorsList
        label={t("bucketProperties.cors.exposeHeaders")}
        placeholder="ETag"
        values={rule.expose_headers}
        onChange={(v) => setLines("expose_headers", v)}
        disabled={disabled}
      />

      <div>
        <label className="block text-[11px] font-medium text-zinc-500 mb-1">
          {t("bucketProperties.cors.maxAge")}
        </label>
        <input
          type="number"
          min={0}
          className="input-field text-xs w-40"
          placeholder="3600"
          value={rule.max_age_seconds ?? ""}
          onChange={(e) =>
            onChange({
              max_age_seconds:
                e.target.value === "" ? null : Number(e.target.value),
            })
          }
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function CorsList({
  label,
  placeholder,
  values,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (raw: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-zinc-500 mb-1">
        {label}
      </label>
      <textarea
        className="input-field text-xs font-mono w-full"
        rows={Math.max(2, values.length + 1)}
        spellCheck={false}
        placeholder={placeholder}
        defaultValue={values.join("\n")}
        onBlur={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

// --- Lifecycle tab ------------------------------------------------------

interface LifecycleTransition {
  days: number;
  storage_class: string;
}
interface LifecycleNoncurrentTransition {
  noncurrent_days: number;
  storage_class: string;
}
interface LifecycleRule {
  id: string | null;
  status: string; // "Enabled" | "Disabled"
  prefix: string | null;
  transitions: LifecycleTransition[];
  expiration_days: number | null;
  expired_object_delete_marker: boolean | null;
  noncurrent_version_transitions: LifecycleNoncurrentTransition[];
  noncurrent_version_expiration_days: number | null;
  abort_incomplete_multipart_upload_days: number | null;
}
interface LifecycleSnapshot {
  rules: LifecycleRule[];
  has_unsupported: boolean;
}

const STORAGE_CLASSES = [
  "STANDARD_IA",
  "ONEZONE_IA",
  "INTELLIGENT_TIERING",
  "GLACIER_IR",
  "GLACIER",
  "DEEP_ARCHIVE",
];

function emptyLifecycleRule(): LifecycleRule {
  return {
    id: null,
    status: "Enabled",
    prefix: null,
    transitions: [],
    expiration_days: null,
    expired_object_delete_marker: null,
    noncurrent_version_transitions: [],
    noncurrent_version_expiration_days: null,
    abort_incomplete_multipart_upload_days: null,
  };
}

function LifecycleTab({
  connectionId,
  bucket,
  active,
}: {
  connectionId: string;
  bucket: string;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [original, setOriginal] = useState<LifecycleSnapshot | null>(null);
  const [rules, setRules] = useState<LifecycleRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriInvoke<LifecycleSnapshot | null>(
        "get_bucket_lifecycle",
        { connectionId, bucket },
      );
      setOriginal(result);
      setRules(result ? structuredClone(result.rules) : []);
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

  const save = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await tauriInvoke("set_bucket_lifecycle", {
        connectionId,
        bucket,
        rules,
      });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const removeAll = async () => {
    if (!original) return;
    setError(null);
    setSubmitting(true);
    try {
      await tauriInvoke("delete_bucket_lifecycle", { connectionId, bucket });
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const updateRule = (idx: number, patch: Partial<LifecycleRule>) =>
    setRules((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  const removeRule = (idx: number) =>
    setRules((prev) => prev.filter((_, i) => i !== idx));
  const addRule = () => setRules((prev) => [...prev, emptyLifecycleRule()]);

  const hasConfig = original !== null;
  const hasUnsupported = original?.has_unsupported ?? false;
  const dirty = JSON.stringify(rules) !== JSON.stringify(original?.rules ?? []);

  return (
    <div className="space-y-4">
      <div
        className={`rounded-md px-4 py-3 text-sm flex items-start gap-2 ${
          hasUnsupported
            ? "bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200"
            : "bg-zinc-50 dark:bg-zinc-800/50"
        }`}
      >
        {loading ? (
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
        ) : hasUnsupported ? (
          <AlertCircle
            size={16}
            className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
          />
        ) : hasConfig ? (
          <CheckCircle2
            size={16}
            className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
          />
        ) : (
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-zinc-400" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium">
            {loading
              ? t("bucketProperties.lifecycle.loading")
              : hasUnsupported
                ? t("bucketProperties.lifecycle.statusUnsupported")
                : hasConfig
                  ? t("bucketProperties.lifecycle.statusAttached", {
                      count: rules.length,
                    })
                  : t("bucketProperties.lifecycle.statusNone")}
          </p>
          {hasUnsupported && (
            <p className="text-xs mt-1 opacity-80">
              {t("bucketProperties.lifecycle.unsupportedHint")}
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-zinc-500 leading-relaxed">
        {t("bucketProperties.lifecycle.description")}
      </p>

      {!hasUnsupported && (
        <>
          <div className="space-y-3">
            {rules.map((rule, idx) => (
              <LifecycleRuleCard
                key={idx}
                rule={rule}
                onChange={(patch) => updateRule(idx, patch)}
                onRemove={() => removeRule(idx)}
                disabled={loading || submitting}
              />
            ))}
            {rules.length === 0 && !loading && (
              <div className="text-xs text-zinc-500 py-4 text-center border border-dashed border-zinc-200 dark:border-zinc-700 rounded-md">
                {t("bucketProperties.lifecycle.empty")}
              </div>
            )}
            <button
              type="button"
              onClick={addRule}
              disabled={loading || submitting}
              className="w-full px-3 py-2 text-xs border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600 rounded-md disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              <Plus size={12} />
              {t("bucketProperties.lifecycle.addRule")}
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={save}
              disabled={loading || submitting || !dirty || rules.length === 0}
              className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin inline mr-1.5" />
              ) : null}
              {t("common.save")}
            </button>
            <button
              type="button"
              onClick={removeAll}
              disabled={loading || submitting || !hasConfig}
              className="px-3 py-2 text-sm border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"
            >
              {t("bucketProperties.lifecycle.deleteAll")}
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
        </>
      )}

      {hasUnsupported && (
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={removeAll}
            disabled={loading || submitting}
            className="px-3 py-2 text-sm border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40"
          >
            {t("bucketProperties.lifecycle.deleteAll")}
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
      )}

      {error && (
        <div className="rounded-md px-3 py-2 text-xs bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 break-all">
          {error}
        </div>
      )}
    </div>
  );
}

function LifecycleRuleCard({
  rule,
  onChange,
  onRemove,
  disabled,
}: {
  rule: LifecycleRule;
  onChange: (patch: Partial<LifecycleRule>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();

  const setTransitions = (transitions: LifecycleTransition[]) =>
    onChange({ transitions });
  const setNct = (ncts: LifecycleNoncurrentTransition[]) =>
    onChange({ noncurrent_version_transitions: ncts });

  const numOrNull = (raw: string): number | null =>
    raw.trim() === "" ? null : Math.max(0, Number(raw));

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-md p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          className="input-field text-xs flex-1"
          placeholder={t("bucketProperties.lifecycle.ruleIdPlaceholder")}
          value={rule.id ?? ""}
          onChange={(e) => onChange({ id: e.target.value || null })}
          disabled={disabled}
        />
        <select
          className="select-field text-xs"
          value={rule.status}
          onChange={(e) => onChange({ status: e.target.value })}
          disabled={disabled}
        >
          <option value="Enabled">
            {t("bucketProperties.lifecycle.enabled")}
          </option>
          <option value="Disabled">
            {t("bucketProperties.lifecycle.disabled")}
          </option>
        </select>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-zinc-400 hover:text-red-500 disabled:opacity-40"
          title={t("bucketProperties.lifecycle.removeRule")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-zinc-500 mb-1">
          {t("bucketProperties.lifecycle.prefix")}
        </label>
        <input
          type="text"
          className="input-field text-xs w-full font-mono"
          placeholder={t("bucketProperties.lifecycle.prefixPlaceholder")}
          value={rule.prefix ?? ""}
          onChange={(e) => onChange({ prefix: e.target.value || null })}
          disabled={disabled}
        />
      </div>

      {/* Transitions */}
      <div>
        <label className="block text-[11px] font-medium text-zinc-500 mb-1">
          {t("bucketProperties.lifecycle.transitions")}
        </label>
        <div className="space-y-1.5">
          {rule.transitions.map((tx, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                className="input-field text-xs w-24"
                value={tx.days}
                onChange={(e) => {
                  const next = [...rule.transitions];
                  next[i] = { ...next[i], days: Number(e.target.value) };
                  setTransitions(next);
                }}
                disabled={disabled}
              />
              <span className="text-[11px] text-zinc-500">
                {t("bucketProperties.lifecycle.daysTo")}
              </span>
              <select
                className="select-field text-xs flex-1"
                value={tx.storage_class}
                onChange={(e) => {
                  const next = [...rule.transitions];
                  next[i] = { ...next[i], storage_class: e.target.value };
                  setTransitions(next);
                }}
                disabled={disabled}
              >
                {STORAGE_CLASSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setTransitions(rule.transitions.filter((_, j) => j !== i))
                }
                disabled={disabled}
                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-zinc-400 hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setTransitions([
                ...rule.transitions,
                { days: 30, storage_class: STORAGE_CLASSES[0] },
              ])
            }
            disabled={disabled}
            className="text-xs text-brand-600 hover:underline disabled:opacity-40 flex items-center gap-1"
          >
            <Plus size={12} />
            {t("bucketProperties.lifecycle.addTransition")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-zinc-500 mb-1">
            {t("bucketProperties.lifecycle.expirationDays")}
          </label>
          <input
            type="number"
            min={0}
            className="input-field text-xs w-full"
            placeholder="—"
            value={rule.expiration_days ?? ""}
            onChange={(e) =>
              onChange({ expiration_days: numOrNull(e.target.value) })
            }
            disabled={disabled}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-zinc-500 mb-1">
            {t("bucketProperties.lifecycle.abortMultipartDays")}
          </label>
          <input
            type="number"
            min={0}
            className="input-field text-xs w-full"
            placeholder="—"
            value={rule.abort_incomplete_multipart_upload_days ?? ""}
            onChange={(e) =>
              onChange({
                abort_incomplete_multipart_upload_days: numOrNull(
                  e.target.value,
                ),
              })
            }
            disabled={disabled}
          />
        </div>
      </div>

      {/* Noncurrent versions */}
      <div>
        <label className="block text-[11px] font-medium text-zinc-500 mb-1">
          {t("bucketProperties.lifecycle.noncurrentTransitions")}
        </label>
        <div className="space-y-1.5">
          {rule.noncurrent_version_transitions.map((tx, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                className="input-field text-xs w-24"
                value={tx.noncurrent_days}
                onChange={(e) => {
                  const next = [...rule.noncurrent_version_transitions];
                  next[i] = {
                    ...next[i],
                    noncurrent_days: Number(e.target.value),
                  };
                  setNct(next);
                }}
                disabled={disabled}
              />
              <span className="text-[11px] text-zinc-500">
                {t("bucketProperties.lifecycle.daysTo")}
              </span>
              <select
                className="select-field text-xs flex-1"
                value={tx.storage_class}
                onChange={(e) => {
                  const next = [...rule.noncurrent_version_transitions];
                  next[i] = { ...next[i], storage_class: e.target.value };
                  setNct(next);
                }}
                disabled={disabled}
              >
                {STORAGE_CLASSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  setNct(
                    rule.noncurrent_version_transitions.filter(
                      (_, j) => j !== i,
                    ),
                  )
                }
                disabled={disabled}
                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-zinc-400 hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setNct([
                ...rule.noncurrent_version_transitions,
                { noncurrent_days: 30, storage_class: STORAGE_CLASSES[0] },
              ])
            }
            disabled={disabled}
            className="text-xs text-brand-600 hover:underline disabled:opacity-40 flex items-center gap-1"
          >
            <Plus size={12} />
            {t("bucketProperties.lifecycle.addNoncurrentTransition")}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-zinc-500 mb-1">
          {t("bucketProperties.lifecycle.noncurrentExpirationDays")}
        </label>
        <input
          type="number"
          min={0}
          className="input-field text-xs w-40"
          placeholder="—"
          value={rule.noncurrent_version_expiration_days ?? ""}
          onChange={(e) =>
            onChange({
              noncurrent_version_expiration_days: numOrNull(e.target.value),
            })
          }
          disabled={disabled}
        />
      </div>
    </div>
  );
}
