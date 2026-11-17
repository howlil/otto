import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { CaptureSource } from "../src/platform/tauri";

const configuredSources: CaptureSource[] = [];

mock.module("../src/platform/tauri/capture", () => ({
  nativeAvailable: true,
  configureCaptureSource: async (source: CaptureSource) => {
    configuredSources.push(source);
  },
  configureCaptureShortcut: async () => {},
  getCaptureTargetTitle: async () => "Browser Window",
}));

const { AgentCaptureSettings } = await import("../src/features/agent/AgentCaptureSettings");
const { useCaptureSource } = await import("../src/features/agent/useCaptureSource");

function CaptureSourceHarness() {
  const [, setMessage] = useState("");
  const { source, selectSource, sourceReady, sourcePending } = useCaptureSource(setMessage);
  return (
    <AgentCaptureSettings
      capture={{
        source,
        selectSource,
        targetTitle: "Browser Window",
        targetWarning: null,
        targetPending: false,
        refreshTarget: async () => {},
        sourceReady,
        sourcePending,
        shortcut: "Ctrl+Shift+O",
        setShortcut: () => {},
        captureMessage: "",
        savingCapture: false,
        available: true,
        saveShortcut: async () => {},
      }}
      focusCaptureShortcut={false}
    />
  );
}

afterEach(() => {
  cleanup();
  configuredSources.length = 0;
  localStorage.clear();
});

describe("Agent capture source settings", () => {
  test("offers Scrolling window and keeps target window status visible", () => {
    const selected: CaptureSource[] = [];
    let refreshed = 0;
    render(
      <AgentCaptureSettings
        capture={{
          source: "scrollingWindow",
          selectSource: async (next) => {
            selected.push(next);
          },
          targetTitle: "Docs - Browser",
          targetWarning: null,
          targetPending: false,
          refreshTarget: async () => {
            refreshed += 1;
          },
          sourceReady: true,
          sourcePending: false,
          shortcut: "Ctrl+Shift+O",
          setShortcut: () => {},
          captureMessage: "",
          savingCapture: false,
          available: true,
          saveShortcut: async () => {},
        }}
        focusCaptureShortcut={false}
      />,
    );

    const scrollingButton = screen.getByRole("button", { name: "Scrolling window" });
    expect(scrollingButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Last observed: Docs - Browser")).toBeTruthy();
    expect(refreshed).toBe(1);

    fireEvent.click(scrollingButton);
    expect(selected).toEqual(["scrollingWindow"]);
  });

  test("restores and saves scrollingWindow preference through useCaptureSource", async () => {
    localStorage.setItem("otto.capture.source", "scrollingWindow");
    render(<CaptureSourceHarness />);

    await waitFor(() => {
      expect(configuredSources).toEqual(["scrollingWindow"]);
    });

    const fullScreen = screen.getByRole("button", { name: "Full screen" });
    fireEvent.click(fullScreen);
    await waitFor(() => {
      expect(configuredSources).toEqual(["scrollingWindow", "fullScreen"]);
    });

    const scrolling = screen.getByRole("button", { name: "Scrolling window" });
    fireEvent.click(scrolling);
    await waitFor(() => {
      expect(configuredSources).toEqual(["scrollingWindow", "fullScreen", "scrollingWindow"]);
    });
    expect(localStorage.getItem("otto.capture.source")).toBe("scrollingWindow");
  });
});
