import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

interface DropZoneState {
  isDragging: boolean;
  droppedPaths: string[] | null;
}

/**
 * Hook that listens to Tauri's native drag-drop events on the webview.
 * Returns dragging state and dropped file paths.
 *
 * `onDrop` is called when files are dropped — the caller is responsible
 * for uploading them.
 */
export function useDropZone(onDrop?: (paths: string[]) => void) {
  const [state, setState] = useState<DropZoneState>({
    isDragging: false,
    droppedPaths: null,
  });

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { type } = event.payload;

        if (type === "enter" || type === "over") {
          setState((prev) =>
            prev.isDragging ? prev : { ...prev, isDragging: true },
          );
        } else if (type === "leave") {
          setState({ isDragging: false, droppedPaths: null });
        } else if (type === "drop") {
          const paths = event.payload.paths;
          setState({ isDragging: false, droppedPaths: paths });
          if (paths.length > 0 && onDrop) {
            onDrop(paths);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [onDrop]);

  return state;
}
