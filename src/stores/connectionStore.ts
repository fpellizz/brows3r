import { create } from "zustand";
import { tauriInvoke } from "@/lib/tauri";

export interface Connection {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  access_key_id: string;
  path_style: "auto" | "path" | "virtual";
  proxy: string | null;
  ca_bundle: string | null;
  timeout_secs: number;
  max_retries: number;
  notes: string | null;
  group: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectionTestResult {
  success: boolean;
  latency_ms: number;
  bucket_count: number | null;
  error: string | null;
}

interface ConnectionState {
  connections: Connection[];
  activeConnectionId: string | null;
  loading: boolean;
  error: string | null;

  fetchConnections: () => Promise<void>;
  setActiveConnection: (id: string | null) => void;
  createConnection: (request: Record<string, unknown>) => Promise<Connection>;
  updateConnection: (
    id: string,
    request: Record<string, unknown>,
  ) => Promise<Connection>;
  deleteConnection: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<ConnectionTestResult>;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  loading: false,
  error: null,

  fetchConnections: async () => {
    set({ loading: true, error: null });
    try {
      const connections =
        await tauriInvoke<Connection[]>("list_connections");
      set({ connections, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  setActiveConnection: (id) => {
    set({ activeConnectionId: id });
  },

  createConnection: async (request) => {
    const conn = await tauriInvoke<Connection>("create_connection", {
      request,
    });
    await get().fetchConnections();
    return conn;
  },

  updateConnection: async (id, request) => {
    const conn = await tauriInvoke<Connection>("update_connection", {
      id,
      request,
    });
    await get().fetchConnections();
    return conn;
  },

  deleteConnection: async (id) => {
    await tauriInvoke("delete_connection", { id });
    if (get().activeConnectionId === id) {
      set({ activeConnectionId: null });
    }
    await get().fetchConnections();
  },

  testConnection: async (id) => {
    return tauriInvoke<ConnectionTestResult>("test_connection", { id });
  },
}));
