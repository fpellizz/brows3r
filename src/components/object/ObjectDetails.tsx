import { useEffect, useState } from "react";
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
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { tauriInvoke } from "@/lib/tauri";
import { formatBytes, formatDate } from "@/lib/format";

interface ObjectDetailsData {
  key: string;
  size: number;
  last_modified: string | null;
  etag: string | null;
  content_type: string | null;
  storage_class: string | null;
  metadata: { key: string; value: string }[];
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

  useEffect(() => {
    if (isFolder) {
      setLoading(false);
      return;
    }

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
        if (!cancelled) setDetails(result);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [connectionId, bucket, objectKey, isFolder]);

  const copyValue = async (value: string) => {
    await writeText(value);
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
            <DetailRow
              icon={<FileType size={14} />}
              label={t("object.contentType")}
              value={details.content_type ?? "unknown"}
            />
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

            {/* Custom metadata */}
            {details.metadata.length > 0 && (
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  {t("object.metadata")}
                </p>
                {details.metadata.map((m) => (
                  <DetailRow
                    key={m.key}
                    icon={<Tag size={14} />}
                    label={m.key}
                    value={m.value}
                    onCopy={() => copyValue(m.value)}
                  />
                ))}
              </div>
            )}
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
