import { describe, expect, test } from "bun:test";
import { captureIsWorking, capturePhaseLabel } from "../src/features/agent/status.ts";

describe("Agent capture lifecycle", () => {
  test("working phases expose progress without treating failure as busy", () => {
    expect(captureIsWorking("preparing")).toBe(true);
    expect(captureIsWorking("capturing")).toBe(true);
    expect(captureIsWorking("submitting")).toBe(true);
    expect(captureIsWorking("analyzing")).toBe(true);
    expect(captureIsWorking("failed")).toBe(false);
  });

  test("capture phases use distinct user-facing recovery labels", () => {
    expect(capturePhaseLabel("preparing")).toBe("Preparing capture");
    expect(capturePhaseLabel("capturing")).toBe("Capturing screen");
    expect(capturePhaseLabel("submitting")).toBe("Sending image");
    expect(capturePhaseLabel("analyzing")).toBe("Analyzing screenshot");
    expect(capturePhaseLabel("failed")).toBe("Capture failed");
  });
});
