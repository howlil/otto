import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const DRIVER_PORT = 4540;
export const NATIVE_PORT = 4541;
export const TAURI_DRIVER_VERSION = "2.0.6";

export function majorMinor(text) {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text ?? ""));
  return match ? `${match[1]}.${match[2]}` : null;
}

export function evaluatePreflight(facts) {
  const blockers = [];
  if (facts.platform !== "win32") {
    blockers.push("P8 native E2E requires Windows (current platform: " + facts.platform + ").");
  }
  if (!facts.appExists) {
    blockers.push(
      "Debug executable is missing: " + facts.appPath + ". Run: bun run tauri build --debug --no-bundle",
    );
  } else if (facts.appMtimeMs < facts.sourceMtimeMs) {
    blockers.push(
      "Debug executable is older than src-tauri sources. Rebuild it: bun run tauri build --debug --no-bundle",
    );
  }
  if (!facts.distExists) {
    blockers.push("Frontend bundle is missing: " + facts.distPath + ". Run: bun run build");
  }
  if (!facts.tauriDriver) {
    blockers.push(
      "tauri-driver is not on PATH. Run: cargo install tauri-driver --version " +
        TAURI_DRIVER_VERSION +
        " --locked",
    );
  }
  if (!facts.webviewVersion) {
    blockers.push("WebView2 runtime version could not be detected; install the Edge WebView2 runtime.");
  }
  if (!facts.edgeDriverVersion) {
    blockers.push(
      "msedgedriver is not on PATH. Install the driver matching WebView2 " +
        (facts.webviewVersion ?? "<unknown>") +
        ".",
    );
  } else if (
    facts.webviewVersion &&
    majorMinor(facts.edgeDriverVersion) !== majorMinor(facts.webviewVersion)
  ) {
    blockers.push(
      "msedgedriver " +
        facts.edgeDriverVersion +
        " does not match WebView2 " +
        facts.webviewVersion +
        ". Install edgedriver_win64.zip for " +
        facts.webviewVersion +
        ".",
    );
  }
  if (facts.running.length > 0) {
    blockers.push(
      "Otto is already running (PID " +
        facts.running.join(", ") +
        "). The single-instance guard exits the second process, so WebDriver never gets a session.",
    );
  }
  const busy = facts.busyPorts ?? [];
  if (busy.length > 0) {
    blockers.push(
      "WebDriver ports are already in use: " +
        busy.join(", ") +
        ". Stop the stale tauri-driver/msedgedriver process first.",
    );
  }
  return blockers;
}

export function formatBlockers(blockers) {
  return blockers.map((blocker, index) => `${index + 1}. ${blocker}`).join("\n");
}

function newestModification(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    newest = Math.max(newest, newestModification(join(path, entry.name)));
  }
  return newest;
}

function firstLine(result) {
  const text = String(result.stdout ?? "") + String(result.stderr ?? "");
  return text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
}

function commandVersion(name, args) {
  const result = spawnSync(name, args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) return null;
  return firstLine(result).trim() || null;
}

function webviewRuntimeVersion() {
  const roots = [
    join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft/EdgeWebView/Application"),
    join(process.env.ProgramFiles ?? "", "Microsoft/EdgeWebView/Application"),
  ];
  const versions = [];
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name)) versions.push(entry.name);
    }
  }
  versions.sort((left, right) => {
    const a = left.split(".").map(Number);
    const b = right.split(".").map(Number);
    for (let index = 0; index < 4; index += 1) {
      if (a[index] !== b[index]) return b[index] - a[index];
    }
    return 0;
  });
  return versions[0] ?? null;
}

function processIds(imageName) {
  const result = spawnSync(
    "tasklist.exe",
    ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true },
  );
  return String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith(`"${imageName.toLowerCase()}"`))
    .map((line) => line.split('","')[1]?.replaceAll('"', "") ?? "")
    .filter(Boolean);
}

function portBusy(port) {
  const result = spawnSync("netstat.exe", ["-ano", "-p", "TCP"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return String(result.stdout ?? "")
    .split(/\r?\n/)
    .some((line) => line.includes(`:${port} `) && /LISTENING/i.test(line));
}

export function collectFacts(root) {
  const appPath = resolve(process.env.OTTO_E2E_APP || join(root, "src-tauri/target/debug/otto.exe"));
  const distPath = join(root, "dist");
  const busyPorts = [DRIVER_PORT, NATIVE_PORT].filter((port) => portBusy(port));
  return {
    platform: process.platform,
    appPath,
    distPath,
    appExists: existsSync(appPath),
    appMtimeMs: existsSync(appPath) ? statSync(appPath).mtimeMs : 0,
    sourceMtimeMs: Math.max(
      newestModification(join(root, "src-tauri/src")),
      newestModification(join(root, "src-tauri/tauri.conf.json")),
      newestModification(join(root, "src-tauri/Cargo.toml")),
    ),
    distExists: existsSync(join(distPath, "index.html")),
    tauriDriver: commandVersion("tauri-driver", ["--help"]),
    webviewVersion: webviewRuntimeVersion(),
    edgeDriverVersion: commandVersion("msedgedriver", ["--version"]),
    running: processIds("otto.exe"),
    driver: processIds("tauri-driver.exe"),
    busyPorts,
  };
}

export function runPreflight(root) {
  const blockers = evaluatePreflight(collectFacts(root));
  if (blockers.length > 0) {
    throw new Error("Native E2E preflight failed:\n" + formatBlockers(blockers));
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(import.meta.dirname, "../..");
  const blockers = evaluatePreflight(collectFacts(root));
  if (blockers.length > 0) {
    console.error("Native E2E preflight failed:\n" + formatBlockers(blockers));
    process.exit(1);
  }
  console.log("Native E2E preflight passed.");
}
