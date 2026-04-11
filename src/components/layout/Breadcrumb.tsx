import { ChevronRight } from "lucide-react";
import { useObjectStore } from "@/stores/objectStore";
import { useConnectionStore } from "@/stores/connectionStore";

export function Breadcrumb() {
  const currentBucket = useObjectStore((s) => s.currentBucket);
  const currentPrefix = useObjectStore((s) => s.currentPrefix);
  const navigateToPrefix = useObjectStore((s) => s.navigateToPrefix);
  const fetchObjects = useObjectStore((s) => s.fetchObjects);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  if (!currentBucket) {
    return (
      <div className="px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 text-sm text-zinc-400">
        Select a bucket to browse
      </div>
    );
  }

  const parts = currentPrefix
    .split("/")
    .filter((p) => p.length > 0);

  const navigateTo = (index: number) => {
    if (!activeConnectionId) return;
    const prefix =
      index < 0 ? "" : `${parts.slice(0, index + 1).join("/")}/`;
    navigateToPrefix(prefix);
    fetchObjects(activeConnectionId);
  };

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 text-sm overflow-x-auto">
      <button
        className="text-brand-600 dark:text-brand-400 hover:underline shrink-0 font-medium"
        onClick={() => navigateTo(-1)}
      >
        {currentBucket}
      </button>

      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-0.5 shrink-0">
          <ChevronRight size={14} className="text-zinc-400" />
          <button
            className={`hover:underline ${
              i === parts.length - 1
                ? "text-zinc-900 dark:text-zinc-100 font-medium"
                : "text-brand-600 dark:text-brand-400"
            }`}
            onClick={() => navigateTo(i)}
          >
            {part}
          </button>
        </span>
      ))}
    </div>
  );
}
