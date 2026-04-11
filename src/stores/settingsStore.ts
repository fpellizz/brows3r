import { create } from "zustand";
import { tauriInvoke } from "@/lib/tauri";

export interface AppSettings {
  general: {
    language: string;
    check_updates: boolean;
    log_level: string;
    http_log_enabled: boolean;
  };
  transfer: {
    max_concurrent_transfers: number;
    max_concurrent_parts: number;
    multipart_threshold_mb: number;
    part_size_mb: number;
    max_bandwidth_mbps: number | null;
    verify_checksum: boolean;
    retry_count: number;
  };
  ui: {
    theme: "light" | "dark" | "system";
    sidebar_width: number;
    show_transfer_panel: boolean;
    show_terminal_panel: boolean;
    show_details_panel: boolean;
    default_view: "hierarchical" | "flat";
    confirm_delete: boolean;
    date_format: string;
  };
}

interface SettingsState {
  settings: AppSettings | null;
  loading: boolean;

  fetchSettings: () => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  loading: false,

  fetchSettings: async () => {
    set({ loading: true });
    const settings = await tauriInvoke<AppSettings>("get_settings");
    set({ settings, loading: false });
  },

  updateSettings: async (settings) => {
    await tauriInvoke("update_settings", { settings });
    set({ settings });
  },
}));
