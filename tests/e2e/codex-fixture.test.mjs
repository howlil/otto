import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';

function waitFor(check, timeoutMs = 3_000) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const run = () => {
      if (check()) return resolve();
      if (Date.now() > until) return reject(new Error('Timed out waiting for fixture event'));
      setTimeout(run, 10);
    };
    run();
  });
}

test('Codex subprocess fixture works without Otto policy overrides and gates completion', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'otto-fixture-contract-'));
  const gate = join(temp, 'run');
  const process = spawn(globalThis.process.execPath, [join(import.meta.dirname, 'codex-fixture.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...globalThis.process.env, OTTO_E2E_GATE: gate },
  });
  const received = [];
  const lines = createInterface({ input: process.stdout });
  lines.on('line', (line) => received.push(JSON.parse(line)));
  const ask = (id, method, params = {}) => process.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  try {
    ask(1, 'initialize');
    ask(2, 'account/read');
    ask(3, 'config/read');
    ask(4, 'model/list');
    await waitFor(() => received.length === 4);
    assert.equal(received[1].result.account.type, 'chatgpt');
    assert.equal(received[3].result.data[0].model, 'otto-e2e-model');
    ask(5, 'thread/start');
    await waitFor(() => received.length === 5);
    assert.equal(received[4].result.thread.id, 'otto-e2e-thread');
    assert.equal(received[4].result.sandbox, undefined);
    assert.equal(received[4].result.approvalPolicy, undefined);
    ask(6, 'turn/start', { threadId: 'otto-e2e-thread' });
    await waitFor(() => existsSync(`${gate}.ready`) && received.length >= 7);
    assert.equal(received[6].params.delta, 'OTTO_FIRST_CHUNK');
    assert.equal(received.some((frame) => frame.method === 'turn/completed'), false);
    writeFileSync(`${gate}.release`, 'release');
    await waitFor(() => received.some((frame) => frame.method === 'turn/completed'));
    assert.equal(received.at(-1).params.turn.status, 'completed');
    assert.equal(received.filter((frame) => frame.method === 'turn/completed').length, 1);
  } finally {
    process.kill();
    process.stdin.destroy();
    lines.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
