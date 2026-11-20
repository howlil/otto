import { invoke } from "@tauri-apps/api/core";
import type { CaptureSource, StagedCapture } from "./capture";
import { nativeAvailable } from "./runtime";

export async function configureTextCaptureShortcut(shortcut: string): Promise<void> {
  await invoke("agent_configure_text_capture_shortcut", { shortcut });
}

export async function configureCaptureAutoSend(autoSend: boolean): Promise<void> {
  if (!nativeAvailable) return;
  await invoke("agent_configure_capture_auto_send", { autoSend });
}

export async function stageAgentImage(pngBase64: string, label?: string): Promise<StagedCapture> {
  return invoke<StagedCapture>("agent_stage_image", {
    pngBase64,
    label: label ?? null,
  });
}

export async function clearStagedCapture(): Promise<void> {
  if (!nativeAvailable) return;
  await invoke("agent_clear_staged_capture");
}

export async function captureAgentSourceNow(source?: CaptureSource): Promise<void> {
  if (!nativeAvailable) throw new Error("Screen capture requires Otto on Windows.");
  await invoke("agent_capture_now", source ? { source } : {});
}
