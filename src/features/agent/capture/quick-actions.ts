import type {
  CaptureSource,
  LearningMode,
  StagedCapture,
  StagedCaptureKind,
} from "../../../platform/tauri";

export type CaptureQuickAction = {
  id: string;
  label: string;
  mode: LearningMode;
  prompt: string;
};

export type VisualCaptureOption = {
  id: Exclude<CaptureSource, "selectedText">;
  label: string;
  description: string;
};

export const VISUAL_CAPTURE_SOURCES: VisualCaptureOption[] = [
  {
    id: "region",
    label: "Region snip",
    description: "Drag an area on screen",
  },
  {
    id: "window",
    label: "Last focused window",
    description: "Capture the active application window",
  },
  {
    id: "scrollingWindow",
    label: "Scrolling window",
    description: "Stitch a tall scrollable page",
  },
  {
    id: "fullScreen",
    label: "Full screen",
    description: "Capture the entire display",
  },
];

const TEXT_QUICK_ACTIONS: CaptureQuickAction[] = [
  {
    id: "solve",
    label: "Solve",
    mode: "solve",
    prompt:
      "Solve this problem using the most efficient approach, check edge cases and calculations, and give the verified final answer.",
  },
  {
    id: "explain",
    label: "Explain",
    mode: "mentor",
    prompt: "Explain this selected text clearly step by step.",
  },
  {
    id: "breakdown",
    label: "Break down",
    mode: "simple",
    prompt: "Break this down in simple terms with a concrete example.",
  },
  {
    id: "translate",
    label: "Translate",
    mode: "write",
    prompt: "Translate this naturally and explain key terms.",
  },
  {
    id: "summarize",
    label: "Summarize",
    mode: "direct",
    prompt: "Summarize the key points concisely.",
  },
  {
    id: "rewrite",
    label: "Rewrite",
    mode: "write",
    prompt: "Improve and polish this writing while preserving its meaning.",
  },
  {
    id: "quiz",
    label: "Quiz me",
    mode: "practice",
    prompt: "Create a short practice quiz from the concepts in this text.",
  },
];

const IMAGE_QUICK_ACTIONS: CaptureQuickAction[] = [
  {
    id: "solve",
    label: "Solve",
    mode: "solve",
    prompt:
      "Solve the problem in this image using the most efficient approach, check edge cases and calculations, and give the verified final answer.",
  },
  {
    id: "explain",
    label: "Explain",
    mode: "mentor",
    prompt: "Explain what is shown in this image clearly.",
  },
  {
    id: "breakdown",
    label: "Break down",
    mode: "simple",
    prompt: "Break down the problem or diagram in this image step by step.",
  },
  {
    id: "summarize",
    label: "Summarize",
    mode: "direct",
    prompt: "Extract and summarize the key information from this image.",
  },
  {
    id: "translate",
    label: "Translate",
    mode: "write",
    prompt: "Read and translate the visible text in this image.",
  },
  {
    id: "quiz",
    label: "Quiz me",
    mode: "practice",
    prompt: "Turn the material in this image into a short practice quiz.",
  },
];

export function quickActionsForCapture(kind: StagedCaptureKind): CaptureQuickAction[] {
  return kind === "selectedText" ? TEXT_QUICK_ACTIONS : IMAGE_QUICK_ACTIONS;
}

export function defaultPromptForStagedCapture(staged: StagedCapture): string {
  return staged.kind === "selectedText"
    ? "Explain and answer the clearest question or task in the selected text."
    : "Explain what is shown in this image and help me understand or solve any question in it.";
}

const MAX_PASTED_IMAGE_BYTES = 24 * 1024 * 1024;

export function extractClipboardImage(transfer: DataTransfer | null | undefined): File | null {
  if (!transfer) return null;
  const fromFiles = Array.from(transfer.files ?? []).find((file) => file.type.startsWith("image/"));
  if (fromFiles) return fromFiles;
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read pasted image."));
    };
    reader.onerror = () => reject(new Error("Could not read pasted image."));
    reader.readAsDataURL(blob);
  });
}

export async function readImageFileAsPngBase64(file: Blob): Promise<string> {
  if (file.size === 0) throw new Error("Pasted image is empty.");
  if (file.size > MAX_PASTED_IMAGE_BYTES) {
    throw new Error("Pasted image exceeds the 24 MB size limit.");
  }
  if (file.type === "image/png" || typeof createImageBitmap !== "function") {
    return readBlobAsDataUrl(file);
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return readBlobAsDataUrl(file);
    context.drawImage(bitmap, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}
