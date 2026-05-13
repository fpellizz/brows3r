import { useEffect } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";

import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { Breadcrumb } from "./Breadcrumb";
import { ObjectTable } from "@/components/object/ObjectTable";
import { ObjectDetails } from "@/components/object/ObjectDetails";
import { TransferPanel } from "@/components/transfer/TransferPanel";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { UpdateBanner } from "@/components/common/UpdateBanner";
import { useUiStore } from "@/stores/uiStore";
import { useObjectStore } from "@/stores/objectStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUpdaterStore } from "@/stores/updaterStore";

export function AppShell() {
  // Updater bootstrap: detect install kind and run a silent check ~1.5s
  // after first paint. Silent means we only surface "available" — no
  // toast for "up to date" or transient network failures.
  const initUpdater = useUpdaterStore((s) => s.init);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  useEffect(() => {
    void initUpdater();
    const t = window.setTimeout(() => void checkForUpdates(true), 1500);
    return () => window.clearTimeout(t);
  }, [initUpdater, checkForUpdates]);

  const showTransferPanel = useUiStore((s) => s.showTransferPanel);
  const showTerminalPanel = useUiStore((s) => s.showTerminalPanel);
  const activeTab = useUiStore((s) =>
    s.tabs.find((t) => t.id === s.activeTabId),
  );
  const previewObject = useUiStore((s) => s.previewObject);
  const detailsObject = useUiStore((s) => s.detailsObject);
  const closePreview = useUiStore((s) => s.closePreview);
  const closeDetails = useUiStore((s) => s.closeDetails);
  const currentBucket = useObjectStore((s) => s.currentBucket);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  const isDashboard = activeTab?.kind === "dashboard";

  return (
    <div className="flex flex-col h-screen">
      {/* Update banner (only renders when an update is available) */}
      <UpdateBanner />

      {/* Toolbar */}
      <Toolbar />

      {/* Main content area */}
      <div className="flex-1 min-h-0">
        <Allotment>
          {/* Sidebar */}
          <Allotment.Pane preferredSize={260} minSize={180} maxSize={400}>
            <Sidebar />
          </Allotment.Pane>

          {/* Center content */}
          <Allotment.Pane>
            <Allotment vertical>
              {/* Object browser + right panel */}
              <Allotment.Pane>
                <Allotment>
                  {/* Object table or Dashboard */}
                  <Allotment.Pane>
                    <div className="flex flex-col h-full">
                      <TabBar />
                      {isDashboard ? (
                        <div className="flex-1 min-h-0">
                          <Dashboard />
                        </div>
                      ) : (
                        <>
                          <Breadcrumb />
                          <div className="flex-1 min-h-0">
                            <ObjectTable />
                          </div>
                        </>
                      )}
                    </div>
                  </Allotment.Pane>

                  {/* Preview panel */}
                  {!isDashboard && previewObject && activeConnectionId && currentBucket && (
                    <Allotment.Pane preferredSize={380} minSize={250} maxSize={600}>
                      <PreviewPanel
                        connectionId={activeConnectionId}
                        bucket={currentBucket}
                        objectKey={previewObject.key}
                        displayName={previewObject.displayName}
                        onClose={closePreview}
                      />
                    </Allotment.Pane>
                  )}

                  {/* Details panel */}
                  {!isDashboard && detailsObject && activeConnectionId && currentBucket && (
                    <Allotment.Pane preferredSize={320} minSize={220} maxSize={500}>
                      <ObjectDetails
                        connectionId={activeConnectionId}
                        bucket={currentBucket}
                        objectKey={detailsObject.key}
                        displayName={detailsObject.displayName}
                        isFolder={detailsObject.isFolder}
                        onClose={closeDetails}
                      />
                    </Allotment.Pane>
                  )}
                </Allotment>
              </Allotment.Pane>

              {/* Transfer panel */}
              {showTransferPanel && (
                <Allotment.Pane preferredSize={200} minSize={100}>
                  <TransferPanel />
                </Allotment.Pane>
              )}

              {/* S3 terminal */}
              {showTerminalPanel && (
                <Allotment.Pane preferredSize={220} minSize={120}>
                  <TerminalPanel />
                </Allotment.Pane>
              )}
            </Allotment>
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}
