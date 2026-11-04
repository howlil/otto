import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { History } from "../src/features/agent/History";
import type { AgentHistoryModel } from "../src/features/agent/view-model";
import type { AgentConversationSummary } from "../src/platform/tauri";

const conversation = (
  id: string,
  title: string,
  interrupted = false,
): AgentConversationSummary => ({
  id,
  title,
  provider: "codex",
  updatedAt: Date.now(),
  messageCount: 2,
  interrupted,
});

function model(overrides: Partial<AgentHistoryModel> = {}) {
  const calls = {
    open: [] as string[],
    rename: [] as [string, string][],
    remove: [] as string[],
    removeAll: 0,
  };
  const history: AgentHistoryModel = {
    conversations: [conversation("1", "First question"), conversation("2", "Second question")],
    query: "",
    setQuery: () => {},
    pending: false,
    error: null,
    refresh: async () => {},
    open: async (id) => {
      calls.open.push(id);
      return true;
    },
    rename: async (id, title) => {
      calls.rename.push([id, title]);
      return true;
    },
    remove: async (id) => {
      calls.remove.push(id);
      return true;
    },
    removeAll: async () => {
      calls.removeAll += 1;
      return true;
    },
    ...overrides,
  };
  return { history, calls };
}

const settled = () => new Promise((done) => setTimeout(done, 0));
const openButton = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });

afterEach(cleanup);

describe("Agent history operations through the rendered list", () => {
  test("opening a saved conversation reports success to the owner", async () => {
    const { history, calls } = model();
    let done = 0;
    render(
      <History history={history} busy={false} onDone={() => (done += 1)} onMeasured={() => {}} />,
    );

    fireEvent.click(openButton("First question"));

    await waitFor(() => expect(calls.open).toEqual(["1"]));
    await waitFor(() => expect(done).toBe(1));
  });

  test("a failed open keeps the history view open", async () => {
    const { history } = model({ open: async () => false });
    let done = 0;
    render(
      <History history={history} busy={false} onDone={() => (done += 1)} onMeasured={() => {}} />,
    );

    fireEvent.click(openButton("First question"));

    await settled();
    await settled();
    expect(done).toBe(0);
  });

  test("renaming sends the edited title, not the previous one", async () => {
    const { history, calls } = model();
    render(
      <History history={history} busy={false} onDone={() => {}} onMeasured={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename First question" }));
    const field = screen.getByLabelText("Conversation title");
    expect((field as HTMLInputElement).value).toBe("First question");

    fireEvent.change(field, { target: { value: "Renamed conversation" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(calls.rename).toEqual([["1", "Renamed conversation"]]));
  });

  test("Escape cancels a rename without writing", async () => {
    const { history, calls } = model();
    render(
      <History history={history} busy={false} onDone={() => {}} onMeasured={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename First question" }));
    fireEvent.keyDown(screen.getByLabelText("Conversation title"), { key: "Escape" });

    await waitFor(() => expect(openButton("First question")).toBeTruthy());
    expect(calls.rename).toEqual([]);
  });

  test("deleting requires confirmation before the record is removed", async () => {
    const { history, calls } = model();
    render(
      <History history={history} busy={false} onDone={() => {}} onMeasured={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete First question" }));
    expect(calls.remove).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(calls.remove).toEqual(["1"]));
  });

  test("cancelling a delete keeps the conversation", async () => {
    const { history, calls } = model();
    render(
      <History history={history} busy={false} onDone={() => {}} onMeasured={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete First question" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete First question" })).toBeTruthy(),
    );
    expect(calls.remove).toEqual([]);
  });

  test("deleting all history requires confirmation", async () => {
    const { history, calls } = model();
    render(
      <History history={history} busy={false} onDone={() => {}} onMeasured={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete all history" }));
    expect(calls.removeAll).toBe(0);
    expect(screen.getByText(/Delete all saved conversations/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(calls.removeAll).toBe(1));
  });

  test("cancelling delete all keeps the history action available", async () => {
    const { history, calls } = model();
    render(
      <History history={history} busy={false} onDone={() => {}} onMeasured={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete all history" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Delete all history" })).toBeTruthy());
    expect(calls.removeAll).toBe(0);
  });

  test("a pending history operation blocks open, rename and delete", () => {
    const { history } = model({ pending: true });
    render(
      <History history={history} busy={false} onDone={() => {}} onMeasured={() => {}} />,
    );

    expect(openButton("First question").hasAttribute("disabled")).toBe(
      true,
    );
    expect(
      screen.getByRole("button", { name: "Rename First question" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Delete First question" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Delete all history" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("an active run blocks history mutation without hiding the list", () => {
    const { history } = model();
    render(<History history={history} busy onDone={() => {}} onMeasured={() => {}} />);

    expect(
      screen.getByRole("button", { name: "Rename First question" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("Second question")).toBeTruthy();
  });

  test("search narrows the rendered conversations", () => {
    const { history } = model({ query: "second" });
    render(
      <History history={history} busy={false} onDone={() => {}} onMeasured={() => {}} />,
    );

    expect(screen.queryByText("First question")).toBeNull();
    expect(screen.getByText("Second question")).toBeTruthy();
  });

  test("a history read error offers a retry instead of an empty list claim", async () => {
    let retried = 0;
    const { history } = model({
      conversations: [],
      error: "History unavailable",
      refresh: async () => {
        retried += 1;
      },
    });
    render(
      <History history={history} busy={false} onDone={() => {}} onMeasured={() => {}} />,
    );

    expect(screen.getByText("History unavailable")).toBeTruthy();
    expect(screen.queryByText(/No saved conversations yet/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retried).toBe(1));
  });
});
