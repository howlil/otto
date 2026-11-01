import { describe, expect, test } from "bun:test";
import {
  clearAcceptedDraft,
  restoreRejectedDraft,
} from "../src/features/agent/draft-state.ts";

describe("Agent draft ownership", () => {
  const pending = { text: "What is wrong?", epoch: 3, previousRunId: 11 };

  test("ACK clears only the unchanged submitted draft", () => {
    expect(clearAcceptedDraft("What is wrong?", 3, pending)).toBe("");
    expect(clearAcceptedDraft("My next question", 4, pending)).toBe("My next question");
    expect(clearAcceptedDraft("What is wrong?", 4, pending)).toBe("What is wrong?");
  });

  test("a failed unaccepted run restores its own draft", () => {
    expect(restoreRejectedDraft("", 3, pending, 12, false)).toBe("What is wrong?");
    expect(restoreRejectedDraft("New question", 4, pending, 12, false)).toBe("New question");
  });

  test("stale failure or accepted request cannot overwrite a newer run", () => {
    expect(restoreRejectedDraft("", 3, pending, 11, false)).toBe("");
    expect(restoreRejectedDraft("", 3, pending, 12, true)).toBe("");
  });
});
