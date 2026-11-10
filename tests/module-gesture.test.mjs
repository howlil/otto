import { expect, test } from "bun:test";
import { ModuleGesture, adjacentModule } from "../src/features/shell/module-gesture";

test("carousel wraps without adding Home or Settings", () => {
  expect(adjacentModule("agent", -1)).toBe("focus");
  expect(adjacentModule("focus", 1)).toBe("agent");
  expect(adjacentModule("home", 1)).toBe("agent");
  expect(adjacentModule("home", -1)).toBe("focus");
  expect(adjacentModule("agent-settings", 1)).toBeNull();
});

test("horizontal intent commits once until inertia ends", () => {
  const gesture = new ModuleGesture();
  expect(gesture.feed(30, 2, 0, 0)).toBeNull();
  expect(gesture.feed(45, 3, 0, 20)).toBe(1);
  expect(gesture.feed(200, 0, 0, 40)).toBeNull();
  expect(gesture.feed(-80, 0, 0, 400)).toBe(-1);
});

test("fresh same-direction swipes rearm during an inertia tail without waiting for silence", () => {
  const gesture = new ModuleGesture();
  expect(gesture.feed(70, 1, 0, 0)).toBe(1);
  for (const [x, time] of [[32, 30], [12, 60], [3, 90], [1, 120]]) {
    expect(gesture.feed(x, 0, 0, time)).toBeNull();
  }
  expect(gesture.feed(24, 1, 0, 160)).toBeNull();
  expect(gesture.feed(24, 1, 0, 180)).toBe(1);
  for (const [x, time] of [[10, 210], [2, 240], [1, 270]]) {
    expect(gesture.feed(x, 0, 0, time)).toBeNull();
  }
  expect(gesture.feed(48, 1, 0, 310)).toBe(1);
});

test("deliberate reversal navigates back while the previous tail is still arriving", () => {
  const gesture = new ModuleGesture();
  expect(gesture.feed(70, 0, 0, 0)).toBe(1);
  expect(gesture.feed(18, 0, 0, 50)).toBeNull();
  expect(gesture.feed(-48, 1, 0, 110)).toBe(-1);
  expect(gesture.feed(-12, 0, 0, 140)).toBeNull();
});

test("small direction jitter and a long decaying tail never trigger another module", () => {
  const gesture = new ModuleGesture();
  expect(gesture.feed(70, 0, 0, 0)).toBe(1);
  for (const [x, time] of [[35, 100], [20, 200], [10, 300], [-2, 400], [1, 500], [0.5, 600]]) {
    expect(gesture.feed(x, 0, 0, time)).toBeNull();
  }
});

test("vertical intent stays scrolling and reset discards partial movement", () => {
  const gesture = new ModuleGesture();
  expect(gesture.feed(10, 50, 0, 0)).toBeNull();
  expect(gesture.feed(100, 1, 0, 20)).toBeNull();
  gesture.reset();
  expect(gesture.feed(2, 0, 1, 400)).toBeNull();
  gesture.reset();
  expect(gesture.feed(2, 0, 1, 500)).toBeNull();
  expect(gesture.feed(1, 0, 1, 520)).toBe(1);
});
