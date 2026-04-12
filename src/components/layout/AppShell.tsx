import { Allotment } from "allotment";
import "allotment/dist/style.css";

import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { Breadcrumb } from "./Breadcrumb";
import { ObjectTable } from "@/components/object/ObjectTable";
import { TransferPanel } from "@/components/transfer/TransferPanel";
import { useUiStore } from "@/stores/uiStore";

export function AppShell() {
  const showTransferPanel = useUiStore((s) => s.showTransferPanel);

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
              {/* Object browser */}
              <Allotment.Pane>
                <div className="flex flex-col h-full">
                  <TabBar />
                  <Breadcrumb />
                  <div className="flex-1 min-h-0">
                    <ObjectTable />
                  </div>
                </div>
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
