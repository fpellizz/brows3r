import { create } from "zustand";

export interface PreviewTarget {
  key: string;
  displayName: string;
}

export interface DetailsTarget {
  key: string;
  displayName: string;
  isFolder: boolean;
}

interface UiState {
  sidebarWidth: number;
  showTransferPanel: boolean;
  showTerminalPanel: boolean;
  showDetailsPanel: boolean;
  activeTab: string;
  previewObject: PreviewTarget | null;
  detailsObject: DetailsTarget | null;

  setSidebarWidth: (width: number) => void;
  toggleTransferPanel: () => void;
  toggleTerminalPanel: () => void;
  toggleDetailsPanel: () => void;
  setActiveTab: (tab: string) => void;
  openPreview: (target: PreviewTarget) => void;
  closePreview: () => void;
  openDetails: (target: DetailsTarget) => void;
  closeDetails: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarWidth: 260,
  showTransferPanel: true,
  showTerminalPanel: false,
  showDetailsPanel: false,
  activeTab: "main",
  previewObject: null,
  detailsObject: null,

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleTransferPanel: () =>
    set((s) => ({ showTransferPanel: !s.showTransferPanel })),
  toggleTerminalPanel: () =>
    set((s) => ({ showTerminalPanel: !s.showTerminalPanel })),
  toggleDetailsPanel: () =>
    set((s) => ({ showDetailsPanel: !s.showDetailsPanel })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  openPreview: (target) => set({ previewObject: target, detailsObject: null }),
  closePreview: () => set({ previewObject: null }),
  openDetails: (target) => set({ detailsObject: target, previewObject: null }),
  closeDetails: () => set({ detailsObject: null }),
}));
