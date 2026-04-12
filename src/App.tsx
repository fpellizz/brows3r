import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTransferStore } from "@/stores/transferStore";
import { applyTheme } from "@/lib/theme";

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

  // Apply theme whenever settings load or change
  useEffect(() => {
    if (settings) {
      applyTheme(settings.ui.theme);
    } else {
      // Before settings load, follow system preference
      applyTheme("system");
    }
  }, [settings]);

  return <AppShell />;
}
