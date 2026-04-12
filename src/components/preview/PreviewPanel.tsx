import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, FileText, Image, Eye, Loader2 } from "lucide-react";
import { tauriInvoke } from "@/lib/tauri";
import { formatBytes } from "@/lib/format";
import { ImagePreview } from "./ImagePreview";
import { TextPreview } from "./TextPreview";

interface PreviewResponse {
  preview_type: string;
  content: string;
  content_type: string;
  size: number;
  truncated: boolean;
}

interface PreviewPanelProps {
  connectionId: string;
  bucket: string;
  objectKey: string;
  displayName: string;
  onClose: () => void;
}

export function PreviewPanel({
  connectionId,
  bucket,
  objectKey,
  displayName,
  onClose,
}: PreviewPanelProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await tauriInvoke<PreviewResponse>(
          "get_object_preview",
          { connectionId, bucket, key: objectKey },
        );
        if (!cancelled) setPreview(result);
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
  }, [connectionId, bucket, objectKey]);

  return (
    <div className="h-full flex flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Eye size={14} className="text-zinc-500 shrink-0" />
          <span className="text-xs font-semibold truncate">{displayName}</span>
        </div>
        <button
          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 shrink-0"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {/* Metadata bar */}
      {preview && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800/50 text-[10px] text-zinc-400 shrink-0">
          <span>{preview.content_type}</span>
          <span>{formatBytes(preview.size)}</span>
          {preview.truncated && (
            <span className="text-amber-500">(truncated)</span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="animate-spin text-zinc-400" />
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full px-4">
            <p className="text-sm text-red-500 text-center">{error}</p>
          </div>
        )}

        {!loading && !error && preview && (
          <PreviewContent preview={preview} />
        )}
      </div>
    </div>
  );
}

function PreviewContent({ preview }: { preview: PreviewResponse }) {
  switch (preview.preview_type) {
    case "text":
      return (
        <TextPreview
          content={preview.content}
          contentType={preview.content_type}
          fileName=""
        />
      );
    case "image":
      return (
        <ImagePreview
          base64Data={preview.content}
          contentType={preview.content_type}
        />
      );
    default:
      return (
        <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2">
          <FileText size={32} />
          <p className="text-sm">Preview not available</p>
          <p className="text-xs">{preview.content_type}</p>
          <p className="text-xs">{formatBytes(preview.size)}</p>
        </div>
      );
  }
}
