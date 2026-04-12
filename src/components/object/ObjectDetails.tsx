import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Info,
  Loader2,
  Copy,
  HardDrive,
  Calendar,
  Hash,
  FileType,
  Tag,
  Layers,
  Save,
  Plus,
  Trash2,
  Check,
  AlertCircle,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { tauriInvoke } from "@/lib/tauri";
import { formatBytes, formatDate } from "@/lib/format";

interface MetadataEntry {
  key: string;
  value: string;
}

interface ObjectDetailsData {
  key: string;
  size: number;
  last_modified: string | null;
  etag: string | null;
  content_type: string | null;
  storage_class: string | null;
  metadata: MetadataEntry[];
  version_id: string | null;
}

interface ObjectDetailsProps {
  connectionId: string;
  bucket: string;
  objectKey: string;
  displayName: string;
  isFolder: boolean;
  onClose: () => void;
}

type FeedbackStatus = "idle" | "saving" | "success" | "error";

export function ObjectDetails({
  connectionId,
  bucket,
  objectKey,
  displayName,
  isFolder,
  onClose,
}: ObjectDetailsProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<ObjectDetailsData | null>(null);

  // Editable state
  const [editContentType, setEditContentType] = useState("");
  const [editMetadata, setEditMetadata] = useState<MetadataEntry[]>([]);
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>("idle");
  const [feedbackMessage, setFeedbackMessage] = useState("");

  const loadDetails = useCallback(async () => {
    if (isFolder) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await tauriInvoke<ObjectDetailsData>("head_object", {
        connectionId,
        bucket,
        key: objectKey,
      });
      setDetails(result);
      setEditContentType(result.content_type ?? "");
      setEditMetadata(result.metadata.map((m) => ({ ...m })));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId, bucket, objectKey, isFolder]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await tauriInvoke<ObjectDetailsData>("head_object", {
          connectionId,
          bucket,
          key: objectKey,
        });
        if (!cancelled) {
          setDetails(result);
          setEditContentType(result.content_type ?? "");
          setEditMetadata(result.metadata.map((m) => ({ ...m })));
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (!isFolder) {
      load();
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [connectionId, bucket, objectKey, isFolder]);

  const copyValue = async (value: string) => {
    await writeText(value);
  };

  const hasChanges = (): boolean => {
    if (!details) return false;
    if (editContentType !== (details.content_type ?? "")) return true;
    if (editMetadata.length !== details.metadata.length) return true;
    for (let i = 0; i < editMetadata.length; i++) {
      if (
        editMetadata[i].key !== details.metadata[i]?.key ||
        editMetadata[i].value !== details.metadata[i]?.value
      ) {
        return true;
      }
    }
    return false;
  };

  const handleAddMetadata = () => {
    setEditMetadata([...editMetadata, { key: "", value: "" }]);
  };

  const handleRemoveMetadata = (index: number) => {
    setEditMetadata(editMetadata.filter((_, i) => i !== index));
  };

  const handleMetadataKeyChange = (index: number, newKey: string) => {
    const updated = [...editMetadata];
    updated[index] = { ...updated[index], key: newKey };
    setEditMetadata(updated);
  };

  const handleMetadataValueChange = (index: number, newValue: string) => {
    const updated = [...editMetadata];
    updated[index] = { ...updated[index], value: newValue };
    setEditMetadata(updated);
  };

  const handleSave = async () => {
    if (!details) return;

    setFeedbackStatus("saving");
    setFeedbackMessage("");

    try {
      await tauriInvoke("update_object_metadata", {
        connectionId,
        bucket,
        key: objectKey,
        contentType: editContentType || null,
        metadata: editMetadata.filter((m) => m.key.trim() !== ""),
      });

      setFeedbackStatus("success");
      setFeedbackMessage(t("object.metadataSaved", "Metadata saved successfully"));

      // Reload details to reflect server state
      await loadDetails();

      // Clear success message after 3 seconds
      setTimeout(() => {
        setFeedbackStatus("idle");
        setFeedbackMessage("");
      }, 3000);
    } catch (e) {
      setFeedbackStatus("error");
      setFeedbackMessage(String(e));
    }
  };

  return (
    <div className="h-full flex flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Info size={14} className="text-zinc-500 shrink-0" />
          <span className="text-xs font-semibold truncate">{displayName}</span>
        </div>
        <button
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 shrink-0"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-zinc-400" />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}

        {isFolder && (
          <div className="space-y-3">
            <DetailRow icon={<Tag size={14} />} label="Key" value={objectKey} onCopy={() => copyValue(objectKey)} />
            <DetailRow icon={<Tag size={14} />} label="S3 URI" value={`s3://${bucket}/${objectKey}`} onCopy={() => copyValue(`s3://${bucket}/${objectKey}`)} />
            <DetailRow icon={<Layers size={14} />} label="Type" value="Folder (prefix)" />
          </div>
        )}

        {!loading && !error && details && (
          <div className="space-y-3">
            <DetailRow
              icon={<Tag size={14} />}
              label="Key"
              value={details.key}
              onCopy={() => copyValue(details.key)}
            />
            <DetailRow
              icon={<Tag size={14} />}
              label="S3 URI"
              value={`s3://${bucket}/${details.key}`}
              onCopy={() => copyValue(`s3://${bucket}/${details.key}`)}
            />
            <DetailRow
              icon={<HardDrive size={14} />}
              label={t("object.size")}
              value={formatBytes(details.size)}
            />

            {/* Editable Content Type */}
            <div className="group">
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 uppercase tracking-wider mb-0.5">
                <FileType size={14} />
                {t("object.contentType")}
              </div>
              <input
                type="text"
                className="input-field w-full text-sm"
                value={editContentType}
                onChange={(e) => setEditContentType(e.target.value)}
                placeholder="application/octet-stream"
              />
            </div>

            <DetailRow
              icon={<Calendar size={14} />}
              label={t("object.lastModified")}
              value={formatDate(details.last_modified)}
            />
            <DetailRow
              icon={<Hash size={14} />}
              label={t("object.etag")}
              value={details.etag ?? "--"}
              onCopy={details.etag ? () => copyValue(details.etag!) : undefined}
            />
            <DetailRow
              icon={<Layers size={14} />}
              label={t("object.storageClass")}
              value={details.storage_class ?? "STANDARD"}
            />

            {details.version_id && (
              <DetailRow
                icon={<Layers size={14} />}
                label="Version ID"
                value={details.version_id}
                onCopy={() => copyValue(details.version_id!)}
              />
            )}

            {/* Editable metadata section */}
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {t("object.metadata")}
                </p>
                <button
                  className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                  onClick={handleAddMetadata}
                  title={t("object.addMetadata", "Add metadata")}
                >
                  <Plus size={12} />
                  {t("object.addMetadata", "Add")}
                </button>
              </div>

              {editMetadata.length === 0 && (
                <p className="text-xs text-zinc-400 italic">
                  {t("object.noMetadata", "No custom metadata")}
                </p>
              )}

              {editMetadata.map((m, index) => (
                <div key={index} className="flex items-center gap-1.5 mb-2">
                  <input
                    type="text"
                    className="input-field flex-1 text-xs"
                    value={m.key}
                    onChange={(e) => handleMetadataKeyChange(index, e.target.value)}
                    placeholder={t("object.metadataKey", "Key")}
                  />
                  <input
                    type="text"
                    className="input-field flex-1 text-xs"
                    value={m.value}
                    onChange={(e) => handleMetadataValueChange(index, e.target.value)}
                    placeholder={t("object.metadataValue", "Value")}
                  />
                  <button
                    className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 shrink-0"
                    onClick={() => handleRemoveMetadata(index)}
                    title={t("object.removeMetadata", "Remove")}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>

            {/* Feedback message */}
            {feedbackStatus === "success" && (
              <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <Check size={14} />
                {feedbackMessage}
              </div>
            )}
            {feedbackStatus === "error" && (
              <div className="flex items-start gap-1.5 text-xs text-red-500 dark:text-red-400">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="break-all">{feedbackMessage}</span>
              </div>
            )}

            {/* Save button */}
            <button
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSave}
              disabled={feedbackStatus === "saving" || !hasChanges()}
            >
              {feedbackStatus === "saving" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {feedbackStatus === "saving"
                ? t("object.saving", "Saving...")
                : t("object.saveMetadata", "Save")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
  onCopy,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onCopy?: () => void;
}) {
  return (
    <div className="group">
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-400 uppercase tracking-wider mb-0.5">
        {icon}
        {label}
      </div>
      <div className="flex items-center gap-1">
        <span
          className="text-sm text-zinc-700 dark:text-zinc-300 break-all"
          data-selectable
        >
          {value}
        </span>
        {onCopy && (
          <button
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-opacity shrink-0"
            onClick={onCopy}
            title="Copy"
          >
            <Copy size={12} className="text-zinc-400" />
          </button>
        )}
      </div>
    </div>
  );
}
