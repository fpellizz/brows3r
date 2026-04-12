import { create } from "zustand";

export interface Tab {
  id: string;
  label: string;
  connectionId: string | null;
  bucket: string | null;
  prefix: string;
}

function createTab(overrides?: Partial<Tab>): Tab {
  return {
    id: crypto.randomUUID(),
    label: "New Tab",
    connectionId: null,
    bucket: null,
    prefix: "",
    ...overrides,
  };
}

const defaultTab = createTab();

interface UiState {
  sidebarWidth: number;
  showTransferPanel: boolean;
  showTerminalPanel: boolean;
  showDetailsPanel: boolean;

  tabs: Tab[];
  activeTabId: string;

  setSidebarWidth: (width: number) => void;
  toggleTransferPanel: () => void;
  toggleTerminalPanel: () => void;
  toggleDetailsPanel: () => void;

  addTab: (overrides?: Partial<Tab>) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Omit<Tab, "id">>) => void;
  getActiveTab: () => Tab | undefined;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarWidth: 260,
  showTransferPanel: true,
  showTerminalPanel: false,
  showDetailsPanel: false,

  tabs: [defaultTab],
  activeTabId: defaultTab.id,

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  toggleTransferPanel: () =>
    set((s) => ({ showTransferPanel: !s.showTransferPanel })),
  toggleTerminalPanel: () =>
    set((s) => ({ showTerminalPanel: !s.showTerminalPanel })),
  toggleDetailsPanel: () =>
    set((s) => ({ showDetailsPanel: !s.showDetailsPanel })),

  addTab: (overrides) => {
    const tab = createTab(overrides);
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) {
      // Last tab: replace with a fresh empty tab
      const fresh = createTab();
      set({ tabs: [fresh], activeTabId: fresh.id });
      return;
    }

    const idx = tabs.findIndex((t) => t.id === id);
    const remaining = tabs.filter((t) => t.id !== id);

    if (activeTabId === id) {
      // Switch to the next tab, or the previous if closing the last one
      const newIdx = Math.min(idx, remaining.length - 1);
      set({ tabs: remaining, activeTabId: remaining[newIdx].id });
    } else {
      set({ tabs: remaining });
    }
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, updates) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id) return t;
        const updated = { ...t, ...updates };
        // Auto-update label based on bucket
        if ("bucket" in updates) {
          updated.label = updates.bucket || "New Tab";
        }
        return updated;
      }),
    }));
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get();
    return tabs.find((t) => t.id === activeTabId);
  },
}));
