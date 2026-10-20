import { formatBytes } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import * as Dialog from "@radix-ui/react-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open as openShell } from "@tauri-apps/plugin-shell";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface ObjectVersion {
  key: string;
  version_id: string;
  is_latest: boolean;
  is_delete_marker: boolean;
  size: number;
  last_modified: string | null;
  etag: string | null;
  storage_class: string | null;
}

interface ListObjectVersionsResponse {
  versions: ObjectVersion[];
  next_key_marker: string | null;
  next_version_id_marker: string | null;
  is_truncated: boolean;
}

interface BucketVersioningStatus {
  status: string;
  mfa_delete: boolean;
}

interface VersionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  bucket: string;
  objectKey: string;
  onChanged?: () => void;
}

export function VersionsDialog({
  open,
  onOpenChange,
  connectionId,
  bucket,
  objectKey,
  onChanged,
}: VersionsDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<ObjectVersion[]>([]);
  const [versioningStatus, setVersioningStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyVersion, setBusyVersion] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [status, resp] = await Promise.all([
        tauriInvoke<BucketVersioningStatus>("get_bucket_versioning", {
          connectionId,
          bucket,
        }),
        tauriInvoke<ListObjectVersionsResponse>("list_object_versions", {
          request: {
            connection_id: connectionId,
            bucket,
            prefix: objectKey,
            key_marker: null,
            version_id_marker: null,
            max_keys: 500,
          },
        }),
      ]);
      setVersioningStatus(status.status);
      // Filter to versions of EXACTLY this key (list_object_versions uses
      // prefix matching, so `foo` also matches `foo-bar`).
      setVersions(resp.versions.filter((v) => v.key === objectKey));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && connectionId && bucket && objectKey) {
      refresh();
      setConfirmDelete(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId, bucket, objectKey]);

  const handleDownload = async (version: ObjectVersion) => {
    setBusyVersion(version.version_id);
    setError(null);
    try {
      const url = await tauriInvoke<string>("get_presigned_url", {
        request: {
          connection_id: connectionId,
          bucket,
          key: objectKey,
          expiry_secs: 3600,
          method: "get",
          version_id: version.version_id,
        },
      });
      await openShell(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyVersion(null);
    }
  };

  const handleRestore = async (version: ObjectVersion) => {
    setBusyVersion(version.version_id);
    setError(null);
    try {
      await tauriInvoke("restore_object_version", {
        connectionId,
        bucket,
        key: objectKey,
        versionId: version.version_id,
      });
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyVersion(null);
    }
  };

  const handleDelete = async (versionId: string) => {
    setBusyVersion(versionId);
    setError(null);
    try {
      await tauriInvoke("delete_object_version", {
        connectionId,
        bucket,
        key: objectKey,
        versionId,
      });
      setConfirmDelete(null);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyVersion(null);
    }
  };

  const copyVersionId = async (versionId: string) => {
    await writeText(versionId);
  };

  if (!open) return null;

  const unversioned =
    versioningStatus !== null &&
    versioningStatus !== "Enabled" &&
    versioningStatus !== "Suspended";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/45 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[820px] max-h-[85vh] bg-(--popover) text-(--popover-foreground) border border-(--border) rounded-xl shadow-xl flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold truncate">
                {t("versions.title")}
              </Dialog.Title>
              <p className="text-xs font-mono text-zinc-500 truncate mt-0.5">
                {objectKey}
              </p>
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

          {/* Status banner */}
          {versioningStatus && (
            <div className="px-6 py-2 text-xs border-b border-zinc-100 dark:border-zinc-800/50 flex items-center gap-2">
              <span className="text-zinc-500">
                {t("versions.bucketStatus")}:
              </span>
              <span
                className={`font-medium ${
                  versioningStatus === "Enabled"
                    ? "text-green-600 dark:text-green-400"
                    : versioningStatus === "Suspended"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-zinc-500"
                }`}
              >
                {versioningStatus}
              </span>
              {unversioned && (
                <span className="text-zinc-400 ml-2">
                  — {t("versions.unversionedHint")}
                </span>
              )}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-auto px-3 pb-3">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-zinc-400 gap-2">
                <Loader2 size={16} className="animate-spin" />
                {t("common.loading")}
              </div>
            ) : versions.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-zinc-400 text-sm">
                {t("versions.noVersions")}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-800 z-10">
                  <tr className="text-left text-zinc-600 dark:text-zinc-300">
                    <th className="px-2 py-2 w-6" />
                    <th className="px-2 py-2">{t("versions.versionId")}</th>
                    <th className="px-2 py-2 w-28 text-right">
                      {t("versions.size")}
                    </th>
                    <th className="px-2 py-2 w-44">
                      {t("versions.lastModified")}
                    </th>
                    <th className="px-2 py-2 w-32 text-right" />
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr
                      key={v.version_id}
                      className={`border-t border-zinc-100 dark:border-zinc-800 ${
                        v.is_latest ? "bg-brand-50 dark:bg-brand-900/20" : ""
                      }`}
                    >
                      <td className="px-2 py-1.5">
                        {v.is_delete_marker ? (
                          <AlertTriangle size={12} className="text-red-500" />
                        ) : v.is_latest ? (
                          <CheckCircle2 size={12} className="text-green-500" />
                        ) : (
                          <span className="text-zinc-400">·</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 font-mono truncate max-w-[320px]">
                        <span className="truncate inline-block align-middle max-w-[260px]">
                          {v.version_id}
                        </span>
                        <button
                          type="button"
                          className="ml-1 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 inline-block align-middle"
                          title={t("versions.copyVersionId")}
                          onClick={() => copyVersionId(v.version_id)}
                        >
                          <Copy size={10} className="text-zinc-400" />
                        </button>
                        {v.is_latest && (
                          <span className="ml-2 text-[10px] font-semibold text-green-600 dark:text-green-400">
                            {t("versions.latest")}
                          </span>
                        )}
                        {v.is_delete_marker && (
                          <span className="ml-2 text-[10px] font-semibold text-red-500">
                            {t("versions.deleteMarker")}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right text-zinc-500">
                        {v.is_delete_marker ? "—" : formatBytes(v.size)}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-500">
                        {v.last_modified
                          ? new Date(v.last_modified).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {!v.is_delete_marker && (
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30"
                              title={t("versions.download")}
                              disabled={busyVersion === v.version_id}
                              onClick={() => handleDownload(v)}
                            >
                              <Download size={12} className="text-zinc-500" />
                            </button>
                          )}
                          {!v.is_delete_marker && !v.is_latest && (
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30"
                              title={t("versions.restore")}
                              disabled={busyVersion === v.version_id}
                              onClick={() => handleRestore(v)}
                            >
                              <RotateCcw
                                size={12}
                                className="text-brand-600 dark:text-brand-400"
                              />
                            </button>
                          )}
                          {confirmDelete === v.version_id ? (
                            <button
                              type="button"
                              className="px-2 py-0.5 text-[10px] rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                              disabled={busyVersion === v.version_id}
                              onClick={() => handleDelete(v.version_id)}
                            >
                              {t("versions.confirm")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-30"
                              title={t("versions.permanentlyDelete")}
                              disabled={busyVersion === v.version_id}
                              onClick={() => setConfirmDelete(v.version_id)}
                            >
                              <Trash2
                                size={12}
                                className="text-zinc-500 hover:text-red-500"
                              />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {error && (
            <div className="px-6 py-2 border-t border-zinc-200 dark:border-zinc-800 text-xs text-red-600 dark:text-red-400 break-words">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 px-6 py-3 border-t border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              className="px-3 py-1.5 text-sm border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onClick={refresh}
              disabled={loading}
            >
              {t("common.refresh")}
            </button>
            <Dialog.Close asChild>
              <button
                type="button"
                className="px-4 py-1.5 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700"
              >
                {t("common.close")}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
