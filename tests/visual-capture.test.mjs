import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createVisualRecorder } from "./e2e/visual-capture.mjs";

const directories = [];
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==";

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("visual capture is disabled unless explicitly enabled", async () => {
  const visual = createVisualRecorder("test", false);
  let called = false;
  const result = await visual.capture("idle", async () => {
    called = true;
    return png;
  });
  expect(called).toBe(false);
  expect(result).toBeNull();
  expect(visual.directory).toBeNull();
});

test("visual capture writes a private PNG keyframe when enabled", async () => {
  const visual = createVisualRecorder("test", true);
  directories.push(visual.directory);
  const path = await visual.capture("Home to Agent", async () => png);
  expect(path).toContain("home-to-agent.png");
  expect(existsSync(path)).toBe(true);
  const bytes = readFileSync(path);
  expect(bytes.readUInt32BE(16)).toBe(1);
  expect(bytes.readUInt32BE(20)).toBe(1);
});

test("visual capture rejects invalid PNG screenshot data", async () => {
  const visual = createVisualRecorder("test", true);
  directories.push(visual.directory);
  await expect(visual.capture("bad", async () => "not png")).rejects.toThrow("invalid PNG");
});
