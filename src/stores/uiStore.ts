import { create } from "zustand";

export interface PreviewTarget {
  key: string;
  displayName: string;
}

interface UiState {
  sidebarWidth: number;
  showTransferPanel: boolean;
  showTerminalPanel: boolean;
  showDetailsPanel: boolean;
  activeTab: string;
  previewObject: PreviewTarget | null;

  setSidebarWidth: (width: number) => void;
  toggleTransferPanel: () => void;
  toggleTerminalPanel: () => void;
  toggleDetailsPanel: () => void;
  setActiveTab: (tab: string) => void;
  openPreview: (target: PreviewTarget) => void;
  closePreview: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 260,
  showTransferPanel: true,
  showTerminalPanel: false,
  showDetailsPanel: false,
  activeTab: "main",
  previewObject: null,

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleTransferPanel: () =>
    set((s) => ({ showTransferPanel: !s.showTransferPanel })),
  toggleTerminalPanel: () =>
    set((s) => ({ showTerminalPanel: !s.showTerminalPanel })),
  toggleDetailsPanel: () =>
    set((s) => ({ showDetailsPanel: !s.showDetailsPanel })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  openPreview: (target) => set({ previewObject: target }),
  closePreview: () => set({ previewObject: null }),
}));
