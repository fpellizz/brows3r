import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X, Globe, Palette, ArrowUpDown } from "lucide-react";
import { useSettingsStore, type AppSettings } from "@/stores/settingsStore";
import i18n from "@/lib/i18n";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);

  // Local copy for editing
  const [local, setLocal] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && settings) {
      setLocal(structuredClone(settings));
    }
  }, [open, settings]);

  useEffect(() => {
    if (open && !settings) {
      fetchSettings();
    }
  }, [open, settings, fetchSettings]);

  const handleSave = async () => {
    if (!local) return;
    setSaving(true);
    try {
      await updateSettings(local);

      // Apply language change immediately
      if (local.general.language !== i18n.language) {
        i18n.changeLanguage(local.general.language);
      }

      // Apply theme change immediately
      applyTheme(local.ui.theme);

      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  if (!local) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl max-h-[80vh] overflow-hidden bg-white dark:bg-zinc-900 rounded-lg shadow-xl z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <Dialog.Title className="text-lg font-semibold">
              {t("settings.title")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          {/* Tabs */}
          <Tabs.Root defaultValue="general" className="flex-1 flex flex-col min-h-0">
            <Tabs.List className="flex border-b border-zinc-200 dark:border-zinc-800 px-6 shrink-0">
              <TabTrigger value="general" icon={<Globe size={14} />} label={t("settings.general")} />
              <TabTrigger value="transfers" icon={<ArrowUpDown size={14} />} label={t("settings.transfers")} />
              <TabTrigger value="appearance" icon={<Palette size={14} />} label={t("settings.appearance")} />
            </Tabs.List>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* General */}
              <Tabs.Content value="general" className="space-y-6">
                <SettingRow label={t("settings.language")}>
                  <select
                    className="select-field w-52"
                    value={local.general.language}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        general: { ...local.general, language: e.target.value },
                      })
                    }
                  >
                    <option value="en">English</option>
                    <option value="it">Italiano</option>
                  </select>
                </SettingRow>

                <SettingRow label="Log Level">
                  <select
                    className="select-field w-52"
                    value={local.general.log_level}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        general: { ...local.general, log_level: e.target.value },
                      })
                    }
                  >
                    <option value="error">Error</option>
                    <option value="warn">Warn</option>
                    <option value="info">Info</option>
                    <option value="debug">Debug</option>
                    <option value="trace">Trace</option>
                  </select>
                </SettingRow>

                <SettingToggle
                  label="Check for updates"
                  checked={local.general.check_updates}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      general: { ...local.general, check_updates: v },
                    })
                  }
                />

                <SettingToggle
                  label="HTTP request logging"
                  description="Log all S3 HTTP requests (verbose, for debugging)"
                  checked={local.general.http_log_enabled}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      general: { ...local.general, http_log_enabled: v },
                    })
                  }
                />
              </Tabs.Content>

              {/* Transfers */}
              <Tabs.Content value="transfers" className="space-y-6">
                <SettingRow label={t("settings.maxConcurrent")}>
                  <input
                    type="number"
                    className="number-field w-24 text-center"
                    min={1}
                    max={16}
                    value={local.transfer.max_concurrent_transfers}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        transfer: {
                          ...local.transfer,
                          max_concurrent_transfers: Number(e.target.value),
                        },
                      })
                    }
                  />
                </SettingRow>

                <SettingRow label={t("settings.maxParts")}>
                  <input
                    type="number"
                    className="number-field w-24 text-center"
                    min={1}
                    max={16}
                    value={local.transfer.max_concurrent_parts}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        transfer: {
                          ...local.transfer,
                          max_concurrent_parts: Number(e.target.value),
                        },
                      })
                    }
                  />
                </SettingRow>

                <SettingRow label={t("settings.multipartThreshold")}>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="number-field w-24 text-center"
                      min={5}
                      max={5120}
                      value={local.transfer.multipart_threshold_mb}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          transfer: {
                            ...local.transfer,
                            multipart_threshold_mb: Number(e.target.value),
                          },
                        })
                      }
                    />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">MB</span>
                  </div>
                </SettingRow>

                <SettingRow label={t("settings.partSize")}>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="number-field w-24 text-center"
                      min={5}
                      max={5120}
                      value={local.transfer.part_size_mb}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          transfer: {
                            ...local.transfer,
                            part_size_mb: Number(e.target.value),
                          },
                        })
                      }
                    />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">MB</span>
                  </div>
                </SettingRow>

                <SettingRow label={t("settings.maxBandwidth")}>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="number-field w-24 text-center"
                      min={0}
                      placeholder="0"
                      value={local.transfer.max_bandwidth_mbps ?? ""}
                      onChange={(e) =>
                        setLocal({
                          ...local,
                          transfer: {
                            ...local.transfer,
                            max_bandwidth_mbps: e.target.value
                              ? Number(e.target.value)
                              : null,
                          },
                        })
                      }
                    />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">MB/s</span>
                  </div>
                </SettingRow>

                <SettingToggle
                  label={t("settings.verifyChecksum")}
                  description="Verify file integrity after transfer using checksum"
                  checked={local.transfer.verify_checksum}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      transfer: { ...local.transfer, verify_checksum: v },
                    })
                  }
                />
              </Tabs.Content>

              {/* Appearance */}
              <Tabs.Content value="appearance" className="space-y-6">
                <SettingRow label={t("settings.theme")}>
                  <div className="flex gap-1">
                    {(["system", "light", "dark"] as const).map((theme) => (
                      <button
                        key={theme}
                        className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                          local.ui.theme === theme
                            ? "bg-brand-600 text-white border-brand-600"
                            : "border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                        onClick={() =>
                          setLocal({
                            ...local,
                            ui: { ...local.ui, theme },
                          })
                        }
                      >
                        {t(`settings.theme${theme.charAt(0).toUpperCase() + theme.slice(1)}`)}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingToggle
                  label={t("settings.confirmDelete")}
                  description="Show confirmation dialog before deleting objects"
                  checked={local.ui.confirm_delete}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      ui: { ...local.ui, confirm_delete: v },
                    })
                  }
                />

                <SettingToggle
                  label="Show transfer panel"
                  checked={local.ui.show_transfer_panel}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      ui: { ...local.ui, show_transfer_panel: v },
                    })
                  }
                />
              </Tabs.Content>
            </div>
          </Tabs.Root>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
            <Dialog.Close asChild>
              <button className="px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800">
                {t("common.cancel")}
              </button>
            </Dialog.Close>
            <button
              className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              {t("common.save")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TabTrigger({
  value,
  icon,
  label,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Tabs.Trigger
      value={value}
      className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-zinc-500 border-b-2 border-transparent data-[state=active]:text-brand-600 data-[state=active]:border-brand-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
    >
      {icon}
      {label}
    </Tabs.Trigger>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0">
        {label}
      </span>
      {children}
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{label}</p>
        {description && (
          <p className="text-xs text-zinc-400 mt-0.5">{description}</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        className={`relative w-11 h-6 rounded-full shrink-0 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900 ${
          checked
            ? "bg-brand-600"
            : "bg-zinc-300 dark:bg-zinc-600"
        }`}
        onClick={() => onChange(!checked)}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function applyTheme(theme: "light" | "dark" | "system") {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    // System: follow OS preference
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }
}
