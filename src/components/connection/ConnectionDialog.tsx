import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useConnectionStore, type Connection, type ConnectionTestResult } from "@/stores/connectionStore";
import { tauriInvoke } from "@/lib/tauri";

interface ConnectionFormData {
  name: string;
  endpoint: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
  path_style: "auto" | "path" | "virtual";
  proxy: string;
  ca_bundle: string;
  timeout_secs: number;
  max_retries: number;
  notes: string;
  group: string;
}

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editConnection?: Connection | null;
}

/** Pre-configured provider templates */
const PROVIDER_PRESETS: Record<
  string,
  Partial<ConnectionFormData>
> = {
  custom: {},
  aws: {
    endpoint: "https://s3.eu-west-1.amazonaws.com",
    region: "eu-west-1",
    path_style: "virtual",
  },
  minio: {
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    path_style: "path",
  },
  backblaze: {
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    region: "us-west-004",
    path_style: "virtual",
  },
  wasabi: {
    endpoint: "https://s3.eu-central-1.wasabisys.com",
    region: "eu-central-1",
    path_style: "virtual",
  },
  cloudflare_r2: {
    endpoint: "https://<account-id>.r2.cloudflarestorage.com",
    region: "auto",
    path_style: "path",
  },
  digitalocean: {
    endpoint: "https://ams3.digitaloceanspaces.com",
    region: "ams3",
    path_style: "virtual",
  },
  gcs: {
    endpoint: "https://storage.googleapis.com",
    region: "auto",
    path_style: "path",
  },
  oracle: {
    endpoint: "https://<namespace>.compat.objectstorage.eu-milan-1.oraclecloud.com",
    region: "eu-milan-1",
    path_style: "path",
  },
  scaleway: {
    endpoint: "https://s3.fr-par.scw.cloud",
    region: "fr-par",
    path_style: "virtual",
  },
  ovh: {
    endpoint: "https://s3.gra.io.cloud.ovh.net",
    region: "gra",
    path_style: "virtual",
  },
  linode: {
    endpoint: "https://eu-central-1.linodeobjects.com",
    region: "eu-central-1",
    path_style: "virtual",
  },
  garage: {
    endpoint: "https://s3.example.com",
    region: "garage",
    path_style: "path",
  },
};

const PROVIDER_LABELS: Record<string, string> = {
  custom: "Custom / Other",
  aws: "Amazon S3",
  minio: "MinIO",
  backblaze: "Backblaze B2",
  wasabi: "Wasabi",
  cloudflare_r2: "Cloudflare R2",
  digitalocean: "DigitalOcean Spaces",
  gcs: "Google Cloud Storage",
  oracle: "Oracle Cloud (OCI)",
  scaleway: "Scaleway",
  ovh: "OVHcloud",
  linode: "Linode / Akamai",
  garage: "Garage",
};

export function ConnectionDialog({
  open,
  onOpenChange,
  editConnection,
}: ConnectionDialogProps) {
  const { t } = useTranslation();
  const createConnection = useConnectionStore((s) => s.createConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const testConnection = useConnectionStore((s) => s.testConnection);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("custom");

  const isEditing = !!editConnection;

  const blankFormValues: ConnectionFormData = {
    name: "",
    endpoint: "",
    region: "us-east-1",
    access_key_id: "",
    secret_access_key: "",
    session_token: "",
    path_style: "auto",
    proxy: "",
    ca_bundle: "",
    timeout_secs: 30,
    max_retries: 3,
    notes: "",
    group: "",
  };

  const valuesFromConnection = (c: Connection): ConnectionFormData => ({
    name: c.name,
    endpoint: c.endpoint,
    region: c.region,
    access_key_id: c.access_key_id,
    secret_access_key: "",
    session_token: "",
    path_style: c.path_style,
    proxy: c.proxy ?? "",
    ca_bundle: c.ca_bundle ?? "",
    timeout_secs: c.timeout_secs,
    max_retries: c.max_retries,
    notes: c.notes ?? "",
    group: c.group ?? "",
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<ConnectionFormData>({
    defaultValues: editConnection
      ? valuesFromConnection(editConnection)
      : blankFormValues,
  });

  // The dialog stays mounted in the Sidebar across open/close cycles
  // and switches between create/edit by changing `editConnection`.
  // react-hook-form only reads `defaultValues` on first mount, so we
  // must `reset(...)` whenever the user opens the dialog or picks a
  // different connection — otherwise edit shows blanks or stale data
  // from a previous session.
  useEffect(() => {
    if (!open) return;
    reset(
      editConnection ? valuesFromConnection(editConnection) : blankFormValues,
    );
    setTestResult(null);
    setSelectedPreset("custom");
    setShowAdvanced(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editConnection?.id]);

  const applyPreset = (presetKey: string) => {
    setSelectedPreset(presetKey);
    const preset = PROVIDER_PRESETS[presetKey];
    if (!preset) return;
    if (preset.endpoint) setValue("endpoint", preset.endpoint);
    if (preset.region) setValue("region", preset.region);
    if (preset.path_style) setValue("path_style", preset.path_style);
  };

  const onSubmit = async (data: ConnectionFormData) => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: data.name,
        endpoint: data.endpoint,
        region: data.region,
        access_key_id: data.access_key_id,
        path_style: data.path_style,
        timeout_secs: data.timeout_secs,
        max_retries: data.max_retries,
      };

      // In editing, an empty secret means "keep the current credential" —
      // include it only when the user actually typed something. For a
      // new connection it is required so we always send it.
      if (!isEditing || data.secret_access_key) {
        payload.secret_access_key = data.secret_access_key;
      }

      // Only include optional fields if non-empty
      if (data.session_token) payload.session_token = data.session_token;
      if (data.proxy) payload.proxy = data.proxy;
      if (data.ca_bundle) payload.ca_bundle = data.ca_bundle;
      if (data.notes) payload.notes = data.notes;
      if (data.group) payload.group = data.group;

      if (isEditing) {
        await updateConnection(editConnection.id, payload);
      } else {
        await createConnection(payload);
      }

      reset();
      setTestResult(null);
      onOpenChange(false);
    } catch (e) {
      setTestResult({ success: false, message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (isEditing) {
      setTesting(true);
      setTestResult(null);
      try {
        const result = await testConnection(editConnection.id);
        setTestResult({
          success: result.success,
          message: result.success
            ? `${t("connection.testSuccess")} — ${result.bucket_count} buckets, ${result.latency_ms}ms`
            : result.error ?? t("connection.testFail"),
        });
      } catch (e) {
        setTestResult({ success: false, message: String(e) });
      } finally {
        setTesting(false);
      }
    } else {
      // For new connections, test inline without saving
      setTesting(true);
      setTestResult(null);
      try {
        const data = getValues();
        const result = await tauriInvoke<ConnectionTestResult>(
          "test_connection_inline",
          {
            endpoint: data.endpoint,
            region: data.region,
            accessKeyId: data.access_key_id,
            secretAccessKey: data.secret_access_key,
            sessionToken: data.session_token || null,
            pathStyle: data.path_style,
          },
        );
        setTestResult({
          success: result.success,
          message: result.success
            ? `${t("connection.testSuccess")} — ${result.bucket_count} buckets, ${result.latency_ms}ms`
            : result.error ?? t("connection.testFail"),
        });
      } catch (e) {
        setTestResult({ success: false, message: String(e) });
      } finally {
        setTesting(false);
      }
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white dark:bg-zinc-900 rounded-lg shadow-xl z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 z-10">
            <Dialog.Title className="text-lg font-semibold">
              {isEditing
                ? `${t("connection.update")} — ${editConnection.name}`
                : t("sidebar.addConnection")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-4 space-y-4">
            {/* Provider preset selector */}
            {!isEditing && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">
                  Provider
                </label>
                <select
                  className="select-field w-full"
                  value={selectedPreset}
                  onChange={(e) => applyPreset(e.target.value)}
                >
                  {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Name */}
            <Field
              label={t("connection.name")}
              error={errors.name?.message}
              required
            >
              <input
                {...register("name", {
                  required: "Name is required",
                  minLength: { value: 1, message: "Name is required" },
                })}
                placeholder="My S3 Connection"
                className="input-field"
              />
            </Field>

            {/* Endpoint */}
            <Field
              label={t("connection.endpoint")}
              error={errors.endpoint?.message}
              required
            >
              <input
                {...register("endpoint", {
                  required: "Endpoint is required",
                  pattern: {
                    value: /^https?:\/\/.+/,
                    message: "Must start with http:// or https://",
                  },
                })}
                placeholder="https://s3.eu-west-1.amazonaws.com"
                className="input-field"
              />
            </Field>

            {/* Region */}
            <Field
              label={t("connection.region")}
              error={errors.region?.message}
              required
            >
              <input
                {...register("region", { required: "Region is required" })}
                placeholder="eu-west-1"
                className="input-field"
              />
            </Field>

            {/* Access Key ID */}
            <Field
              label={t("connection.accessKeyId")}
              error={errors.access_key_id?.message}
              required
            >
              <input
                {...register("access_key_id", {
                  required: "Access Key ID is required",
                })}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className="input-field font-mono"
              />
            </Field>

            {/* Secret Access Key */}
            <Field
              label={t("connection.secretAccessKey")}
              error={errors.secret_access_key?.message}
              required={!isEditing}
            >
              <input
                type="password"
                {...register("secret_access_key", {
                  required: isEditing ? false : "Secret Access Key is required",
                })}
                placeholder={
                  isEditing ? "(leave empty to keep current)" : ""
                }
                className="input-field font-mono"
              />
            </Field>

            {/* Path Style */}
            <Field label={t("connection.pathStyle")}>
              <select {...register("path_style")} className="select-field w-full">
                <option value="auto">Auto</option>
                <option value="path">Path Style</option>
                <option value="virtual">Virtual Hosted</option>
              </select>
            </Field>

            {/* Advanced toggle */}
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? (
                <ChevronUp size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
              Advanced Settings
            </button>

            {showAdvanced && (
              <div className="space-y-4 pl-2 border-l-2 border-zinc-200 dark:border-zinc-700">
                {/* Session Token */}
                <Field label={t("connection.sessionToken")}>
                  <input
                    {...register("session_token")}
                    placeholder="Optional"
                    className="input-field font-mono"
                  />
                </Field>

                {/* Proxy */}
                <Field label={t("connection.proxy")}>
                  <input
                    {...register("proxy")}
                    placeholder="http://proxy:8080 or socks5://proxy:1080"
                    className="input-field"
                  />
                </Field>

                {/* CA Bundle */}
                <Field label={t("connection.caBundle")}>
                  <input
                    {...register("ca_bundle")}
                    placeholder="/path/to/ca-bundle.crt"
                    className="input-field"
                  />
                </Field>

                {/* Timeout + Retries */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("connection.timeout")}>
                    <input
                      type="number"
                      {...register("timeout_secs", {
                        valueAsNumber: true,
                        min: 1,
                        max: 300,
                      })}
                      className="input-field"
                    />
                  </Field>
                  <Field label={t("connection.maxRetries")}>
                    <input
                      type="number"
                      {...register("max_retries", {
                        valueAsNumber: true,
                        min: 0,
                        max: 10,
                      })}
                      className="input-field"
                    />
                  </Field>
                </div>

                {/* Group */}
                <Field label={t("connection.group")}>
                  <input
                    {...register("group")}
                    placeholder="Production, Staging, Dev..."
                    className="input-field"
                  />
                </Field>

                {/* Notes */}
                <Field label={t("connection.notes")}>
                  <textarea
                    {...register("notes")}
                    rows={2}
                    placeholder="Optional notes..."
                    className="input-field resize-none"
                  />
                </Field>
              </div>
            )}

            {/* Test result */}
            {testResult && (
              <div
                className={`flex items-start gap-2 p-3 rounded-md text-sm ${
                  testResult.success
                    ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                    : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                )}
                <span className="break-all">{testResult.message}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                onClick={handleTest}
                disabled={testing || saving}
              >
                {testing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                {t("connection.test")}
              </button>

              <div className="flex gap-2">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {t("connection.cancel")}
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin inline mr-1" />
                  ) : null}
                  {isEditing ? t("connection.update") : t("connection.create")}
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Reusable form field wrapper */
function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-500 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
