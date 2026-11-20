import { invoke, isTauri } from "@tauri-apps/api/core";

export const nativeAvailable = isTauri();

export async function quitOtto(): Promise<void> {
  if (!nativeAvailable) throw new Error("Quitting Otto requires the desktop app.");
  await invoke("app_quit");
}
