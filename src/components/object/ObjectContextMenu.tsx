import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Download,
  Trash2,
  Copy,
  Link,
  FolderOpen,
  Eye,
  Info,
  Pencil,
  FolderInput,
  CopyPlus,
  ArrowRightLeft,
  History,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useObjectStore, type ObjectInfo } from "@/stores/objectStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTransferStore } from "@/stores/transferStore";
import { useUiStore } from "@/stores/uiStore";
import { tauriInvoke } from "@/lib/tauri";
import { InputDialog } from "@/components/common/InputDialog";
import { CrossTransferDialog } from "@/components/transfer/CrossTransferDialog";
import { VersionsDialog } from "@/components/object/VersionsDialog";

interface ObjectContextMenuProps {
  object: ObjectInfo;
  children: React.ReactNode;
}

export function ObjectContextMenu({
  object,
  children,
}: ObjectContextMenuProps) {
  const { t } = useTranslation();
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const currentBucket = useObjectStore((s) => s.currentBucket);
  const currentPrefix = useObjectStore((s) => s.currentPrefix);
  const fetchObjects = useObjectStore((s) => s.fetchObjects);
  const navigateToPrefix = useObjectStore((s) => s.navigateToPrefix);
  const startDownload = useTransferStore((s) => s.startDownload);
  const openPreview = useUiStore((s) => s.openPreview);
  const openDetails = useUiStore((s) => s.openDetails);

  const [renameOpen, setRenameOpen] = useState(false);
  const [copyToOpen, setCopyToOpen] = useState(false);
  const [moveToOpen, setMoveToOpen] = useState(false);
  const [crossTransferOpen, setCrossTransferOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  const handleDetails = () => {
    openDetails({
      key: object.key,
      displayName: object.display_name,
      isFolder: object.is_folder,
    });
  };

  const handlePreview = () => {
    if (!object.is_folder) {
      openPreview({ key: object.key, displayName: object.display_name });
    }
  };

  const handleOpen = () => {
    if (object.is_folder && activeConnectionId) {
      navigateToPrefix(object.key);
      fetchObjects(activeConnectionId);
    }
  };

  const handleDownload = async () => {
    if (!activeConnectionId || !currentBucket || object.is_folder) return;

    const destDir = await openFileDialog({
      directory: true,
      title: t("toolbar.download"),
    });

    if (!destDir) return;

    await startDownload(activeConnectionId, currentBucket, [object.key], destDir);
  };

  const handleDelete = async () => {
    if (!activeConnectionId || !currentBucket) return;

    await tauriInvoke("delete_objects", {
      request: {
        connection_id: activeConnectionId,
        bucket: currentBucket,
        keys: [object.key],
      },
    });

    fetchObjects(activeConnectionId);
  };

  const handleCopyKey = async () => {
    await writeText(object.key);
  };

  const handleCopyS3Uri = async () => {
    if (currentBucket) {
      await writeText(`s3://${currentBucket}/${object.key}`);
    }
  };

  const handlePresignedUrl = async () => {
    if (!activeConnectionId || !currentBucket) return;

    try {
      const url = await tauriInvoke<string>("get_presigned_url", {
        request: {
          connection_id: activeConnectionId,
          bucket: currentBucket,
          key: object.key,
          expiry_secs: 3600,
          method: "get",
        },
      });
      await writeText(url);
    } catch (e) {
      console.error("Failed to generate presigned URL:", e);
    }
  };

  const handleRename = async (newName: string) => {
    if (!activeConnectionId || !currentBucket) return;

    const newKey = currentPrefix ? `${currentPrefix}${newName}` : newName;

    try {
      await tauriInvoke("rename_object", {
        connectionId: activeConnectionId,
        bucket: currentBucket,
        oldKey: object.key,
        newKey,
      });
      fetchObjects(activeConnectionId);
    } catch (e) {
      console.error("Failed to rename object:", e);
    }
  };

  const handleCopyTo = async (destPath: string) => {
    if (!activeConnectionId || !currentBucket) return;

    // destPath can be "bucket/prefix/key" or just "prefix/key" (same bucket)
    let destBucket = currentBucket;
    let destKey = destPath;

    if (destPath.includes(":")) {
      // Format: bucket:key
      const [b, ...rest] = destPath.split(":");
      destBucket = b;
      destKey = rest.join(":");
    }

    try {
      await tauriInvoke("copy_object", {
        request: {
          connection_id: activeConnectionId,
          source_bucket: currentBucket,
          source_key: object.key,
          dest_bucket: destBucket,
          dest_key: destKey,
        },
      });
      fetchObjects(activeConnectionId);
    } catch (e) {
      console.error("Failed to copy object:", e);
    }
  };

  const handleMoveTo = async (destPath: string) => {
    if (!activeConnectionId || !currentBucket) return;

    let destBucket = currentBucket;
    let destKey = destPath;

    if (destPath.includes(":")) {
      const [b, ...rest] = destPath.split(":");
      destBucket = b;
      destKey = rest.join(":");
    }

    try {
      await tauriInvoke("move_object", {
        request: {
          connection_id: activeConnectionId,
          source_bucket: currentBucket,
          source_key: object.key,
          dest_bucket: destBucket,
          dest_key: destKey,
        },
      });
      fetchObjects(activeConnectionId);
    } catch (e) {
      console.error("Failed to move object:", e);
    }
  };

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Content className="min-w-[180px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl py-1 z-50">
            {object.is_folder ? (
              <MenuItem
                icon={<FolderOpen size={14} />}
                label="Open"
                onClick={handleOpen}
              />
            ) : (
              <>
                <MenuItem
                  icon={<Eye size={14} />}
                  label="Preview"
                  onClick={handlePreview}
                />
                <MenuItem
                  icon={<Download size={14} />}
                  label={t("toolbar.download")}
                  onClick={handleDownload}
                />
              </>
            )}

            <ContextMenu.Separator className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />

            {!object.is_folder && (
              <>
                <MenuItem
                  icon={<Pencil size={14} />}
                  label={t("object.rename")}
                  onClick={() => setRenameOpen(true)}
                />
                <MenuItem
                  icon={<CopyPlus size={14} />}
                  label={t("object.copyTo")}
                  onClick={() => setCopyToOpen(true)}
                />
                <MenuItem
                  icon={<FolderInput size={14} />}
                  label={t("object.moveTo")}
                  onClick={() => setMoveToOpen(true)}
                />
                <MenuItem
                  icon={<ArrowRightLeft size={14} />}
                  label={t("crossTransfer.menuLabel")}
                  onClick={() => setCrossTransferOpen(true)}
                />
                <MenuItem
                  icon={<History size={14} />}
                  label={t("versions.menuLabel")}
                  onClick={() => setVersionsOpen(true)}
                />

                <ContextMenu.Separator className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />
              </>
            )}

            <MenuItem
              icon={<Copy size={14} />}
              label={t("object.copyKey")}
              onClick={handleCopyKey}
            />
            <MenuItem
              icon={<Copy size={14} />}
              label="Copy S3 URI"
              onClick={handleCopyS3Uri}
            />

            {!object.is_folder && (
              <MenuItem
                icon={<Link size={14} />}
                label={`${t("object.presignedUrl")} (1h)`}
                onClick={handlePresignedUrl}
              />
            )}

            <ContextMenu.Separator className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />

            <MenuItem
              icon={<Info size={14} />}
              label="Properties"
              onClick={handleDetails}
            />

            <ContextMenu.Separator className="h-px bg-zinc-200 dark:bg-zinc-700 my-1" />

            <MenuItem
              icon={<Trash2 size={14} />}
              label={t("common.delete")}
              onClick={handleDelete}
              destructive
            />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {/* Rename dialog */}
      <InputDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t("object.rename")}
        label={t("object.name")}
        defaultValue={object.display_name}
        onConfirm={handleRename}
      />

      {/* Copy To dialog */}
      <InputDialog
        open={copyToOpen}
        onOpenChange={setCopyToOpen}
        title={t("object.copyTo")}
        description="Enter destination path. Use bucket:path for cross-bucket copy."
        label="Destination"
        defaultValue={object.key}
        placeholder="prefix/filename.ext or bucket:prefix/filename.ext"
        onConfirm={handleCopyTo}
      />

      {/* Move To dialog */}
      <InputDialog
        open={moveToOpen}
        onOpenChange={setMoveToOpen}
        title={t("object.moveTo")}
        description="Enter destination path. Use bucket:path for cross-bucket move."
        label="Destination"
        defaultValue={object.key}
        placeholder="prefix/filename.ext or bucket:prefix/filename.ext"
        onConfirm={handleMoveTo}
      />

      {/* Cross-connection transfer dialog */}
      {activeConnectionId && currentBucket && (
        <CrossTransferDialog
          open={crossTransferOpen}
          onOpenChange={setCrossTransferOpen}
          sourceConnectionId={activeConnectionId}
          sourceBucket={currentBucket}
          sourceKeys={[object.key]}
        />
      )}

      {/* Versions dialog */}
      {activeConnectionId && currentBucket && !object.is_folder && (
        <VersionsDialog
          open={versionsOpen}
          onOpenChange={setVersionsOpen}
          connectionId={activeConnectionId}
          bucket={currentBucket}
          objectKey={object.key}
          onChanged={() =>
            activeConnectionId && fetchObjects(activeConnectionId)
          }
        />
      )}
    </>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <ContextMenu.Item
      className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer outline-none
        ${
          destructive
            ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
            : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </ContextMenu.Item>
  );
}
