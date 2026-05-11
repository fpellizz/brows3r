import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Download,
} from "lucide-react";
import { useConnectionStore } from "@/stores/connectionStore";
import { tauriInvoke } from "@/lib/tauri";

interface ImportedConnection {
  name: string;
  endpoint: string | null;
  region: string | null;
  access_key_id: string | null;
  secret_access_key: string | null;
  session_token: string | null;
  path_style: boolean | null;
  source: string;
}

type ImportSource = "aws" | "rclone" | "s3cmd" | "minio";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SOURCE_INFO: Record<
  ImportSource,
  { label: string; configPath: string }
> = {
  aws: { label: "import.aws", configPath: "~/.aws/credentials" },
  rclone: { label: "import.rclone", configPath: "~/.config/rclone/rclone.conf" },
  s3cmd: { label: "import.s3cmd", configPath: "~/.s3cfg" },
  minio: { label: "import.minio", configPath: "~/.mc/config.json" },
};

export function ImportDialog({ open, onOpenChange }: ImportDialogProps) {
  const { t } = useTranslation();
  const createConnection = useConnectionStore((s) => s.createConnection);

  const [step, setStep] = useState<"select" | "results">("select");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<ImportedConnection[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [activeSource, setActiveSource] = useState<ImportSource | null>(null);

  const resetState = () => {
    setStep("select");
    setLoading(false);
    setError(null);
    setConnections([]);
    setSelected(new Set());
    setImporting(false);
    setImportedCount(null);
    setActiveSource(null);
  };

  const handleSourceClick = async (source: ImportSource) => {
    setActiveSource(source);
    setLoading(true);
    setError(null);
    setConnections([]);
    setSelected(new Set());
    setImportedCount(null);

    try {
      const result = await tauriInvoke<ImportedConnection[]>(
        "import_connections",
        { source, filePath: null },
      );
      setConnections(result);
      // Select all by default
      setSelected(new Set(result.map((_, i) => i)));
      setStep("results");
    } catch (e) {
      setError(String(e));
      setStep("results");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === connections.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(connections.map((_, i) => i)));
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    let count = 0;

    for (const index of selected) {
      const conn = connections[index];
      try {
        const payload: Record<string, unknown> = {
          name: conn.name,
          endpoint: conn.endpoint || "https://s3.amazonaws.com",
          region: conn.region || "us-east-1",
          access_key_id: conn.access_key_id || "",
          secret_access_key: conn.secret_access_key || "",
        };

        if (conn.session_token) {
          payload.session_token = conn.session_token;
        }

        if (conn.path_style === true) {
          payload.path_style = "path";
        } else if (conn.path_style === false) {
          payload.path_style = "virtual";
        }

        await createConnection(payload);
        count++;
      } catch (e) {
        console.error(`Failed to import "${conn.name}":`, e);
      }
    }

    setImportedCount(count);
    setImporting(false);

    // Close dialog after short delay on success
    if (count > 0) {
      setTimeout(() => {
        onOpenChange(false);
        resetState();
      }, 1500);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetState();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white dark:bg-zinc-900 rounded-lg shadow-xl z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 bg-white dark:bg-zinc-900 z-10">
            <div className="flex items-center gap-2">
              {step === "results" && (
                <button
                  className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => {
                    setStep("select");
                    setError(null);
                    setConnections([]);
                    setImportedCount(null);
                  }}
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <Dialog.Title className="text-lg font-semibold">
                {t("import.title")}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-6 py-4">
            {step === "select" && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-500 mb-4">
                  {t("import.selectSource")}
                </p>
                {(Object.keys(SOURCE_INFO) as ImportSource[]).map((source) => (
                  <button
                    key={source}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    onClick={() => handleSourceClick(source)}
                    disabled={loading}
                  >
                    <div className="flex items-center gap-3">
                      <Download size={16} className="text-brand-500" />
                      <div className="text-left">
                        <div className="font-medium">
                          {t(SOURCE_INFO[source].label)}
                        </div>
                        <div className="text-xs text-zinc-400">
                          {SOURCE_INFO[source].configPath}
                        </div>
                      </div>
                    </div>
                    {loading && activeSource === source && (
                      <Loader2 size={16} className="animate-spin text-zinc-400" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {step === "results" && (
              <div className="space-y-4">
                {/* Loading state */}
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={24} className="animate-spin text-zinc-400" />
                  </div>
                )}

                {/* Error state */}
                {error && !loading && (
                  <div className="flex items-start gap-2 p-3 rounded-md text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span className="break-all">{t("import.error")}: {error}</span>
                  </div>
                )}

                {/* Success message after import */}
                {importedCount !== null && (
                  <div className="flex items-start gap-2 p-3 rounded-md text-sm bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400">
                    <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                    <span>
                      {t("import.imported", { count: importedCount })}
                    </span>
                  </div>
                )}

                {/* No connections found */}
                {!loading && !error && connections.length === 0 && importedCount === null && (
                  <p className="text-sm text-zinc-400 text-center py-8">
                    {t("import.noConnections")}
                  </p>
                )}

                {/* Connection list */}
                {connections.length > 0 && importedCount === null && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-500">
                        {t("import.found", { count: connections.length })}
                      </span>
                      <button
                        className="text-xs text-brand-500 hover:text-brand-600"
                        onClick={toggleAll}
                      >
                        {selected.size === connections.length
                          ? t("import.deselectAll")
                          : t("import.selectAll")}
                      </button>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {connections.map((conn, i) => (
                        <label
                          key={i}
                          className="flex items-start gap-3 px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="mt-1 accent-brand-600"
                            checked={selected.has(i)}
                            onChange={() => toggleSelection(i)}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              {conn.name}
                            </div>
                            <div className="text-xs text-zinc-400 space-y-0.5">
                              {conn.endpoint && (
                                <div className="truncate">
                                  {conn.endpoint}
                                </div>
                              )}
                              {conn.region && <div>Region: {conn.region}</div>}
                              {conn.access_key_id && (
                                <div className="font-mono">
                                  {conn.access_key_id.slice(0, 8)}...
                                </div>
                              )}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* Import button */}
                    <div className="flex justify-end pt-2 border-t border-zinc-200 dark:border-zinc-800">
                      <button
                        className="flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50"
                        onClick={handleImport}
                        disabled={selected.size === 0 || importing}
                      >
                        {importing && (
                          <Loader2 size={14} className="animate-spin" />
                        )}
                        {t("import.importSelected")} ({selected.size})
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
