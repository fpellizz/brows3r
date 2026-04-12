import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { File, Folder, ChevronUp, Upload } from "lucide-react";
import { useObjectStore, type ObjectInfo } from "@/stores/objectStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTransferStore } from "@/stores/transferStore";
import { useUiStore } from "@/stores/uiStore";
import { formatBytes, formatDate } from "@/lib/format";
import { ObjectContextMenu } from "./ObjectContextMenu";
import { useDropZone } from "@/hooks/useDropZone";

export function ObjectTable() {
  const { t } = useTranslation();
  const objects = useObjectStore((s) => s.objects);
  const currentBucket = useObjectStore((s) => s.currentBucket);
  const currentPrefix = useObjectStore((s) => s.currentPrefix);
  const selectedKeys = useObjectStore((s) => s.selectedKeys);
  const toggleSelection = useObjectStore((s) => s.toggleSelection);
  const navigateToPrefix = useObjectStore((s) => s.navigateToPrefix);
  const navigateUp = useObjectStore((s) => s.navigateUp);
  const fetchObjects = useObjectStore((s) => s.fetchObjects);
  const loading = useObjectStore((s) => s.loading);
  const isTruncated = useObjectStore((s) => s.isTruncated);
  const fetchMore = useObjectStore((s) => s.fetchMore);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const startUpload = useTransferStore((s) => s.startUpload);
  const openPreview = useUiStore((s) => s.openPreview);

  const handleDrop = useCallback(
    async (paths: string[]) => {
      if (!activeConnectionId || !currentBucket || paths.length === 0) return;

      await startUpload(
        activeConnectionId,
        currentBucket,
        currentPrefix || null,
        paths,
      );

      // Refresh after a short delay to show uploaded files
      setTimeout(() => {
        if (activeConnectionId) fetchObjects(activeConnectionId);
      }, 1500);
    },
    [activeConnectionId, currentBucket, currentPrefix, startUpload, fetchObjects],
  );

  const { isDragging } = useDropZone(currentBucket ? handleDrop : undefined);

  const handleDoubleClick = useCallback(
    (obj: ObjectInfo) => {
      if (obj.is_folder && activeConnectionId) {
        navigateToPrefix(obj.key);
        fetchObjects(activeConnectionId);
      } else if (!obj.is_folder) {
        openPreview({ key: obj.key, displayName: obj.display_name });
      }
    },
    [activeConnectionId, navigateToPrefix, fetchObjects, openPreview],
  );

  const handleNavigateUp = useCallback(() => {
    if (!activeConnectionId) return;
    navigateUp();
    fetchObjects(activeConnectionId);
  }, [activeConnectionId, navigateUp, fetchObjects]);

  const handleLoadMore = useCallback(() => {
    if (activeConnectionId) {
      fetchMore(activeConnectionId);
    }
  }, [activeConnectionId, fetchMore]);

  if (!currentBucket) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
        Select a bucket from the sidebar
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-auto">
      {/* Drag overlay */}
      {isDragging && currentBucket && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-brand-50/90 dark:bg-brand-950/90 border-2 border-dashed border-brand-400 dark:border-brand-500 rounded-lg pointer-events-none">
          <Upload size={48} className="text-brand-500 mb-3" />
          <p className="text-lg font-semibold text-brand-700 dark:text-brand-300">
            Drop files to upload
          </p>
          <p className="text-sm text-brand-500 dark:text-brand-400 mt-1">
            {currentBucket}{currentPrefix ? `/${currentPrefix}` : ""}
          </p>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
          <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider">
            <th className="w-8 px-2 py-2">
              <input type="checkbox" className="rounded" />
            </th>
            <th className="px-2 py-2">{t("object.name")}</th>
            <th className="px-2 py-2 w-24 text-right">{t("object.size")}</th>
            <th className="px-2 py-2 w-40">{t("object.lastModified")}</th>
            <th className="px-2 py-2 w-28">{t("object.storageClass")}</th>
          </tr>
        </thead>
        <tbody>
          {/* Navigate up row */}
          {currentPrefix && (
            <tr
              className="hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer"
              onDoubleClick={handleNavigateUp}
            >
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5 flex items-center gap-2 text-zinc-500">
                <ChevronUp size={16} />
                <span>..</span>
              </td>
              <td />
              <td />
              <td />
            </tr>
          )}

          {/* Object rows */}
          {objects.map((obj) => (
            <ObjectContextMenu key={obj.key} object={obj}>
              <tr
                className={`hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer ${
                  selectedKeys.has(obj.key)
                    ? "bg-brand-50 dark:bg-brand-900/20"
                    : ""
                }`}
                onClick={() => toggleSelection(obj.key)}
                onDoubleClick={() => handleDoubleClick(obj)}
              >
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(obj.key)}
                    onChange={() => toggleSelection(obj.key)}
                    className="rounded"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    {obj.is_folder ? (
                      <Folder size={16} className="text-amber-500 shrink-0" />
                    ) : (
                      <File size={16} className="text-zinc-400 shrink-0" />
                    )}
                    <span className="truncate" data-selectable>
                      {obj.display_name}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right text-zinc-500">
                  {obj.size != null ? formatBytes(obj.size) : "--"}
                </td>
                <td className="px-2 py-1.5 text-zinc-500">
                  {formatDate(obj.last_modified)}
                </td>
                <td className="px-2 py-1.5 text-zinc-500">
                  {obj.storage_class ?? "--"}
                </td>
              </tr>
            </ObjectContextMenu>
          ))}

          {/* Empty state */}
          {!loading && objects.length === 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-8 text-center text-zinc-400">
                {currentPrefix
                  ? t("object.emptyFolder")
                  : t("object.empty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Load more */}
      {isTruncated && (
        <div className="flex justify-center py-3">
          <button
            className="px-4 py-1.5 text-xs text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded"
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? t("common.loading") : "Load more..."}
          </button>
        </div>
      )}

      {/* Loading indicator */}
      {loading && objects.length === 0 && (
        <div className="flex justify-center py-8 text-zinc-400 text-sm">
          {t("common.loading")}
        </div>
      )}
    </div>
  );
}
