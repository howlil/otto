import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AgentComposer } from "../../src/features/agent/conversation/AgentComposer";

const settled = () => new Promise((done) => setTimeout(done, 0));

let sends = 0;
let stops = 0;
let captures = 0;

function Harness({
  initial = "",
  busy = false,
  stopping = false,
  canSend = true,
  imageTransport = true,
  captureSource = "window",
}: {
  initial?: string;
  busy?: boolean;
  stopping?: boolean;
  canSend?: boolean;
  imageTransport?: boolean;
  captureSource?: "selectedText" | "window";
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <AgentComposer
      provider="codex"
      imageTransport={imageTransport}
      captureSource={captureSource}
      composerRef={{ current: null }}
      draft={draft}
      setDraft={setDraft}
      busy={busy}
      captureBusy={false}
      capturePhase="idle"
      canSend={canSend}
      stopping={stopping}
      onCapture={() => {
        captures += 1;
      }}
      send={async () => {
        sends += 1;
      }}
      stop={async () => {
        stops += 1;
      }}
    />
  );
}

const prompt = () => screen.getByRole("textbox", { name: "Question for the selected agent" });
const sendButton = () => screen.getByRole("button", { name: "Send prompt" });

afterEach(() => {
  cleanup();
  sends = 0;
  stops = 0;
  captures = 0;
});

describe("Agent composer submit wiring", () => {
  test("stays a capsule until the prompt needs another line", () => {
    render(<Harness />);

    const initialPrompt = prompt();
    expect(initialPrompt.closest("form")?.className).toContain("rounded-full");

    Object.defineProperty(initialPrompt, "scrollHeight", { configurable: true, value: 38 });
    fireEvent.change(initialPrompt, { target: { value: "A longer prompt that needs more room" } });

    expect(prompt().closest("form")?.className).toContain("rounded-[22px]");
  });

  test("Enter submits the current draft once", async () => {
    render(<Harness initial="What changed?" />);

    fireEvent.keyDown(prompt(), { key: "Enter", shiftKey: false });
    await settled();

    expect(sends).toBe(1);
  });

  test("Shift+Enter keeps composing instead of sending", async () => {
    render(<Harness initial="What changed?" />);

    fireEvent.keyDown(prompt(), { key: "Enter", shiftKey: true });
    await settled();

    expect(sends).toBe(0);
  });

  test("an in-flight IME composition cannot submit the prompt", async () => {
    render(<Harness initial="kode" />);

    fireEvent.keyDown(prompt(), { key: "Enter", shiftKey: false, isComposing: true });
    await settled();

    expect(sends).toBe(0);
  });

  test("Enter cannot submit while the composer is not sendable", async () => {
    render(<Harness initial="What changed?" canSend={false} />);

    fireEvent.keyDown(prompt(), { key: "Enter", shiftKey: false });
    await settled();

    expect(sends).toBe(0);
    expect(sendButton().hasAttribute("disabled")).toBe(true);
  });

  test("the send control submits through the form path", async () => {
    render(<Harness initial="What changed?" />);

    fireEvent.click(sendButton());
    await settled();

    expect(sends).toBe(1);
  });
});

describe("Agent composer run controls", () => {
  test("an active run replaces send with an explicit Stop", async () => {
    render(<Harness initial="What changed?" busy />);

    expect(screen.queryByRole("button", { name: "Send prompt" })).toBeNull();
    const stop = screen.getByRole("button", { name: "Stop request" });
    fireEvent.click(stop);
    await settled();

    expect(stops).toBe(1);
  });

  test("Stop cannot be clicked twice while stopping", () => {
    render(<Harness busy stopping />);

    expect(screen.getByRole("button", { name: "Stop request" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  test("capture is offered only for an image-capable transport", () => {
    render(<Harness imageTransport={false} />);
    expect(screen.queryByRole("button", { name: "Capture selected screen source" })).toBeNull();
  });

  test("the image action is hidden for selected-text capture", () => {
    render(<Harness captureSource="selectedText" />);
    expect(screen.queryByRole("button", { name: "Capture selected screen source" })).toBeNull();
  });

  test("capture is disabled for the duration of an active run", () => {
    render(<Harness busy />);
    const capture = screen.getByRole("button", { name: "Capture selected screen source" });
    expect(capture.hasAttribute("disabled")).toBe(true);
  });

  test("capture stays available when the composer is idle", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Capture selected screen source" }));
    await settled();

    expect(captures).toBe(1);
  });

  test("staged capture shows removable attachment chip, quick actions, and visual source menu", () => {
    let cleared = 0;
    const quick: Array<{ mode: string; prompt: string }> = [];
    const pickedSources: string[] = [];
    const pastedFiles: string[] = [];
    let escaped = 0;

    render(
      <div onKeyDown={(event) => event.key === "Escape" && (escaped += 1)}>
        <AgentComposer
          provider="codex"
          imageTransport
          captureSource="window"
          composerRef={{ current: null }}
          draft=""
          setDraft={() => {}}
          stagedCapture={{
            id: 7,
            kind: "selectedText",
            source: "selectedText",
            label: "Selected text",
            preview: "fn quicksort(items: &mut [i32])",
          }}
          onClearStagedCapture={() => {
            cleared += 1;
          }}
          onQuickAction={(mode, promptText) => {
            quick.push({ mode, prompt: promptText });
          }}
          onCaptureSource={(source) => {
            pickedSources.push(source);
          }}
          onStageImage={(file) => {
            pastedFiles.push(file.name);
          }}
          busy={false}
          captureBusy={false}
          capturePhase="idle"
          canSend
          stopping={false}
          onCapture={() => {}}
          send={async () => {}}
          stop={async () => {}}
        />
      </div>,
    );

    expect(screen.getByText("Selected text")).toBeTruthy();
    expect(screen.getByText("fn quicksort(items: &mut [i32])")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Solve" }));
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(quick).toEqual([
      {
        mode: "solve",
        prompt:
          "Solve this problem using the most efficient approach, check edge cases and calculations, and give the verified final answer.",
      },
      {
        mode: "mentor",
        prompt: "Explain this selected text clearly step by step.",
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove staged capture" }));
    expect(cleared).toBe(1);

    const sourceTrigger = screen.getByRole("button", { name: "Choose visual capture source" });
    fireEvent.click(sourceTrigger);
    expect(screen.getByRole("menuitemradio", { name: /Region snip/ })).toBeTruthy();
    fireEvent.keyDown(sourceTrigger, { key: "Escape" });
    expect(escaped).toBe(0);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(sourceTrigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Region snip/ }));
    expect(pickedSources).toEqual(["region"]);

    const file = new File(["png"], "snip.png", { type: "image/png" });
    fireEvent.paste(prompt(), {
      clipboardData: {
        files: [file],
        items: [],
      },
    });
    expect(pastedFiles).toEqual(["snip.png"]);
  });

  test("active run supports queueing a single follow-up and clearing it cleanly", async () => {
    let queuedCount = 0;
    let clearedCount = 0;

    render(
      <AgentComposer
        provider="codex"
        imageTransport
        captureSource="window"
        composerRef={{ current: null }}
        draft="Next follow-up question"
        setDraft={() => {}}
        queuedFollowup="Already queued question"
        canQueue
        onQueueFollowup={async () => {
          queuedCount += 1;
        }}
        onClearQueuedFollowup={async () => {
          clearedCount += 1;
        }}
        busy
        captureBusy={false}
        capturePhase="idle"
        canSend={false}
        stopping={false}
        onCapture={() => {}}
        send={async () => {}}
        stop={async () => {}}
      />,
    );

    expect(screen.getByText("Queued")).toBeTruthy();
    expect(screen.getByText("Already queued question")).toBeTruthy();

    fireEvent.keyDown(prompt(), { key: "Enter", shiftKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Queue follow-up" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove queued follow-up" }));
    await settled();

    expect(queuedCount).toBe(2);
    expect(clearedCount).toBe(1);
    expect(screen.getByRole("button", { name: "Stop request" })).toBeTruthy();
  });
});
