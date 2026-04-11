import { Allotment } from "allotment";
import "allotment/dist/style.css";

import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { StatusBar } from "./StatusBar";
import { Breadcrumb } from "./Breadcrumb";
import { ObjectTable } from "@/components/object/ObjectTable";
import { TransferPanel } from "@/components/transfer/TransferPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { useUiStore } from "@/stores/uiStore";
import { useObjectStore } from "@/stores/objectStore";
import { useConnectionStore } from "@/stores/connectionStore";

export function AppShell() {
  const showTransferPanel = useUiStore((s) => s.showTransferPanel);
  const previewObject = useUiStore((s) => s.previewObject);
  const closePreview = useUiStore((s) => s.closePreview);
  const currentBucket = useObjectStore((s) => s.currentBucket);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  return (
    <div className="flex flex-col h-screen">
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
              {/* Object browser + preview */}
              <Allotment.Pane>
                <Allotment>
                  {/* Object table */}
                  <Allotment.Pane>
                    <div className="flex flex-col h-full">
                      <Breadcrumb />
                      <div className="flex-1 min-h-0">
                        <ObjectTable />
                      </div>
                    </div>
                  </Allotment.Pane>

                  {/* Preview panel */}
                  {previewObject && activeConnectionId && currentBucket && (
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
                </Allotment>
              </Allotment.Pane>

              {/* Transfer panel */}
              {showTransferPanel && (
                <Allotment.Pane preferredSize={200} minSize={100}>
                  <TransferPanel />
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
