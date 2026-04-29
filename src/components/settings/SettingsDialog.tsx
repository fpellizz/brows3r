import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X, Globe, Palette, ArrowUpDown, Minus, Plus, Trash2, Clock, Filter, FileText, FolderOpen } from "lucide-react";
import type { BandwidthSchedule } from "@/stores/settingsStore";
import { useSettingsStore, type AppSettings } from "@/stores/settingsStore";
import { applyTheme } from "@/lib/theme";
import { tauriInvoke } from "@/lib/tauri";
import i18n from "@/lib/i18n";

interface LogDirInfo {
  path: string | null;
  exists: boolean;
  file_count: number;
  total_size_bytes: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logDirInfo, setLogDirInfo] = useState<LogDirInfo | null>(null);

  useEffect(() => {
    if (open && settings) {
      setLocal(structuredClone(settings));
      setSaveError(null);
      tauriInvoke<LogDirInfo>("get_log_dir_info")
        .then(setLogDirInfo)
        .catch(() => setLogDirInfo(null));
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
    setSaveError(null);
    try {
      await updateSettings(local);

      // Apply language change immediately
      if (local.general.language !== i18n.language) {
        i18n.changeLanguage(local.general.language);
      }

      // Apply theme change immediately
      applyTheme(local.ui.theme);

      onOpenChange(false);
    } catch (e) {
      // Show backend validation errors inline (e.g. invalid glob patterns)
      // so the user can fix them without losing their edits.
      setSaveError(String(e));
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
              <TabTrigger value="logs" icon={<FileText size={14} />} label={t("settings.logs")} />
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
              <Tabs.Content value="transfers" className="space-y-5">
                <NumberSetting
                  label={t("settings.maxConcurrent")}
                  value={local.transfer.max_concurrent_transfers}
                  min={1}
                  max={16}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      transfer: { ...local.transfer, max_concurrent_transfers: v },
                    })
                  }
                />

                <NumberSetting
                  label={t("settings.maxParts")}
                  value={local.transfer.max_concurrent_parts}
                  min={1}
                  max={16}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      transfer: { ...local.transfer, max_concurrent_parts: v },
                    })
                  }
                />

                <NumberSetting
                  label={t("settings.multipartThreshold")}
                  value={local.transfer.multipart_threshold_mb}
                  min={5}
                  max={5120}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      transfer: { ...local.transfer, multipart_threshold_mb: v },
                    })
                  }
                />

                <NumberSetting
                  label={t("settings.partSize")}
                  value={local.transfer.part_size_mb}
                  min={5}
                  max={5120}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      transfer: { ...local.transfer, part_size_mb: v },
                    })
                  }
                />

                <NumberSetting
                  label={t("settings.maxBandwidth")}
                  value={local.transfer.max_bandwidth_mbps ?? 0}
                  min={0}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      transfer: {
                        ...local.transfer,
                        max_bandwidth_mbps: v || null,
                      },
                    })
                  }
                />

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

                {/* Bandwidth schedules */}
                <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <Clock size={14} className="text-zinc-400" />
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {t("settings.bandwidthSchedules")}
                      </span>
                    </div>
                    <button
                      className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600"
                      onClick={() => {
                        const schedule: BandwidthSchedule = {
                          name: `Schedule ${(local.transfer.bandwidth_schedules?.length ?? 0) + 1}`,
                          start_time: "09:00",
                          end_time: "18:00",
                          days: [0, 1, 2, 3, 4],
                          max_bandwidth_mbps: 10,
                        };
                        setLocal({
                          ...local,
                          transfer: {
                            ...local.transfer,
                            bandwidth_schedules: [
                              ...(local.transfer.bandwidth_schedules ?? []),
                              schedule,
                            ],
                          },
                        });
                      }}
                    >
                      <Plus size={12} />
                      Add
                    </button>
                  </div>

                  {(!local.transfer.bandwidth_schedules ||
                    local.transfer.bandwidth_schedules.length === 0) && (
                    <p className="text-xs text-zinc-400 italic">
                      {t("settings.noSchedules")}
                    </p>
                  )}

                  <div className="space-y-3">
                    {local.transfer.bandwidth_schedules?.map((sched, idx) => (
                      <ScheduleRow
                        key={idx}
                        schedule={sched}
                        onChange={(updated) => {
                          const schedules = [...(local.transfer.bandwidth_schedules ?? [])];
                          schedules[idx] = updated;
                          setLocal({
                            ...local,
                            transfer: { ...local.transfer, bandwidth_schedules: schedules },
                          });
                        }}
                        onRemove={() => {
                          const schedules = (local.transfer.bandwidth_schedules ?? []).filter(
                            (_, i) => i !== idx,
                          );
                          setLocal({
                            ...local,
                            transfer: { ...local.transfer, bandwidth_schedules: schedules },
                          });
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Upload exclude patterns */}
                <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <Filter size={14} className="text-zinc-400" />
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {t("settings.uploadExcludePatterns")}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-600"
                      onClick={() => {
                        setLocal({
                          ...local,
                          transfer: {
                            ...local.transfer,
                            upload_exclude_patterns: [
                              ...(local.transfer.upload_exclude_patterns ?? []),
                              "",
                            ],
                          },
                        });
                      }}
                    >
                      <Plus size={12} />
                      Add
                    </button>
                  </div>

                  <p className="text-xs text-zinc-400 mb-2">
                    {t("settings.uploadExcludePatternsHint")}
                  </p>

                  {(!local.transfer.upload_exclude_patterns ||
                    local.transfer.upload_exclude_patterns.length === 0) && (
                    <p className="text-xs text-zinc-400 italic">
                      {t("settings.noExcludePatterns")}
                    </p>
                  )}

                  <div className="space-y-2">
                    {local.transfer.upload_exclude_patterns?.map((pattern, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={pattern}
                          placeholder="*.tmp"
                          className="flex-1 px-2 py-1 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                          onChange={(e) => {
                            const patterns = [
                              ...(local.transfer.upload_exclude_patterns ?? []),
                            ];
                            patterns[idx] = e.target.value;
                            setLocal({
                              ...local,
                              transfer: {
                                ...local.transfer,
                                upload_exclude_patterns: patterns,
                              },
                            });
                          }}
                        />
                        <button
                          type="button"
                          className="p-1 text-zinc-400 hover:text-red-500"
                          onClick={() => {
                            const patterns = (
                              local.transfer.upload_exclude_patterns ?? []
                            ).filter((_, i) => i !== idx);
                            setLocal({
                              ...local,
                              transfer: {
                                ...local.transfer,
                                upload_exclude_patterns: patterns,
                              },
                            });
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
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

              {/* Logs */}
              <Tabs.Content value="logs" className="space-y-6">
                <SettingToggle
                  label={t("settings.fileLogEnabled")}
                  description={t("settings.fileLogEnabledDesc")}
                  checked={local.general.file_log_enabled}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      general: { ...local.general, file_log_enabled: v },
                    })
                  }
                />

                <SettingRow
                  label={t("settings.logDirectory")}
                  description={t("settings.logDirectoryDesc")}
                >
                  <input
                    type="text"
                    className="input-field w-72 font-mono text-xs"
                    placeholder={logDirInfo?.path ?? "default"}
                    value={local.general.log_directory ?? ""}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        general: {
                          ...local.general,
                          log_directory: e.target.value || null,
                        },
                      })
                    }
                  />
                </SettingRow>

                <NumberSetting
                  label={t("settings.logRetentionDays")}
                  value={local.general.log_retention_days}
                  min={0}
                  max={365}
                  suffix={t("settings.days")}
                  onChange={(v) =>
                    setLocal({
                      ...local,
                      general: { ...local.general, log_retention_days: v },
                    })
                  }
                />

                {logDirInfo && logDirInfo.path && (
                  <div className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-zinc-500">{t("settings.activeLogPath")}</span>
                      <span className="font-mono text-zinc-700 dark:text-zinc-300 truncate" title={logDirInfo.path}>
                        {logDirInfo.path}
                      </span>
                    </div>
                    {logDirInfo.exists && (
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">{t("settings.logSizeOnDisk")}</span>
                        <span className="font-mono text-zinc-700 dark:text-zinc-300">
                          {logDirInfo.file_count} {t("settings.files")} · {formatBytes(logDirInfo.total_size_bytes)}
                        </span>
                      </div>
                    )}
                    {logDirInfo.exists && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (!logDirInfo.path) return;
                            tauriInvoke("open_path", { path: logDirInfo.path }).catch((e) =>
                              console.error("open_path failed:", e),
                            );
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <FolderOpen size={12} />
                          {t("settings.openLogFolder")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </Tabs.Content>
            </div>
          </Tabs.Root>

          {/* Footer */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
            <div className="min-w-0 flex-1">
              {saveError && (
                <p className="text-xs text-red-600 dark:text-red-400 break-words">
                  {saveError}
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="px-4 py-2 text-sm border border-zinc-300 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  {t("common.cancel")}
                </button>
              </Dialog.Close>
              <button
                type="button"
                className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
                onClick={handleSave}
                disabled={saving}
              >
                {t("common.save")}
              </button>
            </div>
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
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0">
          {label}
        </p>
        {description && (
          <p className="text-xs text-zinc-400 mt-0.5">{description}</p>
        )}
      </div>
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

function NumberSetting({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const decrement = () => {
    const next = value - 1;
    if (min !== undefined && next < min) return;
    onChange(next);
  };
  const increment = () => {
    const next = value + 1;
    if (max !== undefined && next > max) return;
    onChange(next);
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center border border-zinc-300 dark:border-zinc-600 rounded-md overflow-hidden">
          <button
            className="px-2 py-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={decrement}
            tabIndex={-1}
          >
            <Minus size={12} />
          </button>
          <input
            type="number"
            className="w-14 text-center text-sm bg-transparent outline-none border-x border-zinc-300 dark:border-zinc-600 py-1.5 number-field-inline"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <button
            className="px-2 py-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={increment}
            tabIndex={-1}
          >
            <Plus size={12} />
          </button>
        </div>
        {suffix && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400 w-8">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ScheduleRow({
  schedule,
  onChange,
  onRemove,
}: {
  schedule: BandwidthSchedule;
  onChange: (s: BandwidthSchedule) => void;
  onRemove: () => void;
}) {
  const toggleDay = (day: number) => {
    const days = schedule.days.includes(day)
      ? schedule.days.filter((d) => d !== day)
      : [...schedule.days, day].sort();
    onChange({ ...schedule, days });
  };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
      {/* Name + delete */}
      <div className="flex items-center gap-2">
        <input
          className="input-field flex-1 !py-1 text-xs"
          value={schedule.name}
          onChange={(e) => onChange({ ...schedule, name: e.target.value })}
          placeholder="Schedule name"
        />
        <button
          className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Time range + bandwidth */}
      <div className="flex items-center gap-2 text-xs">
        <input
          type="time"
          className="input-field !py-1 !px-2 !text-xs w-24"
          value={schedule.start_time}
          onChange={(e) => onChange({ ...schedule, start_time: e.target.value })}
        />
        <span className="text-zinc-400">-</span>
        <input
          type="time"
          className="input-field !py-1 !px-2 !text-xs w-24"
          value={schedule.end_time}
          onChange={(e) => onChange({ ...schedule, end_time: e.target.value })}
        />
        <input
          type="number"
          className="number-field !py-1 !px-2 !text-xs w-16 text-center"
          min={1}
          value={schedule.max_bandwidth_mbps}
          onChange={(e) =>
            onChange({ ...schedule, max_bandwidth_mbps: Number(e.target.value) })
          }
        />
        <span className="text-zinc-400">MB/s</span>
      </div>

      {/* Day toggles */}
      <div className="flex gap-1">
        {DAY_LABELS.map((label, idx) => (
          <button
            key={idx}
            className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
              schedule.days.includes(idx)
                ? "bg-brand-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
            onClick={() => toggleDay(idx)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

