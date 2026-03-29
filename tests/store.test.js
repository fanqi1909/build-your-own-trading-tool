'use strict';
// Unit tests for lib/store.js — no network, no OKX CLI, no running server

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// ─── Helpers ────────────────────────────────────────────

// Override CWD-relative paths by switching process.cwd to a temp dir
let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
  process.chdir(tmpDir);
  // create data/ expected by store.js
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
});

after(() => {
  // Best-effort cleanup (DuckDB files may still be open — skip DB file cleanup)
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// Require AFTER before() so store.js sees the right cwd
let store;

// ─── parseAnalysis ───────────────────────────────────────
describe('parseAnalysis', () => {
  before(() => { store = require('../lib/store'); });

  test('extracts bull/bear counts and ATR', () => {
    const raw = '多头信号 5 / 空头信号 3\nATR 1,234.56';
    const r = store.parseAnalysis(raw);
    assert.equal(r.bull, 5);
    assert.equal(r.bear, 3);
    assert.equal(r.atr,  1234.56);
  });

  test('returns zeros and null when no match', () => {
    const r = store.parseAnalysis('no data here');
    assert.equal(r.bull, 0);
    assert.equal(r.bear, 0);
    assert.equal(r.atr,  null);
  });

  test('handles ATR without comma separator', () => {
    const raw = '多头信号 2 / 空头信号 4\nATR 98.00';
    const r = store.parseAnalysis(raw);
    assert.equal(r.atr, 98.00);
  });
});

// ─── ordersStore / upsertOrders ──────────────────────────
describe('ordersStore / upsertOrders', () => {
  test('starts empty', () => {
    assert.equal(store.ordersStore.demo.size, 0);
    assert.equal(store.ordersStore.live.size, 0);
  });

  test('upsertOrders stores and deduplicates by ordId', () => {
    const orders = [
      { ordId: 'A1', instId: 'BTC-USDT-SWAP', pnl: 10, fee: -1 },
      { ordId: 'A2', instId: 'BTC-USDT-SWAP', pnl: 20, fee: -2 },
    ];
    store.upsertOrders(orders, 'demo');
    assert.equal(store.ordersStore.demo.size, 2);

    // Update existing record
    store.upsertOrders([{ ordId: 'A1', instId: 'BTC-USDT-SWAP', pnl: 99, fee: -1 }], 'demo');
    assert.equal(store.ordersStore.demo.size, 2); // still 2
    assert.equal(store.ordersStore.demo.get('A1').pnl, 99);
  });

  test('upsertOrders writes to JSON file', () => {
    const file = path.join(tmpDir, 'data', 'orders-demo.json');
    assert.ok(fs.existsSync(file), 'file should exist after upsert');
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(arr.length, 2);
  });

  test('upsertOrders with empty array is a no-op', () => {
    const before = store.ordersStore.demo.size;
    store.upsertOrders([], 'demo');
    assert.equal(store.ordersStore.demo.size, before);
  });
});

// ─── posTrackHistory / setPosTrackModeGetter ─────────────
describe('posTrackHistories / modeGetter', () => {
  test('setPosTrackModeGetter controls which history is returned', () => {
    store.setPosTrackModeGetter(() => 'demo');
    store.posTrackHistories.demo  = [{ ts: 1, text: 'demo-entry' }];
    store.posTrackHistories.live  = [{ ts: 2, text: 'live-entry' }];

    assert.equal(store.posTrackHistory()[0].text, 'demo-entry');

    store.setPosTrackModeGetter(() => 'live');
    assert.equal(store.posTrackHistory()[0].text, 'live-entry');
  });

  test('savePosTrackHistory writes correct file', () => {
    store.setPosTrackModeGetter(() => 'demo');
    store.posTrackHistories.demo = [{ ts: 100, text: 'hello' }];
    store.savePosTrackHistory();

    const file = path.join(tmpDir, 'data', 'postrack-demo.json');
    assert.ok(fs.existsSync(file));
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(arr[0].text, 'hello');
  });

  test('savePosTrackHistory trims to 200 entries', () => {
    store.setPosTrackModeGetter(() => 'live');
    store.posTrackHistories.live = Array.from({ length: 205 }, (_, i) => ({ ts: i, text: `t${i}` }));
    store.savePosTrackHistory();
    assert.equal(store.posTrackHistories.live.length, 200);
  });
});

// ─── analysisHistory / saveAnalysisHistory ───────────────
describe('analysisHistories', () => {
  test('analysisHistory() returns current mode slice', () => {
    store.setPosTrackModeGetter(() => 'demo');
    store.analysisHistories.demo = [{ ts: 10, raw: 'x' }];
    assert.equal(store.analysisHistory()[0].ts, 10);
  });

  test('saveAnalysisHistory writes file and trims', () => {
    store.setPosTrackModeGetter(() => 'demo');
    store.analysisHistories.demo = Array.from({ length: 205 }, (_, i) => ({ ts: i, raw: 'r' }));
    store.saveAnalysisHistory();
    assert.equal(store.analysisHistories.demo.length, 200);

    const file = path.join(tmpDir, 'data', 'analysis-demo.json');
    assert.ok(fs.existsSync(file));
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(arr.length, 200);
  });
});
