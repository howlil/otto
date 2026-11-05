import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { runPreflight } from './preflight.mjs';

if (process.platform !== 'win32') throw new Error('P8 native E2E requires Windows');
const root = resolve(import.meta.dirname, '../..');
const app = resolve(process.env.OTTO_E2E_APP || join(root, 'src-tauri/target/debug/otto.exe'));
const temp = mkdtempSync(join(tmpdir(), 'otto-p8-'));
const gate = join(temp, 'stream');
const port = Number(process.env.OTTO_E2E_PORT || 4540);
let server;
let session;
let driverOutput = '';
let driverError = null;

function collectDriverOutput(chunk) {
  driverOutput = (driverOutput + String(chunk)).slice(-6000);
}

function available(name) {
  return spawnSync('where.exe', [name], { encoding: 'utf8' }).status === 0;
}
function runningInstances() {
  const result = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq otto.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith('"otto.exe"'))
    .map((line) => line.split('","')[1]?.replaceAll('"', '') ?? '');
}
function startupDiagnosis() {
  const instances = runningInstances();
  if (instances.length === 0) {
    return '\nNo Otto process is running; the app exited during WebDriver startup.';
  }
  return (
    '\nOtto is already running (PID ' +
    instances.join(', ') +
    '). The installed single-instance guard makes a second process exit before Tauri ' +
    'creates a window, so WebDriver never gets a session. Close Otto and rerun.'
  );
}
async function call(method, path, data, timeout = 10000) {
  const response = await fetch('http://127.0.0.1:' + port + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(timeout),
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error)
    throw new Error(method + ' ' + path + ': ' + JSON.stringify(payload.value).slice(0, 500));
  return payload.value;
}
const shell = available('pwsh.exe') ? 'pwsh.exe' : 'powershell.exe';
const focusShell = available('powershell.exe') ? 'powershell.exe' : shell;
const foregroundProbe = `
Add-Type -Namespace OttoFocus -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
'@
[OttoFocus.Native]::GetForegroundWindow().ToInt64()
`;
const focusHolderScript = `
param([string]$ReadyFile)
$ErrorActionPreference = 'Stop'
[System.IO.File]::WriteAllText($ReadyFile + '.phase', 'starting')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace OttoFocus -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
'@
[System.IO.File]::WriteAllText($ReadyFile + '.phase', 'native-loaded')
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Otto focus probe'
$form.Width = 320
$form.Height = 120
$form.TopMost = $true
$form.Show()
[System.Windows.Forms.Application]::DoEvents()
[System.IO.File]::WriteAllText($ReadyFile + '.phase', 'form-shown')
$form.Activate()
$form.BringToFront()
[System.IO.File]::WriteAllText($ReadyFile + '.phase', 'activated')
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  [System.Windows.Forms.Application]::DoEvents()
  if ([OttoFocus.Native]::GetForegroundWindow() -eq $form.Handle) { break }
  Start-Sleep -Milliseconds 100
}
[System.IO.File]::WriteAllText($ReadyFile, ("handle={0} foreground={1}" -f $form.Handle.ToInt64(), [OttoFocus.Native]::GetForegroundWindow().ToInt64()))
$expires = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $expires -and -not $form.IsDisposed) {
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 50
}
$form.Close()
`;
let focusHolder = null;

function powershell(script) {
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(shell + ' failed: ' + String(result.stderr).trim());
  return String(result.stdout).trim();
}

function foregroundWindow() {
  return powershell(foregroundProbe);
}

async function takeForeground() {
  const script = join(temp, 'focus-holder.ps1');
  const ready = join(temp, 'focus-holder.ready');
  writeFileSync(script, focusHolderScript);
  focusHolder = spawn(focusShell, ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', script, '-ReadyFile', ready], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let error = null;
  focusHolder.stdout.on('data', (chunk) => {
    output = (output + String(chunk)).slice(-2000);
  });
  focusHolder.stderr.on('data', (chunk) => {
    output = (output + String(chunk)).slice(-2000);
  });
  focusHolder.on('error', (cause) => {
    error = cause;
  });

  const deadline = Date.now() + 20000;
  let match = null;
  while (Date.now() < deadline) {
    if (existsSync(ready)) {
      match = /handle=(\d+) foreground=(\d+)/.exec(readFileSync(ready, 'utf8'));
      if (match) break;
    }
    if (error || focusHolder.exitCode !== null) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!match) {
    throw new Error(
      'Focus holder failed to initialize: ' +
      (error?.message ?? ('exit=' + focusHolder.exitCode)) +
      ', phase=' + (existsSync(ready + '.phase') ? readFileSync(ready + '.phase', 'utf8') : 'not-started') +
      ', runtime=' + focusShell +
      (output ? '\nPowerShell: ' + output : ''),
    );
  }
  assert.equal(match[2], match[1], 'the focus probe window must own the foreground');
  return match[1];
}

function releaseForeground() {
  if (!focusHolder) return;
  const pid = focusHolder.pid;
  focusHolder.kill();
  if (pid) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  focusHolder = null;
}

async function until(label, predicate, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { last = error; }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Timeout: ' + label + (last ? ' — ' + last.message : ''));
}
const endpoint = (path = '') => '/session/' + session + path;
async function find(xpath) {
  const value = await call('POST', endpoint('/element'), { using: 'xpath', value: xpath });
  return value['element-6066-11e4-a52e-4f735466cecf'];
}
async function click(xpath) {
  const id = await until('button ' + xpath, () => find(xpath));
  await call('POST', endpoint('/element/' + id + '/click'), {});
}
async function type(xpath, text) {
  const id = await until('input ' + xpath, () => find(xpath));
  await call('POST', endpoint('/element/' + id + '/value'), { text, value: Array.from(text) });
}
async function ui() {
  return call('POST', endpoint('/execute/sync'), {
    script: "return {status: document.querySelector('[data-surface=\"agent\"]')?.dataset.status ?? null, transcript: document.querySelector('[role=\"log\"]')?.innerText ?? ''};",
    args: [],
  });
}
async function snapshot() {
  const result = await call('POST', endpoint('/execute/async'), {
    script: "const done=arguments[arguments.length-1];const api=window.__TAURI_INTERNALS__;if(!api?.invoke)return done({error:'IPC missing'});api.invoke('agent_snapshot').then(done,e=>done({error:String(e)}));",
    args: [],
  });
  assert.ok(!result.error, String(result.error));
  return result;
}
async function savedConversations() {
  const result = await call('POST', endpoint('/execute/async'), {
    script: "const done=arguments[arguments.length-1];const api=window.__TAURI_INTERNALS__;api.invoke('agent_history_list').then(done,e=>done({error:String(e)}));",
    args: [],
  });
  if (!Array.isArray(result)) throw new Error('History list failed: ' + JSON.stringify(result));
  return result;
}
async function start() {
  runPreflight(root);
  server = spawn('tauri-driver', ['--port', String(port), '--native-port', String(port + 1)], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: join(root, 'tests/e2e/bin') + delimiter + process.env.PATH,
      OTTO_E2E_GATE: gate,
    },
  });
  server.stdout.on('data', collectDriverOutput);
  server.stderr.on('data', collectDriverOutput);
  server.on('error', (error) => { driverError = error; });
  try {
    await until('tauri-driver', async () => {
      if (driverError) throw driverError;
      if (server.exitCode !== null) throw new Error('tauri-driver exited');
      try { return (await call('GET', '/status'))?.ready; } catch { return false; }
    });
    const created = await call('POST', '/session', {
      capabilities: { alwaysMatch: {
        browserName: 'wry', 'tauri:options': { application: app },
      } },
    }, 90000);
    session = created.sessionId;
    assert.ok(session, 'Missing WebDriver session');
  } catch (error) {
    throw new Error(
      'WebDriver session startup failed: ' +
      String(error) +
      startupDiagnosis() +
      (driverOutput ? '\nDriver output (tail):\n' + driverOutput : '\nNo driver output captured.'),
      { cause: error },
    );
  }
}
async function p8() {
  const home = '//button[contains(., "Return to Home")]';
  const agent = '//button[.//strong[normalize-space()="Agent"]]';
  await click('//button[contains(., "Open Otto")]');
  await click(agent);
  await type('//*[@id="otto-prompt"]', 'Deterministic streaming test');
  await until('provider ready', async () => {
    const id = await find('//button[contains(., "Send prompt")]');
    return call('GET', endpoint('/element/' + id + '/enabled'));
  });
  await click('//button[contains(., "Send prompt")]');
  await until('first delta', async () => {
    const x = await ui();
    return x.status === 'streaming' && x.transcript.includes('OTTO_FIRST_CHUNK');
  });
  const first = await snapshot();
  assert.ok(first.runId > 0);
  assert.equal(first.status, 'streaming');
  assert.equal(first.provider, 'codex');
  await until('fixture holds completion', () => existsSync(gate + '.ready'));
  await click(home);
  await until('Home navigation', async () => (await ui()).status === null);
  await click(agent);
  const reopened = await until('streaming restored', async () => {
    const x = await ui();
    return x.status === 'streaming' && x.transcript.includes('OTTO_FIRST_CHUNK') && x;
  });
  assert.ok(!reopened.transcript.includes('OTTO_FINAL_CHUNK'));
  const resumed = await snapshot();
  assert.equal(resumed.runId, first.runId);
  assert.equal(resumed.threadId, first.threadId);
  await click(home);
  const heldForeground = await takeForeground();
  writeFileSync(gate + '.release', 'release');
  await until('background completion without navigation', async () => {
    const x = await snapshot();
    assert.equal((await ui()).status, null);
    return x.status === 'completed';
  });
  assert.equal(
    foregroundWindow(),
    heldForeground,
    'a background completion must not take keyboard focus',
  );
  await click('//button[contains(., "Open Otto")]');
  await click(agent);
  await until('completed answer visible', async () => {
    const x = await ui();
    return x.status === 'completed' && x.transcript.includes('OTTO_FINAL_CHUNK');
  });
  const done = await snapshot();
  assert.equal(done.runId, first.runId);
  assert.equal(done.threadId, first.threadId);
  assert.equal(done.messages.filter((m) => m.role === 'assistant').length, 1);
  assert.equal(done.messages.at(-1).text, 'OTTO_FIRST_CHUNK OTTO_FINAL_CHUNK');
  await until('completed chat persisted in local history', async () =>
    (await savedConversations()).some((record) => record.id === done.conversationId),
  );
  await click('//button[.//span[normalize-space()="Conversation history"]]');
  await until('saved history row ready', async () => {
    const id = await find('//li/button[.//span[normalize-space()="Deterministic streaming test"]]');
    return call('GET', endpoint('/element/' + id + '/enabled'));
  });
  await click('//li/button[.//span[normalize-space()="Deterministic streaming test"]]');
  const restored = await until('history restored through production UI', async () => {
    const current = await snapshot();
    const rendered = await ui();
    return current.conversationId === done.conversationId &&
      current.threadId === null &&
      current.messages.at(-1)?.text === 'OTTO_FIRST_CHUNK OTTO_FINAL_CHUNK' &&
      rendered.transcript.includes('OTTO_FINAL_CHUNK') && current;
  });
  assert.notEqual(restored.runId, done.runId);
}
try {
  assert.ok(existsSync(app), 'Build the debug Tauri binary first: ' + app);
  for (const name of ['node.exe', 'tauri-driver.exe', 'msedgedriver.exe', shell])
    assert.ok(available(name), name + ' must be installed on PATH');
  const existing = runningInstances();
  if (existing.length > 0) throw new Error(startupDiagnosis().trim());
  await start();
  await p8();
  console.log('PASS: P8 native background continuity and focus hold');
} catch (error) {
  console.error('FAIL: P8 native background continuity', error);
  process.exitCode = 1;
} finally {
  releaseForeground();
  if (session) try { await call('DELETE', endpoint()); } catch {}
  if (server) {
    const pid = server.pid;
    server.kill();
    if (pid) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  }
  rmSync(temp, { recursive: true, force: true });
}
