import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";

// Re-export for convenience
export { invoke, listen };
export type { UnlistenFn };

/**
 * Type-safe invoke wrapper. The generic types will be provided
 * once we generate TypeScript bindings from Rust via specta.
 */
export async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(cmd, args);
}

/**
 * Listen to a Tauri event with type safety.
 */
export function tauriListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  return listen<T>(event, (e) => handler(e.payload));
}
