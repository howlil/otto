import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { runPreflight } from "./preflight.mjs";
import { createVisualRecorder } from "./visual-capture.mjs";

if (process.platform !== "win32") throw new Error("Native transition E2E requires Windows");

const root = resolve(import.meta.dirname, "../..");
const app = resolve(process.env.OTTO_E2E_APP || join(root, "src-tauri/target/debug/otto.exe"));
const port = Number(process.env.OTTO_TRANSITION_E2E_PORT || 4550);
const profile = mkdtempSync(join(tmpdir(), "otto-transition-"));
const shell = spawnSync("where.exe", ["pwsh.exe"], { encoding: "utf8" }).status === 0
  ? "pwsh.exe"
  : "powershell.exe";
let driver;
let session;
const visual = createVisualRecorder("transitions");

function available(name) {
  return spawnSync("where.exe", [name], { encoding: "utf8" }).status === 0;
}

function runningInstances() {
  const result = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq otto.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith('"otto.exe"'));
}

async function call(method, path, data, timeout = 10000) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(timeout),
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) {
    throw new Error(`${method} ${path}: ${JSON.stringify(payload.value).slice(0, 500)}`);
  }
  return payload.value;
}

async function until(label, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timeout: ${label}${lastError ? ` — ${lastError.message}` : ""}`);
}

const endpoint = (path = "") => `/session/${session}${path}`;

async function capture(label) {
  await visual.capture(label, () => call("GET", endpoint("/screenshot")));
}

async function execute(script) {
  return call("POST", endpoint("/execute/sync"), { script, args: [] });
}

async function executeAsync(script, timeout = 10000) {
  return call("POST", endpoint("/execute/async"), { script, args: [] }, timeout);
}

async function findCss(selector) {
  const value = await call("POST", endpoint("/element"), {
    using: "css selector",
    value: selector,
  });
  return value["element-6066-11e4-a52e-4f735466cecf"];
}

async function movePointer(action) {
  await call("POST", endpoint("/actions"), {
    actions: [{
      type: "pointer",
      id: "otto-mouse",
      parameters: { pointerType: "mouse" },
      actions: [action],
    }],
  });
}

async function clickTarget(selector) {
  const marked = await execute(`
    const target = ${selector};
    if (!target) return false;
    target.setAttribute("data-e2e-target", "true");
    return true;
  `);
  assert.equal(marked, true, "transition target missing");
  const element = await until("WebDriver transition target", () => findCss('[data-e2e-target="true"]'));
  await call("POST", endpoint(`/element/${element}/click`), {});
  await execute('document.querySelector(\'[data-e2e-target="true"]\')?.removeAttribute("data-e2e-target");');
}

async function hoverPreview() {
  const element = await until("compact hover target", () => findCss('button[aria-expanded="false"]'));
  await movePointer({ type: "pointerMove", duration: 0, origin: { "element-6066-11e4-a52e-4f735466cecf": element }, x: 1, y: 1 });
  await until("hover preview", () => execute('return document.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded") === "true";'));
  await movePointer({ type: "pointerMove", duration: 0, origin: "viewport", x: 0, y: 0 });
  await until("hover collapse", () => execute('return document.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded") === "false";'));
}

function assertGeometry(label, frames) {
  assert.ok(frames.length > 8, `${label}: transition produced too few animation samples`);
  for (const frame of frames) {
    assert.ok(frame.stage.width > 0 && frame.stage.height > 0, `${label}: stage became empty`);
    assert.ok(
      frame.stage.width <= frame.window.width + 2 && frame.stage.height <= frame.window.height + 2,
      `${label}: stage exceeded native frame at ${JSON.stringify(frame)}`,
    );
    assert.ok(
      Math.abs(frame.main.width - frame.stage.width) <= 1.5 &&
        Math.abs(frame.main.height - frame.stage.height) <= 1.5,
      `${label}: visible surface must track the animated stage at ${JSON.stringify(frame)}`,
    );
    assert.ok(
      frame.windowBackground === "rgba(0, 0, 0, 0)" || frame.windowBackground === "transparent",
      `${label}: outer window paints an opaque rectangle: ${JSON.stringify(frame)}`,
    );
    assert.ok(
      frame.stageBackground === "rgba(0, 0, 0, 0)" || frame.stageBackground === "transparent",
      `${label}: animated stage paints an opaque rectangle: ${JSON.stringify(frame)}`,
    );
  }
}

async function transition(label, selector, expected) {
  await clickTarget(selector);
  await capture(`${label}-entering`);
  const result = await executeAsync(`
    const done = arguments[arguments.length - 1];
    const started = performance.now();
    const frames = [];
    const sample = (now) => {
      const stageElement = document.querySelector('[data-surface-stage]');
      const frameElement = document.querySelector('[data-surface-window]');
      const mainElement = stageElement?.querySelector('main');
      if (stageElement && frameElement && mainElement) {
        const stage = stageElement.getBoundingClientRect();
        const frame = frameElement.getBoundingClientRect();
        const main = mainElement.getBoundingClientRect();
        frames.push({
          time: Math.round(now - started),
          stage: { left: stage.left, top: stage.top, width: stage.width, height: stage.height },
          window: { left: frame.left, top: frame.top, width: frame.width, height: frame.height },
          main: { width: main.width, height: main.height },
          windowBackground: getComputedStyle(frameElement).backgroundColor,
          stageBackground: getComputedStyle(stageElement).backgroundColor,
        });
      }
      if (now - started < 1100) requestAnimationFrame(sample);
      else done({
        frames,
        expected: Boolean(${expected}),
        state: {
          body: document.body.innerText.slice(0, 400),
          expanded: document.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded") ?? null,
          surface: document.querySelector("[data-surface]")?.getAttribute("data-surface") ?? null,
        },
      });
    };
    requestAnimationFrame(sample);
  `, 15000);
  assert.ok(!result.error, `${label}: ${result.error ?? "unknown transition error"}`);
  assert.equal(
    result.expected,
    true,
    `${label}: expected state did not settle; frames=${result.frames.length}; state=${JSON.stringify(result.state)}`,
  );
  assertGeometry(label, result.frames);
  const gaps = result.frames.slice(1).map((frame, index) => frame.time - result.frames[index].time);
  const sorted = gaps.toSorted((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
  console.log(`MOTION ${label}: frames=${result.frames.length}, p95_gap=${p95}ms, max_gap=${sorted.at(-1) ?? 0}ms`);
  await capture(`${label}-settled`);
  return result.frames;
}

async function start() {
  runPreflight(root);
  assert.ok(existsSync(app), `Build the debug Tauri binary first: ${app}`);
  for (const name of ["node.exe", "tauri-driver.exe", "msedgedriver.exe", shell]) {
    assert.ok(available(name), `${name} must be installed on PATH`);
  }
  assert.equal(runningInstances().length, 0, "Close the existing Otto instance before native E2E");
  driver = spawn("tauri-driver", ["--port", String(port), "--native-port", String(port + 1)], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PATH: join(root, "tests/e2e/bin") + delimiter + process.env.PATH,
      WEBVIEW2_USER_DATA_FOLDER: profile,
    },
  });
  await until("tauri-driver", async () => {
    try {
      return (await call("GET", "/status"))?.ready;
    } catch {
      return false;
    }
  });
  const created = await call(
    "POST",
    "/session",
    { capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: app } } } },
    90000,
  );
  session = created.sessionId;
  assert.ok(session, "Missing WebDriver session");
  await execute(`
    const key = 'otto.preferences.v1';
    const preferences = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...preferences, clickOutside: false }));
  `);
  await call("POST", endpoint("/refresh"), {});
  await until("compact Home", () => execute('return Boolean(document.querySelector("button[aria-expanded=\\"false\\"]"));'));
}

async function audit() {
  await hoverPreview();
  await transition(
    "compact to Home",
    'document.querySelector("button[aria-expanded=\\"false\\"]")',
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Open Otto settings"))',
  );
  await transition(
    "Home to Global Settings",
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Open Otto settings"))',
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Back to Home"))',
  );
  for (const tab of ["interaction", "system", "placement", "appearance"]) {
    await transition(
      `Global Settings ${tab} tab`,
      `document.querySelector('button[data-active-key="${tab}"]')`,
      `document.querySelector('button[data-active-key="${tab}"][aria-current="page"]')`,
    );
  }
  const attached = await execute(
    'return Boolean(document.querySelector(\'button[data-active-key="attached"]:not([disabled])\'));',
  );
  if (attached) {
    await transition(
      "Global Settings floating to attached",
      'document.querySelector(\'button[data-active-key="attached"]\')',
      'document.querySelector(\'button[data-active-key="attached"][aria-pressed="true"]\')',
    );
    await transition(
      "Global Settings attached to floating",
      'document.querySelector(\'button[data-active-key="floating"]\')',
      'document.querySelector(\'button[data-active-key="floating"][aria-pressed="true"]\')',
    );
  }
  await transition(
    "Global Settings to Home",
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Back to Home"))',
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Open Otto settings"))',
  );
  await transition(
    "Home to Agent",
    'Array.from(document.querySelectorAll("button")).find((button) => button.querySelector("strong")?.textContent?.trim() === "Agent")',
    'document.querySelector("[data-surface=\\"agent\\"]")',
  );
  await transition(
    "Agent to Agent Settings",
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Agent settings"))',
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Back to Agent"))',
  );
  for (const tab of ["capture", "assistant"]) {
    await transition(
      `Agent Settings ${tab} tab`,
      `document.querySelector('button[data-active-key="${tab}"]')`,
      `document.querySelector('button[data-active-key="${tab}"][aria-current="page"]')`,
    );
  }
  await transition(
    "Agent Settings to Agent",
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Back to Agent"))',
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Agent settings"))',
  );
  await transition(
    "Agent to Home",
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Return to Home"))',
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Open Otto settings"))',
  );
  await transition(
    "Home to Focus",
    'Array.from(document.querySelectorAll("button")).find((button) => button.querySelector("strong")?.textContent?.trim() === "Focus")',
    '(() => { const stage = document.querySelector("[data-surface-stage]")?.getBoundingClientRect(); return Boolean(document.querySelector("[data-surface=\\"focus\\"]")) && Math.round(stage?.width ?? 0) === 408 && Math.round(stage?.height ?? 0) === 174; })()',
  );
  const focusAppearance = await execute(`
    const focus = document.querySelector('[data-surface="focus"]');
    const countdown = focus.querySelector('p.tabular-nums');
    const phase = focus.querySelector('button[aria-pressed="true"]');
    return {
      homeEyes: Boolean(focus.querySelector('.otto-focus-home [data-expression]')),
      headerHeight: focus.querySelector('header').getBoundingClientRect().height,
      countdownSize: getComputedStyle(countdown).fontSize,
      phaseSize: getComputedStyle(phase).fontSize,
    };
  `);
  assert.equal(focusAppearance.homeEyes, true, "Focus Home must render Otto eyes");
  assert.equal(focusAppearance.headerHeight, 42, "Focus header must match the canonical height");
  assert.equal(focusAppearance.countdownSize, "39px", "Focus countdown must retain its display scale");
  assert.equal(focusAppearance.phaseSize, "10px", "Global button inheritance must not override Focus typography");
  await clickTarget(
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Start timer"))',
  );
  await until("Focus running", () =>
    execute('return Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("Pause timer"));'),
  );
  await clickTarget(
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Pause timer"))',
  );
  await until("Focus paused", () =>
    execute('return Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("Resume timer"));'),
  );
  await clickTarget(
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Short")',
  );
  await until("Focus phase confirmation", () =>
    execute('return document.querySelector("[role=dialog]")?.textContent?.includes("Switch to Short break?") ?? false;'),
  );
  await clickTarget(
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Switch phase")',
  );
  await until("Short break ready", () =>
    execute('return Array.from(document.querySelectorAll("button[aria-pressed=\\"true\\"]")).some((button) => button.textContent?.trim() === "Short");'),
  );
  await transition(
    "Focus to Focus Settings",
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Edit durations"))',
    '(() => { const stage = document.querySelector("[data-surface-stage]")?.getBoundingClientRect(); return document.body.innerText.includes("Session lengths") && Math.round(stage?.width ?? 0) === 408 && Math.round(stage?.height ?? 0) === 328; })()',
  );
  const presetSize = await execute(`
    const preset = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.trim() === '15m');
    return getComputedStyle(preset).fontSize;
  `);
  assert.equal(presetSize, "10px", "Focus presets must retain canonical typography in WebView2");
  await transition(
    "Focus Settings to Focus",
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Done")',
    'Boolean(document.querySelector("[data-surface=\\"focus\\"]")) && Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("Edit durations"))',
  );
  await transition(
    "Focus to Home",
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Back to Home"))',
    'Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Open Otto settings"))',
  );
}

try {
  await start();
  await audit();
  console.log("PASS: native transition matrix");
} catch (error) {
  console.error("FAIL: native transition matrix", error);
  process.exitCode = 1;
} finally {
  if (session) {
    try {
      await call("DELETE", endpoint());
    } catch {}
  }
  if (driver) {
    const pid = driver.pid;
    driver.kill();
    if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  }
  rmSync(profile, { recursive: true, force: true });
  if (visual.enabled) console.log(`Private WebDriver snapshots: ${visual.directory}`);
}
