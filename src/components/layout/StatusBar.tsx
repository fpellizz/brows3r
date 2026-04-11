import { useConnectionStore } from "@/stores/connectionStore";
import { useObjectStore } from "@/stores/objectStore";
import { useTransferStore } from "@/stores/transferStore";

export function StatusBar() {
  const connections = useConnectionStore((s) => s.connections);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const objects = useObjectStore((s) => s.objects);
  const selectedKeys = useObjectStore((s) => s.selectedKeys);
  const transfers = useTransferStore((s) => s.transfers);

  const activeTransfers = transfers.filter(
    (t) => t.status === "inprogress" || t.status === "queued",
  ).length;

  const activeConn = connections.find((c) => c.id === activeConnectionId);

  return (
    <div className="flex items-center justify-between px-3 py-1 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs text-zinc-500">
      <div className="flex items-center gap-4">
        {activeConn && (
          <span>
            {activeConn.name} ({activeConn.endpoint})
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {objects.length > 0 && <span>{objects.length} objects</span>}
        {selectedKeys.size > 0 && <span>{selectedKeys.size} selected</span>}
        {activeTransfers > 0 && <span>{activeTransfers} transfers active</span>}
      </div>
    </div>
  );
}
