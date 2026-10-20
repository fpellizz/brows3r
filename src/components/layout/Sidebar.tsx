import { BucketPropertiesDialog } from "@/components/bucket/BucketPropertiesDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DangerousConfirmDialog } from "@/components/common/DangerousConfirmDialog";
import { InputDialog } from "@/components/common/InputDialog";
import { ConnectionDialog } from "@/components/connection/ConnectionDialog";
import { ImportDialog } from "@/components/connection/ImportDialog";
import { tauriInvoke } from "@/lib/tauri";
import { type Connection, useConnectionStore } from "@/stores/connectionStore";
import { useObjectStore } from "@/stores/objectStore";
import { useUiStore } from "@/stores/uiStore";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Eraser,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Sliders,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface BucketInfo {
  name: string;
  creation_date: string | null;
  region: string | null;
}

interface BucketDeletionInfo {
  is_empty: boolean;
  versioning_status: string;
  has_versions: boolean;
}

interface BucketTarget {
  connId: string;
  name: string;
}

interface PurgeTarget extends BucketTarget {
  info: BucketDeletionInfo;
}

export function Sidebar() {
  const { t } = useTranslation();
  const connections = useConnectionStore((s) => s.connections);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const setActiveConnection = useConnectionStore((s) => s.setActiveConnection);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const setCurrentBucket = useObjectStore((s) => s.setCurrentBucket);
  const fetchObjects = useObjectStore((s) => s.fetchObjects);
  const currentBucket = useObjectStore((s) => s.currentBucket);

  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(
    new Set(),
  );
  const [buckets, setBuckets] = useState<Record<string, BucketInfo[]>>({});
  const [loadingBuckets, setLoadingBuckets] = useState<Set<string>>(new Set());
  const [bucketErrors, setBucketErrors] = useState<Record<string, string>>({});

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(
    null,
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingConnection, setDeletingConnection] =
    useState<Connection | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [createBucketOpen, setCreateBucketOpen] = useState(false);
  const [createBucketConnId, setCreateBucketConnId] = useState<string | null>(
    null,
  );
  // Three distinct flows for bucket deletion / cleanup:
  //  - simple confirm when the bucket is already empty;
  //  - type-to-confirm purge + delete when it has objects (and/or versions);
  //  - type-to-confirm empty-only (keeps the bucket).
  const [deleteBucketOpen, setDeleteBucketOpen] = useState(false);
  const [deletingBucket, setDeletingBucket] = useState<BucketTarget | null>(
    null,
  );
  const [purgeAndDeleteTarget, setPurgeAndDeleteTarget] =
    useState<PurgeTarget | null>(null);
  const [emptyBucketTarget, setEmptyBucketTarget] =
    useState<PurgeTarget | null>(null);
  const [inspectingBucket, setInspectingBucket] = useState<string | null>(null);
  const [propertiesBucket, setPropertiesBucket] = useState<BucketTarget | null>(
    null,
  );

  const openNewDialog = () => {
    setEditingConnection(null);
    setDialogOpen(true);
  };

  const openEditDialog = (conn: Connection, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingConnection(conn);
    setDialogOpen(true);
  };

  const confirmDelete = (conn: Connection, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingConnection(conn);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (deletingConnection) {
      await deleteConnection(deletingConnection.id);
      // Clean up local state
      setBuckets((prev) => {
        const next = { ...prev };
        delete next[deletingConnection.id];
        return next;
      });
      setDeletingConnection(null);
    }
  };

  const toggleConnection = async (connectionId: string) => {
    const expanded = new Set(expandedConnections);

    if (expanded.has(connectionId)) {
      expanded.delete(connectionId);
      setExpandedConnections(expanded);
      return;
    }

    expanded.add(connectionId);
    setExpandedConnections(expanded);
    setActiveConnection(connectionId);

    await loadBuckets(connectionId);
  };

  const loadBuckets = async (connectionId: string, force = false) => {
    if (buckets[connectionId] && !force) return;

    setLoadingBuckets((prev) => new Set(prev).add(connectionId));
    setBucketErrors((prev) => {
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });
    try {
      const result = await tauriInvoke<BucketInfo[]>("list_buckets", {
        connectionId,
      });
      setBuckets((prev) => ({ ...prev, [connectionId]: result }));
    } catch (e) {
      const msg = String(e);
      console.error("Failed to list buckets:", msg);
      setBucketErrors((prev) => ({ ...prev, [connectionId]: msg }));
    } finally {
      setLoadingBuckets((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });
    }
  };

  const refreshBuckets = (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    loadBuckets(connectionId, true);
  };

  const updateTab = useUiStore((s) => s.updateTab);
  const activeTabId = useUiStore((s) => s.activeTabId);

  const selectBucket = (connectionId: string, bucketName: string) => {
    setActiveConnection(connectionId);
    updateTab(activeTabId, { connectionId });
    setCurrentBucket(bucketName);
    fetchObjects(connectionId);
  };

  const handleCreateBucket = async (bucketName: string) => {
    if (!createBucketConnId) return;
    try {
      await tauriInvoke("create_bucket", {
        connectionId: createBucketConnId,
        request: { name: bucketName, region: null },
      });
      await loadBuckets(createBucketConnId, true);
    } catch (e) {
      console.error("Failed to create bucket:", e);
    }
  };

  const handleSimpleDeleteBucket = async () => {
    if (!deletingBucket) return;
    try {
      await tauriInvoke("delete_bucket", {
        connectionId: deletingBucket.connId,
        bucket: deletingBucket.name,
      });
      if (currentBucket === deletingBucket.name) {
        setCurrentBucket(null);
      }
      await loadBuckets(deletingBucket.connId, true);
    } catch (e) {
      console.error("Failed to delete bucket:", e);
    }
    setDeletingBucket(null);
  };

  const handlePurgeAndDelete = async () => {
    if (!purgeAndDeleteTarget) return;
    const { connId, name, info } = purgeAndDeleteTarget;
    await tauriInvoke("empty_bucket", {
      connectionId: connId,
      bucket: name,
      includeVersions: info.has_versions,
    });
    await tauriInvoke("delete_bucket", {
      connectionId: connId,
      bucket: name,
    });
    if (currentBucket === name) {
      setCurrentBucket(null);
    }
    await loadBuckets(connId, true);
    setPurgeAndDeleteTarget(null);
  };

  const handleEmptyBucket = async () => {
    if (!emptyBucketTarget) return;
    const { connId, name, info } = emptyBucketTarget;
    await tauriInvoke("empty_bucket", {
      connectionId: connId,
      bucket: name,
      includeVersions: info.has_versions,
    });
    // Refresh the current view if it's pointing at this bucket
    if (currentBucket === name && activeConnectionId === connId) {
      await fetchObjects(connId);
    }
    setEmptyBucketTarget(null);
  };

  const openCreateBucket = (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCreateBucketConnId(connectionId);
    setCreateBucketOpen(true);
  };

  /**
   * Probe the bucket: if it's empty and no version history, fall through to
   * the simple confirm; otherwise open the dangerous purge-and-delete dialog.
   * Inspection failures (e.g. AccessDenied) still drop to the simple confirm
   * so the user can see the error from the server in the same way as before.
   */
  const confirmDeleteBucket = async (
    connId: string,
    bucketName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const key = `${connId}:${bucketName}`;
    setInspectingBucket(key);
    try {
      const info = await tauriInvoke<BucketDeletionInfo>(
        "inspect_bucket_for_deletion",
        { connectionId: connId, bucket: bucketName },
      );
      if (info.is_empty && !info.has_versions) {
        setDeletingBucket({ connId, name: bucketName });
        setDeleteBucketOpen(true);
      } else {
        setPurgeAndDeleteTarget({ connId, name: bucketName, info });
      }
    } catch (err) {
      console.error("inspect_bucket_for_deletion failed:", err);
      // Fall back to the strict confirm: at least the user sees feedback
      // if the delete itself produces an error.
      setDeletingBucket({ connId, name: bucketName });
      setDeleteBucketOpen(true);
    } finally {
      setInspectingBucket(null);
    }
  };

  const openEmptyBucket = async (
    connId: string,
    bucketName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const key = `${connId}:${bucketName}`;
    setInspectingBucket(key);
    try {
      const info = await tauriInvoke<BucketDeletionInfo>(
        "inspect_bucket_for_deletion",
        { connectionId: connId, bucket: bucketName },
      );
      setEmptyBucketTarget({ connId, name: bucketName, info });
    } catch (err) {
      console.error("inspect_bucket_for_deletion failed:", err);
      // Still open the dialog with a conservative default so the user
      // can attempt the operation and see any error inline.
      setEmptyBucketTarget({
        connId,
        name: bucketName,
        info: {
          is_empty: false,
          versioning_status: "Unknown",
          has_versions: false,
        },
      });
    } finally {
      setInspectingBucket(null);
    }
  };

  return (
    <>
      <div className="h-full flex flex-col border-r border-(--sidebar-border) bg-(--sidebar) text-(--sidebar-foreground)">
        {/* Header */}
        <div className="flex items-center justify-between pl-4 pr-3 pt-3 pb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-(--muted-foreground)">
            {t("sidebar.connections")}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              className="p-1 rounded hover:bg-(--pane-accent) text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              title={t("import.title")}
              onClick={() => setImportDialogOpen(true)}
            >
              <Download size={14} />
            </button>
            <button
              className="p-1 rounded hover:bg-(--pane-accent) text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              title={t("sidebar.addConnection")}
              onClick={openNewDialog}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Connection tree */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {connections.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-xs text-zinc-400 mb-3">
                {t("sidebar.noConnections")}
              </p>
              <button
                className="px-3 py-1.5 text-xs bg-brand-600 text-white rounded-md hover:bg-brand-700"
                onClick={openNewDialog}
              >
                <Plus size={12} className="inline mr-1" />
                {t("sidebar.addConnection")}
              </button>
            </div>
          ) : (
            connections.map((conn) => (
              <div key={conn.id}>
                {/* Connection node */}
                <div
                  className={`group w-full flex items-center gap-2 h-8 px-2 rounded-md text-sm hover:bg-(--pane-accent) cursor-pointer ${
                    activeConnectionId === conn.id
                      ? "font-medium"
                      : "font-normal"
                  }`}
                  onClick={() => toggleConnection(conn.id)}
                >
                  {expandedConnections.has(conn.id) ? (
                    <ChevronDown size={14} className="text-zinc-400 shrink-0" />
                  ) : (
                    <ChevronRight
                      size={14}
                      className="text-zinc-400 shrink-0"
                    />
                  )}
                  <Database
                    size={14}
                    className={`shrink-0 ${
                      activeConnectionId === conn.id
                        ? "text-(--sidebar-primary)"
                        : "text-(--muted-foreground)"
                    }`}
                  />
                  <span className="truncate flex-1">{conn.name}</span>

                  {/* Inline action buttons (visible on hover) */}
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    {expandedConnections.has(conn.id) && (
                      <>
                        <button
                          className="p-0.5 rounded hover:bg-(--neutral-300) dark:hover:bg-(--neutral-700)"
                          title={t("bucket.create")}
                          onClick={(e) => openCreateBucket(conn.id, e)}
                        >
                          <Plus size={12} className="text-zinc-500" />
                        </button>
                        <button
                          className="p-0.5 rounded hover:bg-(--neutral-300) dark:hover:bg-(--neutral-700)"
                          title="Refresh buckets"
                          onClick={(e) => refreshBuckets(conn.id, e)}
                        >
                          <RefreshCw size={12} className="text-zinc-500" />
                        </button>
                      </>
                    )}
                    <button
                      className="p-0.5 rounded hover:bg-(--neutral-300) dark:hover:bg-(--neutral-700)"
                      title="Edit"
                      onClick={(e) => openEditDialog(conn, e)}
                    >
                      <Pencil size={12} className="text-zinc-500" />
                    </button>
                    <button
                      className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                      title="Delete"
                      onClick={(e) => confirmDelete(conn, e)}
                    >
                      <Trash2
                        size={12}
                        className="text-zinc-500 hover:text-red-500"
                      />
                    </button>
                  </div>
                </div>

                {/* Bucket list */}
                {expandedConnections.has(conn.id) && (
                  <div className="ml-4 mt-0.5 space-y-0.5">
                    {loadingBuckets.has(conn.id) ? (
                      <div className="px-4 py-2 text-xs text-zinc-400">
                        {t("common.loading")}
                      </div>
                    ) : bucketErrors[conn.id] ? (
                      <div className="px-3 py-2 text-xs text-red-500 break-all">
                        {bucketErrors[conn.id]}
                      </div>
                    ) : (
                      buckets[conn.id]?.map((bucket) => (
                        <div
                          key={bucket.name}
                          className={`group/bucket w-full flex items-center gap-2 h-7 px-2 rounded-md text-sm hover:bg-(--pane-accent) cursor-pointer ${
                            currentBucket === bucket.name &&
                            activeConnectionId === conn.id
                              ? "bg-(--pane-accent) font-medium [&>svg:first-child]:text-(--sidebar-primary)"
                              : "font-normal"
                          }`}
                          onClick={() => selectBucket(conn.id, bucket.name)}
                        >
                          <FolderOpen
                            size={14}
                            className="text-(--muted-foreground) shrink-0"
                          />
                          <span className="truncate flex-1">{bucket.name}</span>
                          <button
                            className="hidden group-hover/bucket:block p-0.5 rounded hover:bg-(--pane-accent) shrink-0"
                            title={t("bucket.properties")}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPropertiesBucket({
                                connId: conn.id,
                                name: bucket.name,
                              });
                            }}
                          >
                            <Sliders
                              size={11}
                              className="text-zinc-400 hover:text-brand-500"
                            />
                          </button>
                          <button
                            className="hidden group-hover/bucket:block p-0.5 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 shrink-0 disabled:opacity-40"
                            title={t("bucket.emptyAction")}
                            onClick={(e) =>
                              openEmptyBucket(conn.id, bucket.name, e)
                            }
                            disabled={
                              inspectingBucket === `${conn.id}:${bucket.name}`
                            }
                          >
                            <Eraser
                              size={11}
                              className="text-zinc-400 hover:text-amber-500"
                            />
                          </button>
                          <button
                            className="hidden group-hover/bucket:block p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 shrink-0 disabled:opacity-40"
                            title={t("bucket.delete")}
                            onClick={(e) =>
                              confirmDeleteBucket(conn.id, bucket.name, e)
                            }
                            disabled={
                              inspectingBucket === `${conn.id}:${bucket.name}`
                            }
                          >
                            <Trash2
                              size={11}
                              className="text-zinc-400 hover:text-red-500"
                            />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Connection create/edit dialog */}
      <ConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editConnection={editingConnection}
      />

      {/* Delete connection confirmation */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t("connection.delete")}
        description={t("connection.deleteConfirm")}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={handleDelete}
      />

      {/* Create bucket dialog */}
      <InputDialog
        open={createBucketOpen}
        onOpenChange={setCreateBucketOpen}
        title={t("bucket.create")}
        label={t("bucket.name")}
        placeholder="my-new-bucket"
        confirmLabel={t("connection.create")}
        onConfirm={handleCreateBucket}
      />

      {/* Delete bucket — simple confirm (empty bucket, no versions) */}
      <ConfirmDialog
        open={deleteBucketOpen}
        onOpenChange={setDeleteBucketOpen}
        title={t("bucket.delete")}
        description={t("bucket.deleteConfirm", {
          name: deletingBucket?.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={handleSimpleDeleteBucket}
      />

      {/* Delete bucket — purge + delete (non-empty / versioned) */}
      <DangerousConfirmDialog
        open={purgeAndDeleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setPurgeAndDeleteTarget(null);
        }}
        title={t("bucket.purgeAndDelete.title", {
          name: purgeAndDeleteTarget?.name ?? "",
        })}
        warning={
          purgeAndDeleteTarget?.info.has_versions
            ? t("bucket.purgeAndDelete.warningVersioned", {
                name: purgeAndDeleteTarget?.name ?? "",
              })
            : t("bucket.purgeAndDelete.warningNonEmpty", {
                name: purgeAndDeleteTarget?.name ?? "",
              })
        }
        details={[
          t("bucket.purgeAndDelete.detailErasesObjects"),
          ...(purgeAndDeleteTarget?.info.has_versions
            ? [t("bucket.purgeAndDelete.detailErasesVersions")]
            : []),
          t("bucket.purgeAndDelete.detailDeletesBucket"),
        ]}
        confirmPhrase="delete me"
        confirmLabel={t("bucket.purgeAndDelete.confirmLabel")}
        onConfirm={handlePurgeAndDelete}
      />

      {/* Empty bucket — keeps the bucket, removes everything inside */}
      <DangerousConfirmDialog
        open={emptyBucketTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEmptyBucketTarget(null);
        }}
        title={t("bucket.emptyDialog.title", {
          name: emptyBucketTarget?.name ?? "",
        })}
        warning={
          emptyBucketTarget?.info.has_versions
            ? t("bucket.emptyDialog.warningVersioned", {
                name: emptyBucketTarget?.name ?? "",
              })
            : t("bucket.emptyDialog.warning", {
                name: emptyBucketTarget?.name ?? "",
              })
        }
        details={[
          t("bucket.emptyDialog.detailErasesObjects"),
          ...(emptyBucketTarget?.info.has_versions
            ? [t("bucket.emptyDialog.detailErasesVersions")]
            : []),
          t("bucket.emptyDialog.detailKeepsBucket"),
        ]}
        confirmPhrase="delete me"
        confirmLabel={t("bucket.emptyDialog.confirmLabel")}
        onConfirm={handleEmptyBucket}
      />

      {/* Import connections dialog */}
      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />

      {/* Bucket properties dialog */}
      {propertiesBucket && (
        <BucketPropertiesDialog
          open={!!propertiesBucket}
          onOpenChange={(o) => {
            if (!o) setPropertiesBucket(null);
          }}
          connectionId={propertiesBucket.connId}
          bucket={propertiesBucket.name}
        />
      )}
    </>
  );
}
