import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ExternalLink,
  Loader2,
  RotateCw,
  X,
} from "lucide-react";
import { useUpdaterStore } from "@/stores/updaterStore";

/** Compact, non-modal update banner shown above the toolbar when a new
 * version is available. AppImage / NSIS / macOS users see an "Install
 * now" button (drives the Tauri updater plugin). deb / rpm users only
 * see a link to the releases page so they don't end up with two copies
 * of the binary (one from the package manager, one from `/tmp`). */
export function UpdateBanner() {
  const { t } = useTranslation();
  const status = useUpdaterStore((s) => s.status);
  const available = useUpdaterStore((s) => s.available);
  const installInfo = useUpdaterStore((s) => s.installInfo);
  const progress = useUpdaterStore((s) => s.progress);
  const downloadAndInstall = useUpdaterStore((s) => s.downloadAndInstall);
  const dismiss = useUpdaterStore((s) => s.dismiss);
  const openReleasesPage = useUpdaterStore((s) => s.openReleasesPage);

  // Show the banner only while a new version is available or while the
  // user is actively installing one. "uptodate" / "error" / "idle" are
  // surfaced inside the About dialog instead, to avoid nagging at the
  // top of the window.
  const visible =
    status === "available" || status === "downloading" || status === "installed";
  if (!visible) return null;

  const inPlace = installInfo?.supports_in_place_update ?? false;
  const percent =
    progress && progress.contentLength > 0
      ? Math.min(
          100,
          Math.round((progress.downloaded / progress.contentLength) * 100),
        )
      : null;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 border-b border-brand-200 dark:border-brand-900/50 bg-brand-50 dark:bg-brand-950/30 text-xs">
      <ArrowDownToLine
        size={14}
        className="shrink-0 text-brand-600 dark:text-brand-400"
      />

      <span className="flex-1 truncate text-brand-900 dark:text-brand-100">
        {status === "installed" ? (
          t("updater.installedRestart")
        ) : (
          <>
            <strong>{t("updater.updateAvailable")}</strong>{" "}
            <span className="text-brand-700 dark:text-brand-300">
              v{available?.currentVersion} → v{available?.version}
            </span>
          </>
        )}
      </span>

      {status === "downloading" && (
        <span className="text-brand-700 dark:text-brand-300 tabular-nums">
          {percent !== null ? `${percent}%` : t("updater.downloading")}
        </span>
      )}

      {status === "available" && (
        <>
          {inPlace ? (
            <button
              type="button"
              onClick={() => void downloadAndInstall()}
              className="px-2.5 py-1 rounded bg-brand-600 hover:bg-brand-700 text-white font-medium"
            >
              {t("updater.installNow")}
            </button>
          ) : (
            <button
              type="button"
              onClick={openReleasesPage}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-brand-600 hover:bg-brand-700 text-white font-medium"
            >
              {t("updater.downloadPage")}
              <ExternalLink size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="p-1 rounded text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50"
            title={t("updater.later")}
            aria-label={t("updater.later")}
          >
            <X size={12} />
          </button>
        </>
      )}

      {status === "downloading" && (
        <Loader2
          size={14}
          className="animate-spin text-brand-600 dark:text-brand-400"
        />
      )}

      {status === "installed" && (
        <span className="flex items-center gap-1 text-brand-700 dark:text-brand-300">
          <RotateCw size={11} />
          {t("updater.restartHint")}
        </span>
      )}
    </div>
  );
}
