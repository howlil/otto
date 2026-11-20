import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { CaptureSource } from "../../src/platform/tauri";

const configuredSources: CaptureSource[] = [];

mock.module("../../src/platform/tauri/runtime", () => ({ nativeAvailable: true }));
mock.module("../../src/platform/tauri/capture", () => ({
  configureCaptureSource: async (source: CaptureSource) => {
    configuredSources.push(source);
  },
  configureCaptureShortcut: async () => {},
  insertAgentText: async () => {},
  getCaptureTargetTitle: async () => "Browser Window",
}));

const { CaptureSettings } = await import("../../src/features/agent/capture/CaptureSettings");
const { useCaptureSource } = await import("../../src/features/agent/capture/useCaptureSource");

function AgentCaptureSettings({
  capture,
  focusCaptureShortcut,
  imageTransport = true,
}: {
  capture: Record<string, unknown>;
  focusCaptureShortcut: boolean;
  imageTransport?: boolean;
}) {
  return (
    <CaptureSettings
      agent={{ capture, readiness: { imageTransport, status: "ready" } } as never}
      focusShortcut={focusCaptureShortcut}
    />
  );
}

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
  test("offers selected text without querying a window target", () => {
    let refreshed = 0;
    render(
      <AgentCaptureSettings
        capture={{
          source: "selectedText",
          selectSource: async () => {},
          targetTitle: "Browser Window",
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

    expect(screen.getByRole("button", { name: /^Selected text/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("The text you highlighted in another app. No screenshot.")).toBeTruthy();
    expect(screen.queryByText("Last observed: Browser Window")).toBeNull();
    expect(refreshed).toBe(0);
  });

  test("offers scrolling capture and keeps target status visible", () => {
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

    const scrolling = screen.getByRole("button", { name: /^Scrolling window/ });
    expect(scrolling.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Last observed: Docs - Browser")).toBeTruthy();
    expect(refreshed).toBe(1);
    fireEvent.click(scrolling);
    expect(selected).toEqual(["scrollingWindow"]);
  });

  test("restores and saves the scrolling source preference", async () => {
    localStorage.setItem("otto.capture.source", "scrollingWindow");
    render(<CaptureSourceHarness />);

    await waitFor(() => {
      expect(configuredSources).toEqual(["scrollingWindow"]);
    });

    fireEvent.click(screen.getByRole("button", { name: /^Full screen/ }));
    await waitFor(() => {
      expect(configuredSources).toEqual(["scrollingWindow", "fullScreen"]);
    });

    fireEvent.click(screen.getByRole("button", { name: /^Scrolling window/ }));
    await waitFor(() => {
      expect(configuredSources).toEqual(["scrollingWindow", "fullScreen", "scrollingWindow"]);
    });
    expect(localStorage.getItem("otto.capture.source")).toBe("scrollingWindow");
  });

  test("restores the selected-text source preference", async () => {
    localStorage.setItem("otto.capture.source", "selectedText");
    render(<CaptureSourceHarness />);

    await waitFor(() => {
      expect(configuredSources).toEqual(["selectedText"]);
    });
  });

  test("offers area selection without querying a window target and persists region", async () => {
    let refreshed = 0;
    const { unmount } = render(
      <AgentCaptureSettings
        capture={{
          source: "region",
          selectSource: async () => {},
          targetTitle: "Browser Window",
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

    const region = screen.getByRole("button", { name: /^Select area/ });
    expect(region.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("Last observed: Browser Window")).toBeNull();
    expect(refreshed).toBe(0);
    unmount();

    localStorage.setItem("otto.capture.source", "region");
    render(<CaptureSourceHarness />);

    await waitFor(() => {
      expect(configuredSources).toEqual(["region"]);
    });
  });

  test("gates area selection on image-capable providers", () => {
    render(
      <AgentCaptureSettings
        imageTransport={false}
        capture={{
          source: "selectedText",
          selectSource: async () => {},
          targetTitle: null,
          targetWarning: null,
          targetPending: false,
          refreshTarget: async () => {},
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

    expect(screen.getByRole("button", { name: /^Select area/ }).hasAttribute("disabled")).toBe(true);
  });

  test("exposes independent selected text shortcut and instant auto-send toggle", () => {
    const toggled: boolean[] = [];
    render(
      <AgentCaptureSettings
        capture={{
          source: "window",
          selectSource: async () => {},
          targetTitle: "Browser Window",
          targetWarning: null,
          targetPending: false,
          refreshTarget: async () => {},
          sourceReady: true,
          sourcePending: false,
          shortcut: "Ctrl+Shift+O",
          setShortcut: () => {},
          textShortcut: "Ctrl+Shift+T",
          saveTextShortcut: async () => {},
          autoSend: false,
          setAutoSend: async (next: boolean) => {
            toggled.push(next);
          },
          captureMessage: "",
          savingCapture: false,
          available: true,
          saveShortcut: async () => {},
        }}
        focusCaptureShortcut={false}
      />,
    );

    expect(screen.getByText("Text capture shortcut")).toBeTruthy();
    const autoSendToggle = screen.getByRole("checkbox", { name: /^Instant auto-send/ });
    expect((autoSendToggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(autoSendToggle);
    expect(toggled).toEqual([true]);
  });
});
