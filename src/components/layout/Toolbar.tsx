import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import {
  Upload,
  Download,
  RefreshCw,
  FolderPlus,
  Trash2,
  Search,
  Settings,
  PanelBottom,
  RefreshCcwDot,
  Info,
  X,
} from "lucide-react";
import { useObjectStore } from "@/stores/objectStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTransferStore } from "@/stores/transferStore";
import { useUiStore } from "@/stores/uiStore";
import { tauriInvoke } from "@/lib/tauri";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { InputDialog } from "@/components/common/InputDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { SyncDialog } from "@/components/sync/SyncDialog";
import { AboutDialog } from "@/components/common/AboutDialog";

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

  const filterText = useObjectStore((s) => s.filterText);
  const setFilterText = useObjectStore((s) => s.setFilterText);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

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
    // Filter out folder keys — only download files
    const keys = Array.from(selectedKeys).filter((k) => !k.endsWith("/"));
    if (keys.length === 0) return;

    await startDownload(activeConnectionId, currentBucket, keys, dir);
  };

  const handleDelete = async () => {
    if (!activeConnectionId) return;
    await deleteSelected(activeConnectionId);
  };

  const handleNewFolder = async (folderName: string) => {
    if (!activeConnectionId || !currentBucket) return;

    const prefix = currentPrefix
      ? `${currentPrefix}${folderName}`
      : folderName;

    try {
      await tauriInvoke("create_folder", {
        connectionId: activeConnectionId,
        bucket: currentBucket,
        prefix,
      });
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
          onClick={() => {
            if (searchOpen) {
              setFilterText("");
              setSearchOpen(false);
            } else {
              setSearchOpen(true);
            }
          }}
        />
        <ToolbarButton
          icon={<RefreshCcwDot size={16} />}
          label={t("toolbar.sync")}
          disabled={!hasBucket}
          onClick={() => setSyncOpen(true)}
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
        <ToolbarButton
          icon={<Info size={16} />}
          label={t("about.title")}
          onClick={() => setAboutOpen(true)}
        />
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
          <Search size={14} className="text-zinc-400 shrink-0" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder-zinc-400"
            placeholder={`${t("toolbar.search")}... (*, ?, /regex/)`}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilterText("");
                setSearchOpen(false);
              }
            }}
            autoFocus
          />
          {filterText && (
            <button
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
              onClick={() => setFilterText("")}
            >
              <X size={14} className="text-zinc-400" />
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t("toolbar.delete")}
        description={`Delete ${selectedKeys.size} selected object(s)?`}
        items={Array.from(selectedKeys).map((k) =>
          k.endsWith("/")
            ? k
            : k.split("/").pop() ?? k
        )}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={handleDelete}
      />

      {/* New folder dialog */}
      <InputDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        title={t("toolbar.newFolder")}
        label={t("object.name")}
        placeholder="Folder name"
        confirmLabel={t("common.ok")}
        onConfirm={handleNewFolder}
      />

      {/* Settings dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* About dialog */}
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      {/* Sync dialog */}
      <SyncDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        connectionId={activeConnectionId}
        bucket={currentBucket}
        prefix={currentPrefix || ""}
      />
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
