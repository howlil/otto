import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { nativeAvailable } from "../tauri";

export { nativeAvailable };
export function shellShortcut(shortcut?: string): Promise<string> {
  return invoke("shell_shortcut", { shortcut: shortcut ?? null });
}
export async function onShellToggle(toggle: () => void): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  return listen("otto-toggle-expanded", toggle);
}
