import { BucketPropertiesDialog } from "@/components/bucket/BucketPropertiesDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
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
  const [deleteBucketOpen, setDeleteBucketOpen] = useState(false);
  const [deletingBucket, setDeletingBucket] = useState<{
    connId: string;
    name: string;
  } | null>(null);
  const [propertiesBucket, setPropertiesBucket] = useState<{
    connId: string;
    name: string;
  } | null>(null);

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

  const handleDeleteBucket = async () => {
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

  const openCreateBucket = (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCreateBucketConnId(connectionId);
    setCreateBucketOpen(true);
  };

  const confirmDeleteBucket = (
    connId: string,
    bucketName: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setDeletingBucket({ connId, name: bucketName });
    setDeleteBucketOpen(true);
  };

  return (
    <>
      <div className="h-full flex flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {t("sidebar.connections")}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              title={t("import.title")}
              onClick={() => setImportDialogOpen(true)}
            >
              <Download size={14} />
            </button>
            <button
              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              title={t("sidebar.addConnection")}
              onClick={openNewDialog}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Connection tree */}
        <div className="flex-1 overflow-y-auto py-1">
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
                  className={`group w-full flex items-center gap-1.5 px-2 py-1.5 text-sm font-normal hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer ${
                    activeConnectionId === conn.id
                      ? "bg-zinc-200 dark:bg-zinc-800"
                      : ""
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
                  <Database size={14} className="text-brand-500 shrink-0" />
                  <span className="truncate flex-1">{conn.name}</span>

                  {/* Inline action buttons (visible on hover) */}
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    {expandedConnections.has(conn.id) && (
                      <>
                        <button
                          className="p-0.5 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600"
                          title={t("bucket.create")}
                          onClick={(e) => openCreateBucket(conn.id, e)}
                        >
                          <Plus size={12} className="text-zinc-500" />
                        </button>
                        <button
                          className="p-0.5 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600"
                          title="Refresh buckets"
                          onClick={(e) => refreshBuckets(conn.id, e)}
                        >
                          <RefreshCw size={12} className="text-zinc-500" />
                        </button>
                      </>
                    )}
                    <button
                      className="p-0.5 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600"
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
                  <div className="ml-4">
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
                          className={`group/bucket w-full flex items-center gap-1.5 px-2 py-1 text-sm font-normal hover:bg-zinc-200 dark:hover:bg-zinc-800 cursor-pointer ${
                            currentBucket === bucket.name &&
                            activeConnectionId === conn.id
                              ? "bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300"
                              : ""
                          }`}
                          onClick={() => selectBucket(conn.id, bucket.name)}
                        >
                          <FolderOpen
                            size={14}
                            className="text-amber-500 shrink-0"
                          />
                          <span className="truncate flex-1">{bucket.name}</span>
                          <button
                            className="hidden group-hover/bucket:block p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 shrink-0"
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
                            className="hidden group-hover/bucket:block p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 shrink-0"
                            title={t("bucket.delete")}
                            onClick={(e) =>
                              confirmDeleteBucket(conn.id, bucket.name, e)
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

      {/* Delete bucket confirmation */}
      <ConfirmDialog
        open={deleteBucketOpen}
        onOpenChange={setDeleteBucketOpen}
        title={t("bucket.delete")}
        description={t("bucket.deleteConfirm", {
          name: deletingBucket?.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={handleDeleteBucket}
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
