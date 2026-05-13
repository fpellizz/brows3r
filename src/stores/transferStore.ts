import { tauriInvoke, tauriListen } from "@/lib/tauri";
import { create } from "zustand";

export interface TransferItem {
  id: string;
  transfer_type: "upload" | "download";
  connection_id: string;
  bucket: string;
  key: string;
  local_path: string;
  total_bytes: number;
  transferred_bytes: number;
  status:
    | "queued"
    | "inprogress"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";
  speed_bps: number | null;
  eta_secs: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TransferHistoryEntry {
  id: string;
  transfer_type: "upload" | "download";
  connection_id: string;
  bucket: string;
  key: string;
  local_path: string;
  total_bytes: number;
  status: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

interface TransferProgressEvent {
  id: string;
  transferred_bytes: number;
  total_bytes: number;
  speed_bps: number;
  eta_secs: number;
}

interface TransferCompleteEvent {
  id: string;
  success: boolean;
  error: string | null;
  etag: string | null;
}

interface TransferState {
  transfers: TransferItem[];
  history: TransferHistoryEntry[];
  listening: boolean;

  startListening: () => Promise<void>;
  fetchTransfers: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  startUpload: (
    connectionId: string,
    bucket: string,
    prefix: string | null,
    localPaths: string[],
  ) => Promise<string[]>;
  startDownload: (
    connectionId: string,
    bucket: string,
    keys: string[],
    localDir: string,
  ) => Promise<string[]>;
  startCrossTransfer: (
    sourceConnectionId: string,
    sourceBucket: string,
    sourceKeys: string[],
    destConnectionId: string,
    destBucket: string,
    destPrefix: string | null,
    preserveMetadata: boolean,
  ) => Promise<string[]>;
  pauseTransfer: (id: string) => Promise<void>;
  resumeTransfer: (id: string) => Promise<void>;
  cancelTransfer: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
}

export const useTransferStore = create<TransferState>((set, get) => ({
  transfers: [],
  history: [],
  listening: false,

  startListening: async () => {
    if (get().listening) return;
    set({ listening: true });

    // Listen for progress events
    await tauriListen<TransferProgressEvent>("transfer:progress", (payload) => {
      set((state) => ({
        transfers: state.transfers.map((t) =>
          t.id === payload.id
            ? {
                ...t,
                transferred_bytes: payload.transferred_bytes,
                total_bytes: payload.total_bytes,
                speed_bps: payload.speed_bps,
                eta_secs: payload.eta_secs,
                status: "inprogress" as const,
              }
            : t,
        ),
      }));
    });

    // Listen for completion events
    await tauriListen<TransferCompleteEvent>("transfer:complete", (payload) => {
      set((state) => ({
        transfers: state.transfers.map((t) =>
          t.id === payload.id
            ? {
                ...t,
                status: payload.success
                  ? ("completed" as const)
                  : ("failed" as const),
                error: payload.error,
                transferred_bytes: payload.success
                  ? t.total_bytes
                  : t.transferred_bytes,
              }
            : t,
        ),
      }));
    });
  },

  fetchTransfers: async () => {
    const transfers = await tauriInvoke<TransferItem[]>("list_transfers");
    set({ transfers });
  },

  fetchHistory: async () => {
    const history = await tauriInvoke<TransferHistoryEntry[]>(
      "list_transfer_history",
    );
    set({ history });
  },

  startUpload: async (connectionId, bucket, prefix, localPaths) => {
    const ids = await tauriInvoke<string[]>("start_upload", {
      request: {
        connection_id: connectionId,
        bucket,
        prefix,
        local_paths: localPaths,
      },
    });
    await get().fetchTransfers();
    return ids;
  },

  startDownload: async (connectionId, bucket, keys, localDir) => {
    const ids = await tauriInvoke<string[]>("start_download", {
      request: {
        connection_id: connectionId,
        bucket,
        keys,
        local_dir: localDir,
      },
    });
    await get().fetchTransfers();
    return ids;
  },

  startCrossTransfer: async (
    sourceConnectionId,
    sourceBucket,
    sourceKeys,
    destConnectionId,
    destBucket,
    destPrefix,
    preserveMetadata,
  ) => {
    const ids = await tauriInvoke<string[]>("start_cross_transfer", {
      request: {
        source_connection_id: sourceConnectionId,
        source_bucket: sourceBucket,
        source_keys: sourceKeys,
        dest_connection_id: destConnectionId,
        dest_bucket: destBucket,
        dest_prefix: destPrefix,
        preserve_metadata: preserveMetadata,
      },
    });
    await get().fetchTransfers();
    return ids;
  },

  pauseTransfer: async (id) => {
    await tauriInvoke("pause_transfer", { id });
    await get().fetchTransfers();
  },

  resumeTransfer: async (id) => {
    await tauriInvoke("resume_transfer", { id });
    await get().fetchTransfers();
  },

  cancelTransfer: async (id) => {
    await tauriInvoke("cancel_transfer", { id });
    await get().fetchTransfers();
  },

  clearCompleted: async () => {
    // Clear from backend queue first so they don't come back on next fetch.
    await tauriInvoke("clear_finished_transfers");
    set((state) => ({
      transfers: state.transfers.filter(
        (t) =>
          t.status !== "completed" &&
          t.status !== "failed" &&
          t.status !== "cancelled",
      ),
    }));
  },
}));
