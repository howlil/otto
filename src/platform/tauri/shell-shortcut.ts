import { invoke } from "@tauri-apps/api/core";
import { nativeAvailable } from "./runtime";

export async function shellShortcut(shortcut?: string): Promise<string> {
  return invoke("shell_shortcut", { shortcut: shortcut ?? null });
}

export async function onShellToggle(toggle: () => void): Promise<() => void> {
  if (!nativeAvailable) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("otto-toggle-expanded", toggle);
}
