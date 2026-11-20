import { invoke } from "@tauri-apps/api/core";
import { nativeAvailable } from "./runtime";

export type CaptureSource = "selectedText" | "region" | "window" | "scrollingWindow" | "fullScreen";
export type CapturePhase =
  | "idle"
  | "preparing"
  | "capturing"
  | "submitting"
  | "analyzing"
  | "failed";

export type StagedCaptureKind = "image" | "selectedText";

export type StagedCapture = {
  id: number;
  kind: StagedCaptureKind;
  source: string;
  label: string;
  preview: string;
};

export type AgentCapture = {
  requestId: number;
  phase: CapturePhase;
  error: string | null;
  staged?: StagedCapture | null;
};

export async function configureCaptureShortcut(shortcut: string): Promise<void> {
  await invoke("agent_configure_capture_shortcut", { shortcut });
}

export async function configureCaptureSource(source: CaptureSource): Promise<void> {
  await invoke("agent_configure_capture_source", { source });
}

export async function captureAgentNow(): Promise<void> {
  if (!nativeAvailable) throw new Error("Screen capture requires Otto on Windows.");
  await invoke("agent_capture_now");
}

export async function insertAgentText(text: string): Promise<void> {
  if (!nativeAvailable) throw new Error("Text insertion requires Otto on Windows.");
  await invoke("agent_insert_text", { text });
}

export async function getCaptureTargetTitle(): Promise<string> {
  return invoke<string>("agent_capture_target_title");
}
