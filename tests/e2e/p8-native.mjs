import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

if (process.platform !== 'win32') throw new Error('P8 native E2E requires Windows');
const root = resolve(import.meta.dirname, '../..');
const app = resolve(process.env.OTTO_E2E_APP || join(root, 'src-tauri/target/debug/otto.exe'));
const temp = mkdtempSync(join(tmpdir(), 'otto-p8-'));
const gate = join(temp, 'stream');
const port = Number(process.env.OTTO_E2E_PORT || 4540);
let server;
let session;

function available(name) {
  return spawnSync('where.exe', [name], { encoding: 'utf8' }).status === 0;
}
async function call(method, path, data) {
  const response = await fetch('http://127.0.0.1:' + port + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error)
    throw new Error(method + ' ' + path + ': ' + JSON.stringify(payload.value).slice(0, 500));
  return payload.value;
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
async function start() {
  server = spawn('tauri-driver', ['--port', String(port), '--native-port', String(port + 1)], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PATH: join(root, 'tests/e2e/bin') + delimiter + process.env.PATH,
      OTTO_E2E_GATE: gate,
    },
  });
  server.on('error', (error) => { console.error('tauri-driver:', error.message); });
  await until('tauri-driver', async () => {
    if (server.exitCode !== null) throw new Error('tauri-driver exited');
    try { return (await call('GET', '/status'))?.ready; } catch { return false; }
  });
  const created = await call('POST', '/session', {
    capabilities: { alwaysMatch: {
      browserName: 'wry', 'tauri:options': { application: app },
    } },
  });
  session = created.sessionId;
  assert.ok(session, 'Missing WebDriver session');
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
  writeFileSync(gate + '.release', 'release');
  await until('background completion without navigation', async () => {
    const x = await snapshot();
    assert.equal((await ui()).status, null);
    return x.status === 'completed';
  });
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
}
try {
  assert.ok(existsSync(app), 'Build the debug Tauri binary first: ' + app);
  for (const name of ['node.exe', 'tauri-driver.exe', 'msedgedriver.exe'])
    assert.ok(available(name), name + ' must be installed on PATH');
  await start();
  await p8();
  console.log('PASS: P8 native background continuity');
} catch (error) {
  console.error('FAIL: P8 native background continuity', error);
  process.exitCode = 1;
} finally {
  if (session) try { await call('DELETE', endpoint()); } catch {}
  if (server) {
    const pid = server.pid;
    server.kill();
    if (pid) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  }
  rmSync(temp, { recursive: true, force: true });
}
