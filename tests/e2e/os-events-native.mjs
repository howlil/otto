import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

if (process.platform !== "win32") throw new Error("OS event acceptance requires Windows");
const root = resolve(import.meta.dirname, "../..");
const app = resolve(process.env.OTTO_E2E_APP || join(root, "src-tauri/target/debug/otto.exe"));
const signalScript = join(root, "scripts/os-events-signal.ps1");
const port = Number(process.env.OTTO_E2E_PORT || 4542);
const network = process.env.OTTO_E2E_NETWORK === "1";
const strictFocus = process.env.OTTO_E2E_STRICT_FOCUS === "1";
const temp = mkdtempSync(join(tmpdir(), "otto-os-events-"));
let server;
let session;
let driverOutput = "";
let driverError = null;
let volumeNeedsRestore = false;
let brightnessRestore = null;
let wifiProfile = null;
let wifiDisconnected = false;
let focusPid = null;
const seen = new Set();
const report = [];

function collect(chunk) {
  driverOutput = (driverOutput + String(chunk)).slice(-6000);
}

function available(name) {
  return (
    spawnSync("where.exe", [name], { encoding: "utf8" }).status === 0 ||
    existsSync(join(root, "tests/e2e/bin", name))
  );
}

function signal(action, extra = []) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      signalScript,
      "-Action",
      action,
      ...extra,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`signal ${action} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
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
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timeout: ${label}${last ? ` — ${last.message}` : ""}`);
}

const endpoint = (path = "") => `/session/${session}${path}`;

async function find(xpath) {
  const value = await call("POST", endpoint("/element"), { using: "xpath", value: xpath });
  return value["element-6066-11e4-a52e-4f735466cecf"];
}

async function click(xpath) {
  const id = await until(`button ${xpath}`, () => find(xpath));
  await call("POST", endpoint(`/element/${id}/click`), {});
}

async function state() {
  return call("POST", endpoint("/execute/sync"), {
    script: `const el = document.querySelector("[data-os-event]");
      const toggle = [...document.querySelectorAll("label")].find((item) =>
        item.innerText.includes("Show OS events"),
      )?.querySelector("input[type=checkbox]");
      return {
        width: innerWidth,
        height: innerHeight,
        outerWidth: outerWidth,
        dpr: devicePixelRatio,
        screenWidth: screen.width,
        event: el?.dataset.osEvent ?? null,
        surface: el?.dataset.surface ?? null,
        text: el?.innerText ?? "",
        focused: document.hasFocus(),
        osEventsEnabled: toggle?.checked ?? null,
      };`,
    args: [],
  });
}

async function waitEvent(kind, timeout) {
  await until(`${kind} capsule`, async () => {
    const current = await state();
    if (current.event) seen.add(current.event);
    return current.event === kind ? current : null;
  }, timeout);
  await new Promise((done) => setTimeout(done, 700));
  const value = await until(`${kind} settled surface`, async () => {
    const first = await state();
    if (first.event !== kind || first.width !== 234 || first.height !== 52) return null;
    await new Promise((done) => setTimeout(done, 150));
    const second = await state();
    return second.event === kind && second.width === 234 && second.height === 52 ? second : null;
  }, 4000);
  assert.equal(value.surface, "os-event", `${kind} native surface`);
  return value;
}

async function waitDismissed(label, timeout = 8000) {
  await until(label, async () => {
    const current = await state();
    return current.event === null && current.width === 92 && current.height === 42;
  }, timeout);
}

async function toggleOsEvents() {
  await focusOtto();
  await click('//button[.//span[normalize-space(.)="Open Otto settings"]]');
  await until(
    "global settings",
    async () => {
      const current = await state();
      return current.surface === "homeSettings" && current.osEventsEnabled !== null;
    },
  );
  const toggle = '//label[.//strong[normalize-space(.)="Show OS events"]]';

  if (!(await state()).osEventsEnabled) {
    await click(toggle);
    await until("OS events enabled baseline", async () => (await state()).osEventsEnabled === true);
  }
  await click(toggle);
  await until("OS events disabled", async () => (await state()).osEventsEnabled === false);
  await new Promise((done) => setTimeout(done, 250));
  volumeNeedsRestore = true;
  signal("volume-mute");
  await new Promise((done) => setTimeout(done, 1800));
  assert.equal((await state()).event, null, "disabled OS events still rendered a capsule");

  await click(toggle);
  await until("OS events re-enabled", async () => (await state()).osEventsEnabled === true);
  await new Promise((done) => setTimeout(done, 250));
  signal("volume-mute");
  await waitEvent("volume", 8000);
  await waitDismissed("toggle re-enable auto-dismiss");
  signal("volume-mute");
  volumeNeedsRestore = false;
  await click('//button[.//span[normalize-space(.)="Back to Home"]]');
  await until("compact Home after settings", async () => {
    const current = await state();
    return current.surface === "idle" || current.surface === "home";
  });
  note("PASS", "OS event toggle", "disable suppresses native publication and enable restores the capsule");
}

async function start() {
  server = spawn("tauri-driver", ["--port", String(port), "--native-port", String(port + 1)], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: join(root, "tests/e2e/bin") + delimiter + process.env.PATH },
  });
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.on("error", (error) => {
    driverError = error;
  });
  try {
    await until("tauri-driver", async () => {
      if (driverError) throw driverError;
      if (server.exitCode !== null) throw new Error("tauri-driver exited");
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
  } catch (error) {
    throw new Error(
      `WebDriver session startup failed: ${String(error)}${driverOutput ? `\nDriver output (tail):\n${driverOutput}` : ""}`,
      { cause: error },
    );
  }
}

function note(status, label, detail) {
  report.push({ status, label, detail });
  console.log(`${status}: ${label} — ${detail}`);
}

function activateOtto() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$p = Get-Process otto -ErrorAction Stop | Select-Object -First 1; (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null; $p.Id",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return result.status === 0;
}

async function focusOtto() {
  if (!activateOtto()) return false;
  try {
    await until("Otto foreground", async () => signal("foreground").process?.toLowerCase() === "otto", 5000);
    return true;
  } catch {
    return false;
  }
}

function focusAnotherWindow() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$p = Start-Process notepad.exe -PassThru; for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 250; $p.Refresh(); if ($p.MainWindowHandle -ne 0) { break } }; (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null; $p.Id",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) return null;
  const pid = Number(result.stdout.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function volume() {
  await focusOtto();
  const beforeState = await state();
  const before = signal("foreground");
  volumeNeedsRestore = true;
  signal("volume-mute");
  const shown = await waitEvent("volume", 8000);
  assert.match(shown.text, /Volume|Muted/);
  const after = signal("foreground");
  const focusedWhileShown = shown.focused;
  const focusedBefore = beforeState.focused;
  await waitDismissed("volume auto-dismiss");
  signal("volume-mute");
  volumeNeedsRestore = false;
  await waitDismissed("restored volume state", 8000);

  if (before.process && before.process.toLowerCase() !== "otto") {
    assert.notEqual(after.process?.toLowerCase(), "otto", "OS event stole foreground focus");
    if (strictFocus) {
      assert.equal(after.process, before.process, "OS event changed the foreground window");
      assert.equal(focusedWhileShown, focusedBefore, "OS event changed the WebView focus state");
    }
    note("PASS", "volume", "Core Audio mute event, 234x52 native surface, Otto did not take focus");
  } else {
    note(
      "PASS",
      "volume",
      "Core Audio mute event, 234x52 native surface; focus check skipped because the trigger requires Otto foreground",
    );
  }
}

async function volumeClickDismiss() {
  await focusOtto();
  volumeNeedsRestore = true;
  signal("volume-mute");
  await waitEvent("volume", 8000);
  await click('//*[@data-os-event]');
  await waitDismissed("click dismiss");
  signal("volume-mute");
  volumeNeedsRestore = false;
  await waitDismissed("restored volume state", 8000);
  note("PASS", "volume dismiss", "pointer activation dismisses the capsule to the previous Compact surface");
}

async function brightness() {
  const current = signal("brightness-get");
  if (!current.supported) {
    note("SKIP", "brightness", "no WMI brightness source on this machine");
    return;
  }
  const previous = current.level;
  const target = previous >= 50 ? previous - 10 : previous + 10;
  brightnessRestore = previous;
  focusPid = focusAnotherWindow();
  if (focusPid) {
    try {
      await until("focus target", async () => signal("foreground").process === "notepad", 5000);
    } catch {
      const stale = focusPid;
      focusPid = null;
      spawnSync("taskkill.exe", ["/PID", String(stale), "/F"], { windowsHide: true });
    }
  }
  const beforeState = await state();
  const before = signal("foreground");
  signal("brightness-set", ["-Level", String(target)]);
  const shown = await waitEvent("brightness", 20000);
  const after = signal("foreground");
  const focusedWhileShown = shown.focused;
  const focusedBefore = beforeState.focused;
  assert.match(shown.text, /Brightness/);
  assert.match(shown.text, /\d+%/);
  signal("brightness-set", ["-Level", String(previous)]);
  brightnessRestore = null;
  await waitDismissed("brightness restored", 12000);
  if (before.process && before.process.toLowerCase() !== "otto") {
    assert.notEqual(
      after.process?.toLowerCase(),
      "otto",
      "OS event stole foreground focus",
    );
    if (strictFocus || before.process === "notepad") {
      assert.equal(after.process, before.process, "OS event changed the foreground window");
      assert.equal(focusedWhileShown, focusedBefore, "OS event changed the WebView focus state");
      note("PASS", "brightness", `native ${previous} -> ${target} with focus unchanged on ${before.process}`);
    } else {
      note(
        "PASS",
        "brightness",
        `native ${previous} -> ${target}; foreground ${before.process} -> ${after.process}, Otto did not take focus`,
      );
    }
  } else {
    note("PASS", "brightness", `native ${previous} -> ${target} reached the capsule`);
  }
}

async function wifi() {
  if (!network) {
    note("SKIP", "wifi", "set OTTO_E2E_NETWORK=1 to allow a real disconnect/reconnect");
    return;
  }
  const probe = signal("probe");
  if (!probe.wifi?.connected) {
    note("SKIP", "wifi", "no connected wireless interface");
    return;
  }
  wifiProfile = probe.wifi.profile ?? probe.wifi.ssid;
  const disconnect = signal("wifi-disconnect");
  if (!disconnect.disconnected) {
    note("SKIP", "wifi", `disconnect was not observed (${disconnect.reason ?? "unknown"})`);
    return;
  }
  wifiDisconnected = true;
  const shown = await waitEvent("wifi", 15000);
  assert.match(shown.text, /Wi-Fi/);
  assert.match(shown.text, /Disconnected/);
  const reconnect = signal("wifi-reconnect", ["-Profile", wifiProfile]);
  wifiDisconnected = !reconnect.connected;
  await waitDismissed("wifi restored", 12000);
  assert.equal(wifiDisconnected, false, "Wi-Fi did not reconnect");
  note("PASS", "wifi", "real disconnect and reconnect reached the capsule");
}

async function batteryAndPeripherals(probe) {
  if (seen.has("battery")) {
    note("PASS", "battery observed", "a real power transition rendered during the run");
  } else if (probe.battery) {
    note(
      "MANUAL",
      "battery transition",
      "unplug and replug AC while Otto runs; no synthetic battery state is emitted",
    );
  } else {
    note("SKIP", "battery", "no battery on this machine");
  }
  if ((probe.bluetoothPaired ?? 0) > 0) {
    note(
      "MANUAL",
      "bluetooth peripheral",
      `${probe.bluetoothPaired} paired devices; connect/disconnect one while Otto runs`,
    );
  } else {
    note("SKIP", "bluetooth peripheral", "no paired Bluetooth device");
  }
}

try {
  assert.ok(existsSync(app), `Build the debug Tauri binary first: ${app}`);
  for (const name of ["node.exe", "tauri-driver.exe", "msedgedriver.exe"]) {
    assert.ok(available(name), `${name} must be installed on PATH`);
  }
  assert.ok(existsSync(signalScript), "Signal helper is missing");
  const running = spawnSync("tasklist.exe", ["/FI", "IMAGENAME eq otto.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  }).stdout;
  assert.ok(
    !/otto\.exe/i.test(running),
    "Another Otto instance is running; close it before the native acceptance test",
  );
  const probe = signal("probe");
  await start();
  await until("compact Home", async () => (await state()).width === 92, 30000);

  if (probe.audio) await toggleOsEvents();
  else note("SKIP", "OS event toggle", "no active audio endpoint to prove publication suppression");
  if (probe.audio) {
    await volume();
    await volumeClickDismiss();
  } else {
    note("SKIP", "volume", "no active audio endpoint");
  }
  await brightness();
  await wifi();
  await batteryAndPeripherals(probe);

  const failures = report.filter((entry) => entry.status === "FAIL");
  const passed = report.filter((entry) => entry.status === "PASS");
  console.log(
    `\nOS event native acceptance: ${passed.length} passed, ${failures.length} failed, ` +
      `${report.filter((entry) => entry.status === "SKIP").length} skipped, ` +
      `${report.filter((entry) => entry.status === "MANUAL").length} manual`,
  );
  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error("FAIL: OS event native acceptance", error);
  process.exitCode = 1;
} finally {
  if (volumeNeedsRestore) {
    try {
      signal("volume-mute");
    } catch {}
  }
  if (brightnessRestore !== null) {
    try {
      signal("brightness-set", ["-Level", String(brightnessRestore)]);
    } catch {}
  }
  if (wifiDisconnected && wifiProfile) {
    try {
      signal("wifi-reconnect", ["-Profile", wifiProfile]);
    } catch {}
  }
  if (focusPid) {
    spawnSync("taskkill.exe", ["/PID", String(focusPid), "/F"], { windowsHide: true });
  }
  if (session) {
    try {
      await call("DELETE", endpoint());
    } catch {}
  }
  if (server) {
    const pid = server.pid;
    server.kill();
    if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  }
  rmSync(temp, { recursive: true, force: true });
}
