import { create } from "zustand";
import { tauriInvoke } from "@/lib/tauri";

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

interface ObjectState {
  currentBucket: string | null;
  currentPrefix: string;
  objects: ObjectInfo[];
  selectedKeys: Set<string>;
  continuationToken: string | null;
  isTruncated: boolean;
  loading: boolean;
  error: string | null;
  filterText: string;

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
  setFilterText: (text: string) => void;
  getFilteredObjects: () => ObjectInfo[];
}

/** Match a display name against a filter string.
 *  - If filter starts with `/` and ends with `/`, treat as regex
 *  - If filter contains `*` or `?`, treat as glob pattern
 *  - Otherwise, case-insensitive substring match
 */
function matchesFilter(displayName: string, filter: string): boolean {
  if (!filter) return true;

  // Regex mode: /pattern/
  if (filter.startsWith("/") && filter.endsWith("/") && filter.length > 2) {
    try {
      const regex = new RegExp(filter.slice(1, -1), "i");
      return regex.test(displayName);
    } catch {
      return displayName.toLowerCase().includes(filter.toLowerCase());
    }
  }

  // Glob mode: contains * or ?
  if (filter.includes("*") || filter.includes("?")) {
    const escaped = filter
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    try {
      const regex = new RegExp(`^${escaped}$`, "i");
      return regex.test(displayName);
    } catch {
      return displayName.toLowerCase().includes(filter.toLowerCase());
    }
  }

  // Simple substring match
  return displayName.toLowerCase().includes(filter.toLowerCase());
}

export const useObjectStore = create<ObjectState>((set, get) => ({
  currentBucket: null,
  currentPrefix: "",
  objects: [],
  selectedKeys: new Set(),
  continuationToken: null,
  isTruncated: false,
  loading: false,
  error: null,
  filterText: "",

  setCurrentBucket: (bucket) => {
    set({
      currentBucket: bucket,
      currentPrefix: "",
      objects: [],
      selectedKeys: new Set(),
      continuationToken: null,
      isTruncated: false,
      filterText: "",
    });
  },

  navigateToPrefix: (prefix) => {
    set({
      currentPrefix: prefix,
      objects: [],
      selectedKeys: new Set(),
      continuationToken: null,
      isTruncated: false,
      filterText: "",
    });
  },

  navigateUp: () => {
    const { currentPrefix } = get();
    if (!currentPrefix) return;
    const parts = currentPrefix.replace(/\/$/, "").split("/");
    parts.pop();
    const newPrefix = parts.length > 0 ? `${parts.join("/")}/` : "";
    get().navigateToPrefix(newPrefix);
  },

  fetchObjects: async (connectionId) => {
    const { currentBucket, currentPrefix } = get();
    if (!currentBucket) return;

    set({ loading: true, error: null });
    try {
      const response = await tauriInvoke<ListObjectsResponse>("list_objects", {
        request: {
          connection_id: connectionId,
          bucket: currentBucket,
          prefix: currentPrefix || null,
          delimiter: "/",
          max_keys: 1000,
          continuation_token: null,
        },
      });

      set({
        objects: response.objects,
        continuationToken: response.continuation_token,
        isTruncated: response.is_truncated,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchMore: async (connectionId) => {
    const { currentBucket, currentPrefix, continuationToken, objects } = get();
    if (!currentBucket || !continuationToken) return;

    set({ loading: true });
    try {
      const response = await tauriInvoke<ListObjectsResponse>("list_objects", {
        request: {
          connection_id: connectionId,
          bucket: currentBucket,
          prefix: currentPrefix || null,
          delimiter: "/",
          max_keys: 1000,
          continuation_token: continuationToken,
        },
      });

      set({
        objects: [...objects, ...response.objects],
        continuationToken: response.continuation_token,
        isTruncated: response.is_truncated,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectObject: (key) => {
    const selected = new Set(get().selectedKeys);
    selected.add(key);
    set({ selectedKeys: selected });
  },

  deselectObject: (key) => {
    const selected = new Set(get().selectedKeys);
    selected.delete(key);
    set({ selectedKeys: selected });
  },

  toggleSelection: (key) => {
    const selected = new Set(get().selectedKeys);
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }
    set({ selectedKeys: selected });
  },

  selectAll: () => {
    const keys = new Set(get().objects.map((o) => o.key));
    set({ selectedKeys: keys });
  },

  clearSelection: () => {
    set({ selectedKeys: new Set() });
  },

  deleteSelected: async (connectionId) => {
    const { currentBucket, selectedKeys } = get();
    if (!currentBucket || selectedKeys.size === 0) return;

    await tauriInvoke("delete_objects", {
      request: {
        connection_id: connectionId,
        bucket: currentBucket,
        keys: Array.from(selectedKeys),
      },
    });

    set({ selectedKeys: new Set() });
    await get().fetchObjects(connectionId);
  },

  setFilterText: (text) => set({ filterText: text }),

  getFilteredObjects: () => {
    const { objects, filterText } = get();
    if (!filterText) return objects;
    return objects.filter((o) => matchesFilter(o.display_name, filterText));
  },
}));
