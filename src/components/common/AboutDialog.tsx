import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { getVersion, getTauriVersion } from "@tauri-apps/api/app";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState("");
  const [tauriVersion, setTauriVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    getVersion().then(setAppVersion);
    getTauriVersion().then(setTauriVersion);
  }, [open]);

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
            </div>

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
                &copy; {new Date().getFullYear()} Decisyon
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
