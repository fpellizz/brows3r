import { create } from "zustand";
import { tauriInvoke } from "@/lib/tauri";
import { useUiStore } from "@/stores/uiStore";

export interface ObjectInfo {
  key: string;
  display_name: string;
  is_folder: boolean;
  size: number | null;
  last_modified: string | null;
  etag: string | null;
  storage_class: string | null;
}

export interface ObjectDetails {
  key: string;
  size: number;
  last_modified: string | null;
  etag: string | null;
  content_type: string | null;
  storage_class: string | null;
  metadata: { key: string; value: string }[];
  version_id: string | null;
}

interface ListObjectsResponse {
  objects: ObjectInfo[];
  common_prefixes: string[];
  continuation_token: string | null;
  is_truncated: boolean;
}

interface TabObjectState {
  objects: ObjectInfo[];
  selectedKeys: Set<string>;
  continuationToken: string | null;
  isTruncated: boolean;
  loading: boolean;
  error: string | null;
}

function defaultTabObjectState(): TabObjectState {
  return {
    objects: [],
    selectedKeys: new Set(),
    continuationToken: null,
    isTruncated: false,
    loading: false,
    error: null,
  };
}

interface ObjectState {
  tabStates: Record<string, TabObjectState>;

  // Selectors that read from the active tab
  currentBucket: string | null;
  currentPrefix: string;
  objects: ObjectInfo[];
  selectedKeys: Set<string>;
  continuationToken: string | null;
  isTruncated: boolean;
  loading: boolean;
  error: string | null;

  // Internal: sync derived fields from active tab
  _syncActiveTab: () => void;

  setCurrentBucket: (bucket: string | null) => void;
  navigateToPrefix: (prefix: string) => void;
  navigateUp: () => void;
  fetchObjects: (connectionId: string) => Promise<void>;
  fetchMore: (connectionId: string) => Promise<void>;
  selectObject: (key: string) => void;
  deselectObject: (key: string) => void;
  toggleSelection: (key: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  deleteSelected: (connectionId: string) => Promise<void>;
  cleanupTab: (tabId: string) => void;
}

/** Get the active tab ID from uiStore */
function getActiveTabId(): string {
  return useUiStore.getState().activeTabId;
}

/** Get the active tab from uiStore */
function getActiveTab() {
  return useUiStore.getState().getActiveTab();
}

export const useObjectStore = create<ObjectState>((set, get) => ({
  tabStates: {},

  // Derived fields from active tab (synced via _syncActiveTab)
  currentBucket: null,
  currentPrefix: "",
  objects: [],
  selectedKeys: new Set(),
  continuationToken: null,
  isTruncated: false,
  loading: false,
  error: null,

  _syncActiveTab: () => {
    const tabId = getActiveTabId();
    const tab = getActiveTab();
    const tabState = get().tabStates[tabId] ?? defaultTabObjectState();
    set({
      currentBucket: tab?.bucket ?? null,
      currentPrefix: tab?.prefix ?? "",
      objects: tabState.objects,
      selectedKeys: tabState.selectedKeys,
      continuationToken: tabState.continuationToken,
      isTruncated: tabState.isTruncated,
      loading: tabState.loading,
      error: tabState.error,
    });
  },

  setCurrentBucket: (bucket) => {
    const tabId = getActiveTabId();
    const uiStore = useUiStore.getState();

    // Update the tab in uiStore
    uiStore.updateTab(tabId, { bucket, prefix: "" });

    // Reset object state for this tab
    set((s) => ({
      tabStates: {
        ...s.tabStates,
        [tabId]: defaultTabObjectState(),
      },
    }));

    get()._syncActiveTab();
  },

  navigateToPrefix: (prefix) => {
    const tabId = getActiveTabId();
    const uiStore = useUiStore.getState();

    // Update prefix in the tab
    uiStore.updateTab(tabId, { prefix });

    // Reset object state for navigation
    set((s) => ({
      tabStates: {
        ...s.tabStates,
        [tabId]: {
          ...(s.tabStates[tabId] ?? defaultTabObjectState()),
          objects: [],
          selectedKeys: new Set(),
          continuationToken: null,
          isTruncated: false,
        },
      },
    }));

    get()._syncActiveTab();
  },

  navigateUp: () => {
    const tab = getActiveTab();
    if (!tab?.prefix) return;
    const parts = tab.prefix.replace(/\/$/, "").split("/");
    parts.pop();
    const newPrefix = parts.length > 0 ? `${parts.join("/")}/` : "";
    get().navigateToPrefix(newPrefix);
  },

  fetchObjects: async (connectionId) => {
    const tabId = getActiveTabId();
    const tab = getActiveTab();
    if (!tab?.bucket) return;

    const bucket = tab.bucket;
    const prefix = tab.prefix;

    // Update the tab's connectionId
    useUiStore.getState().updateTab(tabId, { connectionId });

    // Set loading
    set((s) => ({
      tabStates: {
        ...s.tabStates,
        [tabId]: {
          ...(s.tabStates[tabId] ?? defaultTabObjectState()),
          loading: true,
          error: null,
        },
      },
    }));
    get()._syncActiveTab();

    try {
      const response = await tauriInvoke<ListObjectsResponse>("list_objects", {
        request: {
          connection_id: connectionId,
          bucket,
          prefix: prefix || null,
          delimiter: "/",
          max_keys: 1000,
          continuation_token: null,
        },
      });

      set((s) => ({
        tabStates: {
          ...s.tabStates,
          [tabId]: {
            ...(s.tabStates[tabId] ?? defaultTabObjectState()),
            objects: response.objects,
            continuationToken: response.continuation_token,
            isTruncated: response.is_truncated,
            loading: false,
            error: null,
          },
        },
      }));
    } catch (e) {
      set((s) => ({
        tabStates: {
          ...s.tabStates,
          [tabId]: {
            ...(s.tabStates[tabId] ?? defaultTabObjectState()),
            error: String(e),
            loading: false,
          },
        },
      }));
    }

    // Only sync if this tab is still active
    if (getActiveTabId() === tabId) {
      get()._syncActiveTab();
    }
  },

  fetchMore: async (connectionId) => {
    const tabId = getActiveTabId();
    const tab = getActiveTab();
    const tabState = get().tabStates[tabId];
    if (!tab?.bucket || !tabState?.continuationToken) return;

    const bucket = tab.bucket;
    const prefix = tab.prefix;

    set((s) => ({
      tabStates: {
        ...s.tabStates,
        [tabId]: { ...tabState, loading: true },
      },
    }));
    get()._syncActiveTab();

    try {
      const response = await tauriInvoke<ListObjectsResponse>("list_objects", {
        request: {
          connection_id: connectionId,
          bucket,
          prefix: prefix || null,
          delimiter: "/",
          max_keys: 1000,
          continuation_token: tabState.continuationToken,
        },
      });

      set((s) => {
        const current = s.tabStates[tabId] ?? defaultTabObjectState();
        return {
          tabStates: {
            ...s.tabStates,
            [tabId]: {
              ...current,
              objects: [...current.objects, ...response.objects],
              continuationToken: response.continuation_token,
              isTruncated: response.is_truncated,
              loading: false,
            },
          },
        };
      });
    } catch (e) {
      set((s) => ({
        tabStates: {
          ...s.tabStates,
          [tabId]: {
            ...(s.tabStates[tabId] ?? defaultTabObjectState()),
            error: String(e),
            loading: false,
          },
        },
      }));
    }

    if (getActiveTabId() === tabId) {
      get()._syncActiveTab();
    }
  },

  selectObject: (key) => {
    const tabId = getActiveTabId();
    set((s) => {
      const tabState = s.tabStates[tabId] ?? defaultTabObjectState();
      const selected = new Set(tabState.selectedKeys);
      selected.add(key);
      return {
        tabStates: {
          ...s.tabStates,
          [tabId]: { ...tabState, selectedKeys: selected },
        },
      };
    });
    get()._syncActiveTab();
  },

  deselectObject: (key) => {
    const tabId = getActiveTabId();
    set((s) => {
      const tabState = s.tabStates[tabId] ?? defaultTabObjectState();
      const selected = new Set(tabState.selectedKeys);
      selected.delete(key);
      return {
        tabStates: {
          ...s.tabStates,
          [tabId]: { ...tabState, selectedKeys: selected },
        },
      };
    });
    get()._syncActiveTab();
  },

  toggleSelection: (key) => {
    const tabId = getActiveTabId();
    set((s) => {
      const tabState = s.tabStates[tabId] ?? defaultTabObjectState();
      const selected = new Set(tabState.selectedKeys);
      if (selected.has(key)) {
        selected.delete(key);
      } else {
        selected.add(key);
      }
      return {
        tabStates: {
          ...s.tabStates,
          [tabId]: { ...tabState, selectedKeys: selected },
        },
      };
    });
    get()._syncActiveTab();
  },

  selectAll: () => {
    const tabId = getActiveTabId();
    set((s) => {
      const tabState = s.tabStates[tabId] ?? defaultTabObjectState();
      const keys = new Set(tabState.objects.map((o) => o.key));
      return {
        tabStates: {
          ...s.tabStates,
          [tabId]: { ...tabState, selectedKeys: keys },
        },
      };
    });
    get()._syncActiveTab();
  },

  clearSelection: () => {
    const tabId = getActiveTabId();
    set((s) => {
      const tabState = s.tabStates[tabId] ?? defaultTabObjectState();
      return {
        tabStates: {
          ...s.tabStates,
          [tabId]: { ...tabState, selectedKeys: new Set() },
        },
      };
    });
    get()._syncActiveTab();
  },

  deleteSelected: async (connectionId) => {
    const tabId = getActiveTabId();
    const tab = getActiveTab();
    const tabState = get().tabStates[tabId];
    if (!tab?.bucket || !tabState || tabState.selectedKeys.size === 0) return;

    await tauriInvoke("delete_objects", {
      request: {
        connection_id: connectionId,
        bucket: tab.bucket,
        keys: Array.from(tabState.selectedKeys),
      },
    });

    set((s) => ({
      tabStates: {
        ...s.tabStates,
        [tabId]: {
          ...(s.tabStates[tabId] ?? defaultTabObjectState()),
          selectedKeys: new Set(),
        },
      },
    }));

    await get().fetchObjects(connectionId);
  },

  cleanupTab: (tabId) => {
    set((s) => {
      const { [tabId]: _, ...rest } = s.tabStates;
      return { tabStates: rest };
    });
  },
}));

// Subscribe to uiStore activeTabId changes to sync derived fields
useUiStore.subscribe(
  (state, prevState) => {
    if (state.activeTabId !== prevState.activeTabId) {
      useObjectStore.getState()._syncActiveTab();
    }
  },
);
