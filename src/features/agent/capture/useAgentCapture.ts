import { useCallback } from "react";
import {
  captureAgentNow,
  insertAgentText,
  type CaptureSource,
  type StagedCapture,
} from "../../../platform/tauri/capture";
import {
  captureAgentSourceNow,
  clearStagedCapture,
  stageAgentImage,
} from "../../../platform/tauri/capture-staged";
import { readImageFileAsPngBase64 } from "./quick-actions";

export function useAgentCapture() {
  const captureNow = useCallback((source?: CaptureSource) => {
    if (source) return captureAgentSourceNow(source);
    return captureAgentNow();
  }, []);
  const insertText = useCallback((text: string) => insertAgentText(text), []);
  const stageImage = useCallback(async (file: Blob, label?: string): Promise<StagedCapture> => {
    const pngBase64 = await readImageFileAsPngBase64(file);
    return stageAgentImage(pngBase64, label);
  }, []);
  const clearStaged = useCallback(() => clearStagedCapture(), []);
  return { captureNow, insertText, stageImage, clearStaged };
}
