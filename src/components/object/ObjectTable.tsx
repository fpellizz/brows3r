import { useDropZone } from "@/hooks/useDropZone";
import { formatBytes, formatDate } from "@/lib/format";
import { useConnectionStore } from "@/stores/connectionStore";
import { type ObjectInfo, useObjectStore } from "@/stores/objectStore";
import { useTransferStore } from "@/stores/transferStore";
import { useUiStore } from "@/stores/uiStore";
import { ChevronUp, File, Folder, Upload } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ObjectContextMenu } from "./ObjectContextMenu";

export function ObjectTable() {
  const { t } = useTranslation();
  const rawObjects = useObjectStore((s) => s.objects);
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
  const filterText = useObjectStore((s) => s.filterText);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const startUpload = useTransferStore((s) => s.startUpload);
  const openPreview = useUiStore((s) => s.openPreview);

  const objects = useMemo(() => {
    if (!filterText) return rawObjects;
    return rawObjects.filter((o) => {
      const name = o.display_name.toLowerCase();
      const filter = filterText;

      // Regex mode: /pattern/
      if (filter.startsWith("/") && filter.endsWith("/") && filter.length > 2) {
        try {
          return new RegExp(filter.slice(1, -1), "i").test(o.display_name);
        } catch {
          return name.includes(filter.toLowerCase());
        }
      }

      // Glob mode: contains * or ?
      if (filter.includes("*") || filter.includes("?")) {
        const escaped = filter
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".");
        try {
          return new RegExp(`^${escaped}$`, "i").test(o.display_name);
        } catch {
          return name.includes(filter.toLowerCase());
        }
      }

      return name.includes(filter.toLowerCase());
    });
  }, [rawObjects, filterText]);

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
    [
      activeConnectionId,
      currentBucket,
      currentPrefix,
      startUpload,
      fetchObjects,
    ],
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
            {currentBucket}
            {currentPrefix ? `/${currentPrefix}` : ""}
          </p>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-(--background) border-b border-(--border)">
          <tr className="text-left text-xs font-medium text-(--muted-foreground)">
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
              className="hover:bg-(--pane) cursor-pointer"
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
                className={`hover:bg-(--pane) cursor-pointer ${
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
                    // The row also toggles selection on click; without
                    // stopPropagation a click on the checkbox would
                    // fire both onChange and the row onClick, toggling
                    // twice and looking like a no-op.
                    onClick={(e) => e.stopPropagation()}
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
                {filterText
                  ? t("object.noResults")
                  : currentPrefix
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
