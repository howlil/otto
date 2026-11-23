import { invoke } from "@tauri-apps/api/core";
import { nativeAvailable } from "./runtime";

export async function getOverlayProtectionStatus(): Promise<boolean> {
  return invoke<boolean>("overlay_protection_status");
}

export async function setOverlayCaptureProtection(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("overlay_set_capture_protection", { enabled });
}

export async function setOverlayMemoryMode(low: boolean): Promise<void> {
  if (!nativeAvailable) return;
  await invoke<void>("overlay_set_memory_mode", { low });
}
