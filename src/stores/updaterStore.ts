import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { tauriInvoke } from "@/lib/tauri";

/** GitHub releases page used as a fallback download link for users
 * whose install is not in-place updatable (deb / rpm). */
const RELEASES_PAGE_URL =
  "https://github.com/fpellizz/brows3r/releases/latest";

/** Key prefix for "do not nag me about this version again" markers. */
const DISMISSED_KEY = "brows3r:updater:dismissed_version";

export type InstallKind =
  | "app_image"
  | "linux_system"
  | "windows_nsis"
  | "mac_app"
  | "dev"
  | "unknown";

export interface InstallInfo {
  kind: InstallKind;
  supports_in_place_update: boolean;
}

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "uptodate"
  | "downloading"
  | "installed"
  | "error";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
  /** External link to the releases page; used for deb/rpm where the
   * in-place install path is not available. */
  releasesUrl: string;
}

interface UpdaterState {
  installInfo: InstallInfo | null;
  currentVersion: string;
  status: UpdaterStatus;
  available: AvailableUpdate | null;
  progress: { downloaded: number; contentLength: number } | null;
  errorMessage: string | null;
  /** Tauri Update handle kept around so we can call downloadAndInstall
   * without re-running check(). Not serialized into UI. */
  _update: Update | null;

  init: () => Promise<void>;
  /** `silent=true` swallows the "uptodate" state in the banner (used by
   * the on-startup check) but still surfaces "available". */
  checkForUpdates: (silent: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismiss: () => void;
  openReleasesPage: () => void;
}

function isDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === version;
  } catch {
    return false;
  }
}

function markDismissed(version: string) {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* ignore */
  }
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  installInfo: null,
  currentVersion: "",
  status: "idle",
  available: null,
  progress: null,
  errorMessage: null,
  _update: null,

  init: async () => {
    try {
      const [info, version] = await Promise.all([
        tauriInvoke<InstallInfo>("get_install_info"),
        getVersion(),
      ]);
      set({ installInfo: info, currentVersion: version });
    } catch (e) {
      set({ errorMessage: String(e) });
    }
  },

  checkForUpdates: async (silent: boolean) => {
    const { installInfo } = get();
    if (installInfo?.kind === "dev") {
      // Updater is a no-op in dev — the bundle doesn't exist on the
      // server and a failed network round-trip would just produce
      // noise. Manual check shows "up to date" so the user sees
      // feedback.
      set({
        status: silent ? "idle" : "uptodate",
        available: null,
        _update: null,
      });
      return;
    }

    set({ status: "checking", errorMessage: null });

    try {
      const update = await check();
      if (!update) {
        set({
          status: silent ? "idle" : "uptodate",
          available: null,
          _update: null,
        });
        return;
      }

      if (silent && isDismissed(update.version)) {
        set({ status: "idle", available: null, _update: null });
        return;
      }

      const current = get().currentVersion || (await getVersion());
      set({
        status: "available",
        currentVersion: current,
        available: {
          version: update.version,
          currentVersion: current,
          notes: update.body ?? null,
          releasesUrl: RELEASES_PAGE_URL,
        },
        _update: update,
      });
    } catch (e) {
      set({
        status: silent ? "idle" : "error",
        errorMessage: String(e),
        _update: null,
      });
    }
  },

  downloadAndInstall: async () => {
    const { _update, installInfo } = get();
    if (!_update) return;
    if (!installInfo?.supports_in_place_update) return;

    set({ status: "downloading", progress: null, errorMessage: null });

    try {
      let downloaded = 0;
      let contentLength = 0;
      await _update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            set({ progress: { downloaded: 0, contentLength } });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            set({ progress: { downloaded, contentLength } });
            break;
          case "Finished":
            set({ status: "installed", progress: null });
            break;
        }
      });
    } catch (e) {
      set({ status: "error", errorMessage: String(e) });
    }
  },

  dismiss: () => {
    const { available } = get();
    if (available) markDismissed(available.version);
    set({ status: "idle", available: null, _update: null });
  },

  openReleasesPage: () => {
    const { available } = get();
    if (available) markDismissed(available.version);
    // Open in the default browser via the shell plugin
    void import("@tauri-apps/plugin-shell").then(({ open }) =>
      open(available?.releasesUrl ?? RELEASES_PAGE_URL).catch(() => {
        /* noop */
      }),
    );
    set({ status: "idle", available: null, _update: null });
  },
}));
