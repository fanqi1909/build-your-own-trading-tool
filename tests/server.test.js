'use strict';
// Integration tests — spawns server.js as child process
// Requires: OKX CLI available, port 3000 free

const { test, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const { spawn } = require('child_process');
const http    = require('http');
const WebSocket = require('ws');
const path    = require('path');

const ROOT    = path.join(__dirname, '..');
const BASE    = 'http://localhost:3000';
const WS_URL  = 'ws://localhost:3000';

let serverProc;

before(async () => {
  serverProc = spawn('node', ['server.js'], {
    cwd:   ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 等服务器打印"初始化完成"再开始测试
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('server start timeout (30s)')), 30000
    );
    serverProc.stdout.on('data', chunk => {
      if (chunk.toString().includes('初始化完成')) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProc.stderr.on('data', chunk => process.stderr.write(chunk));
    serverProc.on('error', reject);
  });
}, { timeout: 35000 });

after(() => {
  serverProc?.kill();
});

// ─── HTTP ──────────────────────────────────────────────
test('HTTP: GET / returns 200', async () => {
  const status = await new Promise((resolve, reject) =>
    http.get(BASE, res => resolve(res.statusCode)).on('error', reject)
  );
  assert.equal(status, 200);
});

// ─── WebSocket: 连接后自动推送 ─────────────────────────
test('WS: receives ticker with numeric last price', { timeout: 15000 }, async () => {
  const msg = await firstMsg(m => m.type === 'ticker');
  assert.ok(msg.data?.last, 'ticker.data.last should exist');
  assert.ok(parseFloat(msg.data.last) > 0, 'last price > 0');
});

test('WS: receives snapshot with balance and positions arrays', { timeout: 15000 }, async () => {
  const msg = await firstMsg(m => m.type === 'snapshot');
  assert.ok(Array.isArray(msg.data.balance),   'balance is array');
  assert.ok(Array.isArray(msg.data.positions), 'positions is array');
});

test('WS: receives non-empty candles array', { timeout: 15000 }, async () => {
  const msg = await firstMsg(m => m.type === 'candles');
  assert.ok(Array.isArray(msg.data),    'candles.data is array');
  assert.ok(msg.data.length > 0,        'candles array is non-empty');
  const c = msg.data[0];
  for (const field of ['ts', 'o', 'h', 'l', 'c', 'vol']) {
    assert.equal(typeof c[field], 'number', `candle.${field} is number`);
  }
});

test('WS: receives analysisHistory array', { timeout: 15000 }, async () => {
  const msg = await firstMsg(m => m.type === 'analysisHistory');
  assert.ok(Array.isArray(msg.data), 'analysisHistory.data is array');
});

// ─── WebSocket: action ─────────────────────────────────
test('WS: pnlQuery returns pnlResult with total and count', { timeout: 10000 }, async () => {
  const ws = new WebSocket(WS_URL);
  await new Promise(r => ws.once('open', r));
  ws.send(JSON.stringify({ action: 'pnlQuery', window: '1d' }));

  const msg = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pnlResult timeout')), 8000);
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.type === 'pnlResult') { clearTimeout(timer); resolve(m); }
    });
  });
  ws.close();

  assert.equal(msg.window,        '1d');
  assert.equal(typeof msg.total,  'number');
  assert.equal(typeof msg.count,  'number');
});

test('WS: setMode switches to live and back to demo', { timeout: 20000 }, async () => {
  const ws = new WebSocket(WS_URL);
  await new Promise(r => ws.once('open', r));

  // → live
  ws.send(JSON.stringify({ action: 'setMode', mode: 'live' }));
  const live = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('live ticker timeout')), 15000);
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.type === 'ticker' && m.mode === 'live') { clearTimeout(timer); resolve(m); }
    });
  });
  assert.equal(live.mode, 'live');

  // → demo
  ws.send(JSON.stringify({ action: 'setMode', mode: 'demo' }));
  const demo = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('demo ticker timeout')), 15000);
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.type === 'ticker' && m.mode === 'demo') { clearTimeout(timer); resolve(m); }
    });
  });
  assert.equal(demo.mode, 'demo');

  ws.close();
});

// ─── Helper ────────────────────────────────────────────
function firstMsg(predicate, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const ws    = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timeout waiting for message matching predicate`));
    }, timeoutMs);
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (predicate(m)) { clearTimeout(timer); ws.close(); resolve(m); }
    });
    ws.on('error', reject);
  });
}
