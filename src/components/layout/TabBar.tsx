import { useCallback } from "react";
import { Plus, X } from "lucide-react";
import { useUiStore, type Tab } from "@/stores/uiStore";
import { useObjectStore } from "@/stores/objectStore";

export function TabBar() {
  const tabs = useUiStore((s) => s.tabs);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const addTab = useUiStore((s) => s.addTab);
  const closeTab = useUiStore((s) => s.closeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const cleanupTab = useObjectStore((s) => s.cleanupTab);

  const handleSetActive = useCallback(
    (id: string) => {
      setActiveTab(id);
    },
    [setActiveTab],
  );

  const handleClose = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      cleanupTab(id);
      closeTab(id);
    },
    [closeTab, cleanupTab],
  );

  const handleMiddleClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        cleanupTab(id);
        closeTab(id);
      }
    },
    [closeTab, cleanupTab],
  );

  const handleAddTab = useCallback(() => {
    addTab();
  }, [addTab]);

  return (
    <div className="flex items-center border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0 overflow-x-auto">
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClick={() => handleSetActive(tab.id)}
          onClose={(e) => handleClose(tab.id, e)}
          onMouseDown={(e) => handleMiddleClick(tab.id, e)}
        />
      ))}

      {/* Add tab button */}
      <button
        className="flex items-center justify-center w-7 h-7 mx-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 shrink-0"
        onClick={handleAddTab}
        title="New tab"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function TabItem({
  tab,
  isActive,
  onClick,
  onClose,
  onMouseDown,
}: {
  tab: Tab;
  isActive: boolean;
  onClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-zinc-200 dark:border-zinc-800 select-none max-w-[180px] min-w-[80px] shrink-0 ${
        isActive
          ? "bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 border-b-2 border-b-brand-500"
          : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-b-2 border-b-transparent"
      }`}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      <span className="truncate flex-1">{tab.label}</span>
      <button
        className={`shrink-0 rounded p-0.5 ${
          isActive
            ? "hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            : "opacity-0 group-hover:opacity-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        }`}
        onClick={onClose}
        title="Close tab"
      >
        <X size={12} />
      </button>
    </div>
  );
}
