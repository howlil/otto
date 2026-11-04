import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentCapsule } from "../src/features/agent/AgentCapsule";
import { AgentTranscript } from "../src/features/agent/AgentTranscript";

const snapshot = (overrides = {}) => ({
  runId: 1,
  seq: 1,
  status: "idle",
  provider: "codex",
  threadId: null,
  model: "gpt-5-codex",
  thinkingEffort: "high",
  usage: null,
  messages: [],
  capture: { requestId: 0, phase: "idle", error: null },
  error: null,
  ...overrides,
});

const readiness = (overrides = {}) => ({
  status: "ready",
  message: "Codex is ready.",
  recovery: "",
  imageInput: false,
  imageTransport: false,
  toolFreeAdmission: false,
  model: "gpt-5-codex",
  models: [],
  thinkingEffort: "high",
  thinkingEfforts: ["low", "high"],
  ...overrides,
});

const transcriptModel = (overrides = {}) => ({
  snapshot: snapshot(),
  readiness: readiness(),
  draft: "Why does ownership matter?",
  setDraft: () => {},
  error: null,
  busy: false,
  captureBusy: false,
  send: async () => {},
  stop: async () => {},
  refreshProvider: async () => {},
  retryConnection: async () => {},
  clearError: () => {},
  errorKind: null,
  ...overrides,
});

const transcript = (overrides = {}) => {
  const model = transcriptModel(overrides);
  return render(
    <AgentTranscript
      agent={model}
      onConfigureCapture={() => {}}
      onCapture={() => {}}
      captureActionError={null}
      onMeasured={() => {}}
    />,
  );
};

const capsule = (snapshotOverrides = {}, readinessOverrides = {}) =>
  render(
    <AgentCapsule
      snapshot={snapshot(snapshotOverrides)}
      installed
      readiness={readiness(readinessOverrides)}
      error={null}
      buttonRef={{ current: null }}
      onOpen={() => {}}
    />,
  );

const sendButton = () => screen.getByRole("button", { name: "Send prompt" });

afterEach(cleanup);

describe("Agent readiness surfaced through the rendered chat", () => {
  test("an expired sign-in is reported with recovery instead of a ready claim", () => {
    transcript({
      readiness: readiness({
        status: "authRequired",
        message: "Codex needs sign-in.",
        recovery: "Run codex login, then Retry.",
      }),
    });
    expect(screen.getByText("Sign in required")).toBeTruthy();
    expect(screen.getByText(/Run codex login, then Retry\./)).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
  });

  test("a missing provider is reported as unavailable and blocks sending", () => {
    transcript({
      readiness: readiness({
        status: "missing",
        message: "Codex is not installed.",
        recovery: "Install the Codex CLI, then Retry.",
      }),
    });
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText(/Install the Codex CLI, then Retry\./)).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(true);
  });

  test("retry re-probes the provider readiness exactly once", () => {
    let retries = 0;
    transcript({
      readiness: readiness({ status: "unsupported", message: "Codex is too old.", recovery: "" }),
      refreshProvider: async () => {
        retries += 1;
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retries).toBe(1);
  });

  test("a lost Otto connection offers reconnect instead of a provider retry", () => {
    let reconnects = 0;
    transcript({
      error: "Cannot connect to the Otto desktop process.",
      errorKind: "connection",
      retryConnection: async () => {
        reconnects += 1;
      },
    });
    expect(screen.getByText("Otto connection unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(reconnects).toBe(1);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("a native run failure is shown as a request failure with draft recovery", () => {
    transcript({
      snapshot: snapshot({
        status: "failed",
        error: "The provider exited before returning an answer.",
      }),
    });
    expect(screen.getByText("Request failed")).toBeTruthy();
    expect(screen.getByText(/provider exited before returning an answer/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("Agent compact capsule state", () => {
  test("a finished background answer is announced without opening the chat", () => {
    capsule({ status: "completed", messages: [{ id: "1:assistant", role: "assistant", text: "Done" }] });
    expect(screen.getByText("Answer ready")).toBeTruthy();
  });

  test("an expired sign-in is visible in the compact capsule", () => {
    capsule({ status: "idle" }, { status: "authRequired" });
    expect(screen.getByText("Sign in required")).toBeTruthy();
    expect(screen.queryByText("Answer ready")).toBeNull();
  });
});
