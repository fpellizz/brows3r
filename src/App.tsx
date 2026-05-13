import { AppShell } from "@/components/layout/AppShell";
import { RecoveryDialog } from "@/components/transfer/RecoveryDialog";
import { tauriListen } from "@/lib/tauri";
import { applyTheme } from "@/lib/theme";
import { useConnectionStore } from "@/stores/connectionStore";
import { useObjectStore } from "@/stores/objectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTransferStore } from "@/stores/transferStore";
import { useEffect } from "react";

export function App() {
  const fetchConnections = useConnectionStore((s) => s.fetchConnections);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const startListening = useTransferStore((s) => s.startListening);
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    fetchConnections();
    fetchSettings();
    startListening();
  }, [fetchConnections, fetchSettings, startListening]);

  // Auto-refresh the object list when an upload completes so new files
  // appear without a manual Refresh click.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    tauriListen<{ id: string; success: boolean }>(
      "transfer:complete",
      (payload) => {
        if (payload.success) {
          const connId = useConnectionStore.getState().activeConnectionId;
          if (connId) {
            useObjectStore.getState().fetchObjects(connId);
          }
        }
      },
    ).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Apply theme whenever settings load or change
  useEffect(() => {
    if (settings) {
      applyTheme(settings.ui.theme);
    } else {
      // Before settings load, follow system preference
      applyTheme("system");
    }
  }, [settings]);

  return (
    <>
      <AppShell />
      <RecoveryDialog />
    </>
  );
}
