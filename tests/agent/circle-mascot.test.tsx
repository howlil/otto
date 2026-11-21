import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { AgentCapsule } from "../../src/features/agent/capsule/AgentCapsule";
import { AgentHeader } from "../../src/features/agent/conversation/AgentHeader";
import { resolveCircleState } from "../../src/features/agent/model/circle-state";
import type { AgentSnapshot, ProviderReadiness } from "../../src/platform/tauri";

afterEach(cleanup);

const baseSnapshot: AgentSnapshot = {
  runId: 1,
  seq: 1,
  status: "idle",
  provider: "codex",
  conversationId: "conv-1",
  threadId: null,
  model: "gpt-5-codex",
  thinkingEffort: null,
  usage: null,
  messages: [],
  activities: [],
  thinkingText: "",
  pendingPermission: null,
  queuedFollowup: null,
  capture: {
    requestId: 0,
    phase: "idle",
    source: "window",
    shortcut: "Ctrl+Shift+O",
    textShortcut: "Ctrl+Alt+S",
    autoSend: false,
    staged: null,
    error: null,
  },
  error: null,
};

const ready: ProviderReadiness = {
  status: "ready",
  message: "Ready",
  recovery: "",
  imageInput: true,
  imageTransport: true,
  model: "gpt-5-codex",
  models: [],
  thinkingEffort: null,
  thinkingEfforts: [],
  rateLimits: null,
};

describe("Circle mascot compact mode", () => {
  test("maps agent states to expressive Otto eye states", () => {
    expect(resolveCircleState(baseSnapshot, true, ready, null).eyeExpression).toBe("idle");
    expect(
      resolveCircleState({ ...baseSnapshot, status: "streaming" }, true, ready, null).eyeExpression,
    ).toBe("working");
    expect(
      resolveCircleState(baseSnapshot, true, ready, null, { listening: true }).eyeExpression,
    ).toBe("listening");
    expect(
      resolveCircleState(baseSnapshot, true, ready, null, { speaking: true }).eyeExpression,
    ).toBe("speaking");
    expect(
      resolveCircleState({ ...baseSnapshot, status: "completed" }, true, ready, null).eyeExpression,
    ).toBe("completed");
    expect(
      resolveCircleState({ ...baseSnapshot, status: "stopped" }, true, ready, null).eyeExpression,
    ).toBe("attention");
    expect(
      resolveCircleState({ ...baseSnapshot, status: "failed" }, true, ready, null).eyeExpression,
    ).toBe("error");
  });

  test("renders expressive eyes in circle mode and toggles compact style on right-click", () => {
    let toggled = 0;
    const { container, rerender } = render(
      <AgentCapsule
        snapshot={baseSnapshot}
        installed={true}
        readiness={ready}
        error={null}
        circle={false}
        buttonRef={createRef()}
        onOpen={() => {}}
        onToggleCompactStyle={() => {
          toggled += 1;
        }}
      />,
    );

    const capsuleButton = screen.getByRole("button", { name: /Open Agent/ });
    fireEvent.contextMenu(capsuleButton);
    expect(toggled).toBe(1);

    rerender(
      <AgentCapsule
        snapshot={{ ...baseSnapshot, status: "completed" }}
        installed={true}
        readiness={ready}
        error={null}
        circle={true}
        buttonRef={createRef()}
        onOpen={() => {}}
        onToggleCompactStyle={() => {
          toggled += 1;
        }}
      />,
    );

    expect(container.querySelector("[data-eye-expression='completed']")).not.toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Open Agent/ }));
    expect(toggled).toBe(2);
  });

  test("exposes quick compact style toggle in the expanded header and locks it under Otto OS", () => {
    let toggled = 0;
    const { rerender } = render(
      <AgentHeader
        view="chat"
        provider="codex"
        model="gpt-5-codex"
        thinkingEffort={null}
        hasThread={false}
        resetBusy={false}
        onBack={() => {}}
        onSettings={() => {}}
        onHistory={() => {}}
        onNewSession={() => {}}
        gearRef={createRef()}
        compactCircle={false}
        compactStyleLocked={false}
        onToggleCompactStyle={() => {
          toggled += 1;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch compact to Circle" }));
    expect(toggled).toBe(1);

    rerender(
      <AgentHeader
        view="chat"
        provider="codex"
        model="gpt-5-codex"
        thinkingEffort={null}
        hasThread={false}
        resetBusy={false}
        onBack={() => {}}
        onSettings={() => {}}
        onHistory={() => {}}
        onNewSession={() => {}}
        gearRef={createRef()}
        compactCircle={true}
        compactStyleLocked={true}
        onToggleCompactStyle={() => {
          toggled += 1;
        }}
      />,
    );

    const lockedButton = screen.getByRole("button", {
      name: "Switch compact to Capsule",
    }) as HTMLButtonElement;
    expect(lockedButton.disabled).toBe(true);
  });
});
