import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTransferStore } from "@/stores/transferStore";

export function App() {
  const fetchConnections = useConnectionStore((s) => s.fetchConnections);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const startListening = useTransferStore((s) => s.startListening);

  useEffect(() => {
    fetchConnections();
    fetchSettings();
    startListening();
  }, [fetchConnections, fetchSettings, startListening]);

  return <AppShell />;
}
