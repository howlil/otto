import { invoke } from "@tauri-apps/api/core";

export async function getOverlayProtectionStatus(): Promise<boolean> {
  return invoke<boolean>("overlay_protection_status");
}

export async function setOverlayCaptureProtection(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("overlay_set_capture_protection", { enabled });
}
