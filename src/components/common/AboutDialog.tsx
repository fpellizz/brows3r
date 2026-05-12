import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { getVersion, getTauriVersion } from "@tauri-apps/api/app";
import { tauriInvoke } from "@/lib/tauri";
import { useUpdaterStore } from "@/stores/updaterStore";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MissingLibrary {
  soname: string;
  description: string;
  deb_package: string;
  rpm_package: string;
}

interface SystemPrerequisitesReport {
  os: string;
  distro_id: string | null;
  distro_name: string | null;
  distro_family: string | null;
  all_present: boolean;
  missing: MissingLibrary[];
  install_command: string | null;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState("");
  const [tauriVersion, setTauriVersion] = useState("");
  const [prereq, setPrereq] = useState<SystemPrerequisitesReport | null>(null);
  const [copied, setCopied] = useState(false);

  const updaterStatus = useUpdaterStore((s) => s.status);
  const updaterAvailable = useUpdaterStore((s) => s.available);
  const updaterError = useUpdaterStore((s) => s.errorMessage);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);

  useEffect(() => {
    if (!open) return;
    getVersion().then(setAppVersion);
    getTauriVersion().then(setTauriVersion);
    tauriInvoke<SystemPrerequisitesReport>("check_system_prerequisites")
      .then(setPrereq)
      .catch(() => setPrereq(null));
  }, [open]);

  const copyInstallCommand = () => {
    if (!prereq?.install_command) return;
    void navigator.clipboard.writeText(prereq.install_command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-white dark:bg-zinc-900 rounded-lg shadow-xl flex flex-col z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <Dialog.Title className="text-base font-semibold">
              {t("about.title")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label={t("common.close")}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            {/* Logo + name */}
            <div className="text-center">
              <img
                src="/icon.svg"
                alt="brows3r"
                className="w-20 h-20 mx-auto mb-2 rounded-2xl shadow-lg"
              />
              <h2 className="text-2xl font-bold text-brand-600 dark:text-brand-400">
                brows3r
              </h2>
              <p className="text-xs text-zinc-500 mt-1">
                {t("about.tagline")}
              </p>
            </div>

            {/* Version info */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-md px-4 py-3 space-y-1.5 text-xs">
              <InfoRow label={t("about.version")} value={appVersion} />
              <InfoRow label="Tauri" value={tauriVersion} />
              <InfoRow label="React" value="19" />
              <InfoRow label="Rust" value="2021 edition" />
              {prereq?.distro_name && (
                <InfoRow label={t("about.system")} value={prereq.distro_name} />
              )}
            </div>

            {/* Check for updates */}
            <div className="flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => void checkForUpdates(false)}
                disabled={updaterStatus === "checking"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                {updaterStatus === "checking" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                {t("updater.checkForUpdates")}
              </button>
              <span className="text-zinc-500">
                {updaterStatus === "uptodate" && t("updater.upToDate")}
                {updaterStatus === "available" && updaterAvailable && (
                  <span className="text-brand-600 dark:text-brand-400">
                    {t("updater.newVersionAvailable", {
                      version: updaterAvailable.version,
                    })}
                  </span>
                )}
                {updaterStatus === "error" && (
                  <span
                    className="text-red-500 truncate max-w-[180px] inline-block align-middle"
                    title={updaterError ?? ""}
                  >
                    {t("updater.checkFailed")}
                  </span>
                )}
              </span>
            </div>

            {/* System prerequisites */}
            {prereq && (
              <div
                className={
                  "rounded-md px-4 py-3 text-xs flex gap-2 " +
                  (prereq.all_present
                    ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
                    : "bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200")
                }
              >
                {prereq.all_present ? (
                  <CheckCircle2
                    size={14}
                    className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                  />
                ) : (
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium">
                    {prereq.all_present
                      ? t("about.prereqOk")
                      : t("about.prereqMissing", { count: prereq.missing.length })}
                  </p>
                  {!prereq.all_present && (
                    <>
                      <ul className="mt-1 list-disc list-inside space-y-0.5">
                        {prereq.missing.map((m) => (
                          <li key={m.soname} className="font-mono text-[11px]">
                            {m.soname}{" "}
                            <span className="text-amber-700/80 dark:text-amber-300/70 font-sans">
                              ({m.description})
                            </span>
                          </li>
                        ))}
                      </ul>
                      {prereq.install_command && (
                        <div className="mt-2 flex items-start gap-1.5">
                          <pre className="flex-1 bg-amber-100/60 dark:bg-amber-900/40 rounded px-2 py-1 text-[11px] font-mono whitespace-pre-wrap break-all">
                            {prereq.install_command}
                          </pre>
                          <button
                            type="button"
                            onClick={copyInstallCommand}
                            className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 shrink-0"
                            title={t("common.copy")}
                            aria-label={t("common.copy")}
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      )}
                      {copied && (
                        <p className="mt-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                          {t("common.copied")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Description */}
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              {t("about.description")}
            </p>

            {/* Author */}
            <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
              <p>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {t("about.author")}:
                </span>{" "}
                Fabio Pellizzaro
              </p>
              <p>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {t("about.copyright")}:
                </span>{" "}
                &copy; {new Date().getFullYear()} Fabio Pellizzaro
              </p>
            </div>

            {/* Tech stack */}
            <div>
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                {t("about.builtWith")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Tauri v2",
                  "React 19",
                  "TypeScript",
                  "Rust",
                  "aws-sdk-s3",
                  "Tailwind CSS",
                  "Zustand",
                  "Radix UI",
                  "SQLite",
                ].map((tech) => (
                  <span
                    key={tech}
                    className="px-2 py-0.5 text-[10px] rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-center px-6 py-4 border-t border-zinc-200 dark:border-zinc-800">
            <Dialog.Close asChild>
              <button
                type="button"
                className="px-6 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700"
              >
                {t("common.close")}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono text-zinc-700 dark:text-zinc-300">
        {value || "..."}
      </span>
    </div>
  );
}
