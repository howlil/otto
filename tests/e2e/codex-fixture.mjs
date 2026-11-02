import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const gate = process.env.OTTO_E2E_GATE;
const thread = 'otto-e2e-thread';
let turnNumber = 0;

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function notify(method, turnId, params) {
  send({ method, params: { threadId: thread, turnId, ...params } });
}

function finish(turnId) {
  notify('item/agentMessage/delta', turnId, { delta: ' OTTO_FINAL_CHUNK' });
  notify('item/completed', turnId, {
    item: { type: 'agentMessage', text: 'OTTO_FIRST_CHUNK OTTO_FINAL_CHUNK' },
  });
  notify('turn/completed', turnId, { turn: { id: turnId, status: 'completed' } });
}

function onFrame(frame) {
  if (frame.id === undefined || typeof frame.method !== 'string') return;
  const { id, method, params = {} } = frame;
  if (method === 'initialize') return send({ id, result: {} });
  if (method === 'account/read') return send({ id, result: { account: { type: 'chatgpt' } } });
  if (method === 'config/read') return send({ id, result: { config: { model: 'otto-e2e-model' } } });
  if (method === 'model/list') {
    return send({ id, result: { data: [{
      model: 'otto-e2e-model', displayName: 'Otto E2E', isDefault: true,
      hidden: false, inputModalities: ['text'], supportedReasoningEfforts: [],
    }] } });
  }
  if (method === 'thread/start') {
    if (params.sandbox !== 'read-only' || params.approvalPolicy !== 'never') {
      return send({ id, error: { code: -32001, message: 'Chat requests must be read-only' } });
    }
    return send({ id, result: {
      thread: { id: thread }, sandbox: { type: 'readOnly' }, approvalPolicy: 'never',
    } });
  }
  if (method === 'turn/start') {
    if (params.threadId !== thread || params.sandboxPolicy?.type !== 'readOnly') {
      return send({ id, error: { code: -32002, message: 'Invalid turn policy' } });
    }
    const turnId = `otto-e2e-turn-${++turnNumber}`;
    send({ id, result: { turn: { id: turnId } } });
    notify('item/agentMessage/delta', turnId, { delta: 'OTTO_FIRST_CHUNK' });
    if (!gate) return finish(turnId);
    writeFileSync(`${gate}.ready`, turnId, { flag: 'w' });
    const check = setInterval(() => {
      if (!existsSync(`${gate}.release`)) return;
      clearInterval(check);
      finish(turnId);
    }, 25);
    check.unref();
    return;
  }
  if (method === 'turn/interrupt') {
    send({ id, result: {} });
    return;
  }
  send({ id, error: { code: -32601, message: `Unrecognized method ${method}` } });
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  try {
    onFrame(JSON.parse(line));
  } catch {
    process.exitCode = 2;
    input.close();
  }
});
