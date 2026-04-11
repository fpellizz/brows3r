import { create } from "zustand";

interface UiState {
  sidebarWidth: number;
  showTransferPanel: boolean;
  showTerminalPanel: boolean;
  showDetailsPanel: boolean;
  activeTab: string;

  setSidebarWidth: (width: number) => void;
  toggleTransferPanel: () => void;
  toggleTerminalPanel: () => void;
  toggleDetailsPanel: () => void;
  setActiveTab: (tab: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 260,
  showTransferPanel: true,
  showTerminalPanel: false,
  showDetailsPanel: false,
  activeTab: "main",

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleTransferPanel: () =>
    set((s) => ({ showTransferPanel: !s.showTransferPanel })),
  toggleTerminalPanel: () =>
    set((s) => ({ showTerminalPanel: !s.showTerminalPanel })),
  toggleDetailsPanel: () =>
    set((s) => ({ showDetailsPanel: !s.showDetailsPanel })),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
