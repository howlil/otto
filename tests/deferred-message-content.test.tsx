import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createMessageContentRenderer,
  DeferredMessageContent,
} from "../src/features/agent/DeferredMessageContent";
import { MessageContent } from "../src/features/agent/MessageContent";

const answer = "## Answer\n\n```ts\nconst total = 42;\n```";

afterEach(cleanup);

describe("deferred transcript formatting", () => {
  test("keeps the latest streaming text visible until formatting becomes available", async () => {
    const ready = Promise.withResolvers<{ MessageContent: typeof MessageContent }>();
    const Content = createMessageContentRenderer(() => ready.promise);
    const view = render(<DeferredMessageContent renderer={Content} text="## Partial answer" />);
    expect(screen.getByText("## Partial answer")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
    view.rerender(<DeferredMessageContent renderer={Content} text={answer} />);
    expect(screen.getByText(answer, { normalizer: (value) => value })).toBeTruthy();
    await act(async () => {
      ready.resolve({ MessageContent });
      await ready.promise;
    });
    expect(screen.getByRole("heading", { name: "Answer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
    expect(screen.queryByText("## Partial answer")).toBeNull();
  });

  test("failed optional formatting keeps current and subsequent output readable and inert", async () => {
    const ready = Promise.withResolvers<{ MessageContent: typeof MessageContent }>();
    const Content = createMessageContentRenderer(() => ready.promise);
    const text = "## Answer\n<script>alert('unsafe')</script>\n<img src='https://otto.example/private'>";
    const view = render(<DeferredMessageContent renderer={Content} text={text} />);
    expect(screen.getByText(text, { normalizer: (value) => value })).toBeTruthy();
    await act(async () => {
      ready.reject(new Error("Optional renderer unavailable"));
      await ready.promise.catch(() => {});
    });
    view.rerender(<DeferredMessageContent renderer={Content} text={`${text}\nStill streaming.`} />);
    expect(screen.getByText(`${text}\nStill streaming.`, { normalizer: (value) => value })).toBeTruthy();
    expect(view.container.querySelector("script, img, iframe")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  test("loaded formatting preserves exact code copy and ignores late completion after unmount", async () => {
    const ready = Promise.withResolvers<{ MessageContent: typeof MessageContent }>();
    const Content = createMessageContentRenderer(() => ready.promise);
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { copied = text; } },
    });
    const outgoing = render(<DeferredMessageContent renderer={Content} text="## Outgoing" />);
    outgoing.unmount();
    await act(async () => {
      ready.resolve({ MessageContent });
      await ready.promise;
    });
    expect(screen.queryByText("Outgoing")).toBeNull();
    render(<DeferredMessageContent renderer={Content} text={answer} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Copy code" }));
    });
    expect(copied).toBe("const total = 42;\n");
  });
});
