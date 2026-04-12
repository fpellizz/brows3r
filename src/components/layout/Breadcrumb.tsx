import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { useObjectStore } from "@/stores/objectStore";
import { useConnectionStore } from "@/stores/connectionStore";

/**
 * Parse an address bar value into bucket and prefix.
 * Accepts formats:
 *   s3://bucket/prefix/path/
 *   bucket/prefix/path/
 *   bucket
 */
function parseS3Path(raw: string): { bucket: string; prefix: string } | null {
  let path = raw.trim();

  // Strip the s3:// scheme if present
  if (path.toLowerCase().startsWith("s3://")) {
    path = path.slice(5);
  }

  // Remove leading slash if any
  path = path.replace(/^\/+/, "");

  if (path.length === 0) return null;

  const slashIndex = path.indexOf("/");
  if (slashIndex === -1) {
    return { bucket: path, prefix: "" };
  }

  const bucket = path.slice(0, slashIndex);
  let prefix = path.slice(slashIndex + 1);

  // Ensure prefix ends with / if non-empty (it represents a folder path)
  if (prefix.length > 0 && !prefix.endsWith("/")) {
    prefix += "/";
  }

  return { bucket, prefix };
}

export function Breadcrumb() {
  const currentBucket = useObjectStore((s) => s.currentBucket);
  const currentPrefix = useObjectStore((s) => s.currentPrefix);
  const setCurrentBucket = useObjectStore((s) => s.setCurrentBucket);
  const navigateToPrefix = useObjectStore((s) => s.navigateToPrefix);
  const fetchObjects = useObjectStore((s) => s.fetchObjects);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Build the s3:// display path
  const displayPath = currentBucket
    ? `s3://${currentBucket}/${currentPrefix}`
    : "";

  const startEditing = useCallback(() => {
    setInputValue(displayPath);
    setEditing(true);
  }, [displayPath]);

  // Focus the input when we enter edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setInputValue("");
  }, []);

  const handleNavigate = useCallback(() => {
    if (!activeConnectionId) {
      cancelEditing();
      return;
    }

    const parsed = parseS3Path(inputValue);
    if (!parsed) {
      cancelEditing();
      return;
    }

    // Navigate: set bucket, then prefix, then fetch
    setCurrentBucket(parsed.bucket);
    navigateToPrefix(parsed.prefix);
    fetchObjects(activeConnectionId);
    setEditing(false);
  }, [
    inputValue,
    activeConnectionId,
    setCurrentBucket,
    navigateToPrefix,
    fetchObjects,
    cancelEditing,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleNavigate();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEditing();
      }
    },
    [handleNavigate, cancelEditing],
  );

  // No bucket selected — placeholder state
  if (!currentBucket && !editing) {
    return (
      <div
        className="px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 text-sm text-zinc-400 cursor-text"
        onClick={startEditing}
      >
        Select a bucket to browse
      </div>
    );
  }

  // Editing mode — show input field
  if (editing) {
    return (
      <div className="px-2 py-1 border-b border-zinc-200 dark:border-zinc-800">
        <input
          ref={inputRef}
          type="text"
          className="input-field !py-1 !text-sm font-mono"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={cancelEditing}
          placeholder="s3://bucket/prefix/"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    );
  }

  // Display mode — clickable breadcrumb segments
  const parts = currentPrefix.split("/").filter((p) => p.length > 0);

  const navigateTo = (index: number) => {
    if (!activeConnectionId) return;
    const prefix =
      index < 0 ? "" : `${parts.slice(0, index + 1).join("/")}/`;
    navigateToPrefix(prefix);
    fetchObjects(activeConnectionId);
  };

  return (
    <div
      className="flex items-center gap-0.5 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 text-sm overflow-x-auto cursor-text group"
      onClick={(e) => {
        // Only enter edit mode if the click target is the container itself
        // (not a breadcrumb button)
        if (e.target === e.currentTarget) {
          startEditing();
        }
      }}
    >
      <span className="text-zinc-400 dark:text-zinc-500 shrink-0 select-none mr-0.5 font-mono text-xs">
        s3://
      </span>
      <button
        className="text-brand-600 dark:text-brand-400 hover:underline shrink-0 font-medium"
        onClick={() => navigateTo(-1)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
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
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
          >
            {part}
          </button>
        </span>
      ))}

      {/* Clickable empty space to enter edit mode */}
      <span
        className="flex-1 min-w-[40px] h-full cursor-text"
        onClick={startEditing}
      />
    </div>
  );
}
