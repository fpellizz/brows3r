import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openFileDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  Upload,
  Download,
  RefreshCw,
  FolderPlus,
  Trash2,
  Search,
  Settings,
  PanelBottom,
} from "lucide-react";
import { useObjectStore } from "@/stores/objectStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTransferStore } from "@/stores/transferStore";
import { useUiStore } from "@/stores/uiStore";
import { tauriInvoke } from "@/lib/tauri";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";

export function Toolbar() {
  const { t } = useTranslation();
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const fetchObjects = useObjectStore((s) => s.fetchObjects);
  const selectedKeys = useObjectStore((s) => s.selectedKeys);
  const currentBucket = useObjectStore((s) => s.currentBucket);
  const currentPrefix = useObjectStore((s) => s.currentPrefix);
  const deleteSelected = useObjectStore((s) => s.deleteSelected);
  const toggleTransferPanel = useUiStore((s) => s.toggleTransferPanel);
  const startUpload = useTransferStore((s) => s.startUpload);
  const startDownload = useTransferStore((s) => s.startDownload);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const hasSelection = selectedKeys.size > 0;
  const hasBucket = !!currentBucket;

  const handleRefresh = () => {
    if (activeConnectionId) {
      fetchObjects(activeConnectionId);
    }
  };

  const handleUpload = async () => {
    if (!activeConnectionId || !currentBucket) return;

    const selected = await openFileDialog({
      multiple: true,
      title: t("toolbar.upload"),
    });

    if (!selected) return;

    const paths = Array.isArray(selected)
      ? selected.map((f) => f.path)
      : [selected.path];

    if (paths.length === 0) return;

    await startUpload(
      activeConnectionId,
      currentBucket,
      currentPrefix || null,
      paths,
    );

    // Refresh after a short delay to show uploaded files
    setTimeout(() => {
      if (activeConnectionId) fetchObjects(activeConnectionId);
    }, 1000);
  };

  const handleDownload = async () => {
    if (!activeConnectionId || !currentBucket || selectedKeys.size === 0)
      return;

    const destDir = await openFileDialog({
      directory: true,
      title: t("toolbar.download"),
    });

    if (!destDir) return;

    const dir = typeof destDir === "string" ? destDir : destDir.path;
    const keys = Array.from(selectedKeys);

    await startDownload(activeConnectionId, currentBucket, keys, dir);
  };

  const handleDelete = async () => {
    if (!activeConnectionId) return;
    await deleteSelected(activeConnectionId);
  };

  const handleNewFolder = async () => {
    if (!activeConnectionId || !currentBucket || !newFolderName.trim()) return;

    const prefix = currentPrefix
      ? `${currentPrefix}${newFolderName.trim()}`
      : newFolderName.trim();

    try {
      await tauriInvoke("create_folder", {
        connectionId: activeConnectionId,
        bucket: currentBucket,
        prefix,
      });
      setNewFolderName("");
      setNewFolderOpen(false);
      fetchObjects(activeConnectionId);
    } catch (e) {
      console.error("Failed to create folder:", e);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        {/* App title */}
        <span className="text-sm font-bold text-brand-600 dark:text-brand-400 mr-3 select-none">
          brows3r
        </span>

        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* Action buttons */}
        <ToolbarButton
          icon={<Upload size={16} />}
          label={t("toolbar.upload")}
          disabled={!hasBucket}
          onClick={handleUpload}
        />
        <ToolbarButton
          icon={<Download size={16} />}
          label={t("toolbar.download")}
          disabled={!hasSelection}
          onClick={handleDownload}
        />
        <ToolbarButton
          icon={<FolderPlus size={16} />}
          label={t("toolbar.newFolder")}
          disabled={!hasBucket}
          onClick={() => setNewFolderOpen(true)}
        />
        <ToolbarButton
          icon={<Trash2 size={16} />}
          label={t("toolbar.delete")}
          disabled={!hasSelection}
          onClick={() => setDeleteConfirmOpen(true)}
        />

        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        <ToolbarButton
          icon={<RefreshCw size={16} />}
          label={t("toolbar.refresh")}
          disabled={!hasBucket}
          onClick={handleRefresh}
        />
        <ToolbarButton
          icon={<Search size={16} />}
          label={t("toolbar.search")}
          disabled={!hasBucket}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Toggle panels */}
        <ToolbarButton
          icon={<PanelBottom size={16} />}
          label={t("transfer.title")}
          onClick={toggleTransferPanel}
        />
        <ToolbarButton
          icon={<Settings size={16} />}
          label={t("toolbar.settings")}
          onClick={() => setSettingsOpen(true)}
        />
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t("toolbar.delete")}
        description={`Delete ${selectedKeys.size} selected object(s)?`}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={handleDelete}
      />

      {/* New folder inline dialog */}
      {newFolderOpen && (
        <div className="absolute top-10 left-40 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl p-4 w-72">
          <p className="text-sm font-medium mb-2">{t("toolbar.newFolder")}</p>
          <input
            className="input-field mb-3"
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNewFolder();
              if (e.key === "Escape") setNewFolderOpen(false);
            }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 text-xs border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onClick={() => setNewFolderOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              className="px-3 py-1.5 text-xs bg-brand-600 text-white rounded-md hover:bg-brand-700"
              onClick={handleNewFolder}
            >
              {t("common.ok")}
            </button>
          </div>
        </div>
      )}

      {/* Settings dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

function ToolbarButton({
  icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs
        ${
          disabled
            ? "text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
            : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
        }`}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
