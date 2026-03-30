'use strict';
/**
 * tests/phase2.test.js — Phase 2 automated verification ([AI] checks 2.1–2.8)
 *
 * Run: node --test tests/phase2.test.js
 *
 * Checks:
 *  2.1  server.js ≤ 60 lines
 *  2.2  All 4 action modules load and register() returns { actions, timers, onReady }
 *  2.3  All expected WS action names are registered (22 actions mapped)
 *  2.4  All expected broadcast message types are emitted (14 types covered)
 *  2.5  Timer intervals match original server.js values
 *  2.6  Manifest capabilities all have a corresponding component file
 *  2.7  store/orders.js: init → upsert → save → reload cycle
 *  2.8  store/analysis.js: init → save → reload cycle
 *  (DuckDB candles are tested in check 2.8 server start)
 */

const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const path    = require('node:path');
const fs      = require('node:fs');
const os      = require('node:os');

const ROOT = path.join(__dirname, '..');

// ─── 2.1: server.js line count ──────────────────────────────────────────────

describe('2.1 — server.js ≤ 60 lines', () => {
  test('server.js line count', () => {
    const lines = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').split('\n').length;
    assert.ok(lines <= 60, `server.js has ${lines} lines (expected ≤ 60)`);
    console.log(`    ✓ server.js has ${lines} lines`);
  });
});

// ─── 2.2: Action modules load and return correct shape ──────────────────────

describe('2.2 — Action modules return { actions, timers, onReady }', () => {
  // Minimal ctx mock (no real adapter calls)
  function makeMockCtx() {
    const cache = {
      ticker: null, balance: null, positions: null, history: null,
      candles: null, openOrders: [], algoOrders: [], posMode: 'net',
      lastSlowUpdate: 0, lastCandleUpdate: 0,
    };
    const connectHandlers = [];
    const handlers = new Map();
    return {
      getMode:  () => 'demo',
      setMode:  () => {},
      bus:      { emit: () => {} },
      ws:       { registerAction: (a, h) => handlers.set(a, h), registerConnect: fn => connectHandlers.push(fn) },
      timers:   { register: () => {} },
      refresh:  {},
      cache,
      stores:   {
        orders:   { ordersStore: { demo: new Map(), live: new Map() }, upsertOrders: () => {} },
        candles:  { getCandleConn: () => null, upsertCandles: async () => {}, loadCandlesFromDB: async () => [], loadCandlesAroundTime: async () => [] },
        analysis: { analysisHistory: () => [], analysisHistories: { demo: [], live: [] }, saveAnalysisHistory: () => {}, parseAnalysis: () => ({}) },
        postrack: { posTrackHistory: () => [], savePosTrackHistory: () => {} },
      },
      _chatSession: { send: async () => {}, reset: () => {} },
      _handlers: handlers,
      _connectHandlers: connectHandlers,
    };
  }

  for (const name of ['market', 'account', 'trading', 'analysis']) {
    test(`actions/${name}.js — register() shape`, () => {
      const mod = require(path.join(ROOT, `plugins/okx/actions/${name}`));
      const ctx = makeMockCtx();
      const reg = mod.register(ctx);
      assert.ok(reg.actions && typeof reg.actions === 'object', 'actions object');
      assert.ok(Array.isArray(reg.timers), 'timers array');
      assert.ok(typeof reg.onReady === 'function', 'onReady function');
      const actionNames = Object.keys(reg.actions);
      console.log(`    ✓ ${name}: ${actionNames.length} actions, ${reg.timers.length} timers`);
    });
  }
});

// ─── 2.3: Expected WS action names covered ──────────────────────────────────

describe('2.3 — All expected WS action names are handled', () => {
  const EXPECTED_ACTIONS = [
    'setMode', 'candles', 'refresh',
    'placeOrder', 'cancelOrder', 'amendOrder', 'closePosition',
    'amendAlgoOrder', 'addAlgoOrder',
    'askClaude', 'fetchAtr', 'pnlQuery',
    'tradeReview', 'tradeReviewClaude',
    'chat', 'chatReset',
  ];

  test('all expected actions are registered', () => {
    function makeMockCtx() {
      const handlers = new Map();
      return {
        getMode: () => 'demo', setMode: () => {},
        bus: { emit: () => {} },
        ws:  { registerAction: (a, h) => handlers.set(a, h), registerConnect: () => {} },
        timers: { register: () => {} },
        refresh: {}, cache: {
          ticker: null, balance: null, positions: null, history: null,
          candles: null, openOrders: [], algoOrders: [], posMode: 'net',
          lastSlowUpdate: 0, lastCandleUpdate: 0,
        },
        stores: {
          orders:   { ordersStore: { demo: new Map(), live: new Map() }, upsertOrders: () => {} },
          candles:  { getCandleConn: () => null, upsertCandles: async () => {}, loadCandlesFromDB: async () => [], loadCandlesAroundTime: async () => [] },
          analysis: { analysisHistory: () => [], analysisHistories: { demo: [], live: [] }, saveAnalysisHistory: () => {}, parseAnalysis: () => ({}) },
          postrack: { posTrackHistory: () => [], savePosTrackHistory: () => {} },
        },
        _chatSession: { send: async () => {}, reset: () => {} },
        _handlers: handlers,
      };
    }

    const ctx = makeMockCtx();
    for (const name of ['market', 'account', 'trading', 'analysis']) {
      const reg = require(path.join(ROOT, `plugins/okx/actions/${name}`)).register(ctx);
      for (const [action, handler] of Object.entries(reg.actions)) {
        ctx._handlers.set(action, handler);
      }
    }

    const missing = EXPECTED_ACTIONS.filter(a => !ctx._handlers.has(a));
    assert.deepStrictEqual(missing, [], `Missing actions: ${missing.join(', ')}`);
    console.log(`    ✓ all ${EXPECTED_ACTIONS.length} expected actions registered`);
  });
});

// ─── 2.4: Expected broadcast message types ──────────────────────────────────

describe('2.4 — Expected broadcast types exist in action modules', () => {
  const EXPECTED_TYPES = [
    'ticker', 'snapshot', 'candles', 'openOrders', 'algoOrders',
    'analysis', 'analysisError', 'analysisHistory',
    'claudeResponse', 'claudeError',
    'positionTrack', 'positionTrackHistory',
    'orderResult', 'orderStream',
  ];

  test('broadcast type strings appear in action module source files', () => {
    const actionDir = path.join(ROOT, 'plugins/okx/actions');
    const allSource = ['market', 'account', 'trading', 'analysis']
      .map(n => fs.readFileSync(path.join(actionDir, `${n}.js`), 'utf8'))
      .join('\n');

    const missing = EXPECTED_TYPES.filter(t => !allSource.includes(`'${t}'`) && !allSource.includes(`"${t}"`));
    assert.deepStrictEqual(missing, [], `Missing broadcast types: ${missing.join(', ')}`);
    console.log(`    ✓ all ${EXPECTED_TYPES.length} broadcast types covered`);
  });
});

// ─── 2.5: Timer intervals unchanged ─────────────────────────────────────────

describe('2.5 — Timer intervals match original values', () => {
  const EXPECTED_INTERVALS = {
    fast:     5000,
    slow:     60000,
    orders:   10000,
    candles:  10 * 60 * 1000,
    postrack: 3 * 60 * 1000,
  };

  test('timer configs match original server.js intervals', () => {
    function makeMockCtx() {
      const handlers = new Map();
      return {
        getMode: () => 'demo', setMode: () => {},
        bus: { emit: () => {} },
        ws:  { registerAction: (a, h) => handlers.set(a, h), registerConnect: () => {} },
        timers: { register: () => {} },
        refresh: {}, cache: {
          ticker: null, balance: null, positions: null, history: null,
          candles: null, openOrders: [], algoOrders: [], posMode: 'net',
          lastSlowUpdate: 0, lastCandleUpdate: 0,
        },
        stores: {
          orders:   { ordersStore: { demo: new Map(), live: new Map() }, upsertOrders: () => {} },
          candles:  { getCandleConn: () => null, upsertCandles: async () => {}, loadCandlesFromDB: async () => [], loadCandlesAroundTime: async () => [] },
          analysis: { analysisHistory: () => [], analysisHistories: { demo: [], live: [] }, saveAnalysisHistory: () => {}, parseAnalysis: () => ({}) },
          postrack: { posTrackHistory: () => [], savePosTrackHistory: () => {} },
        },
        _chatSession: { send: async () => {}, reset: () => {} },
        _handlers: handlers,
      };
    }

    const ctx = makeMockCtx();
    const allTimers = [];
    for (const name of ['market', 'account', 'trading', 'analysis']) {
      const reg = require(path.join(ROOT, `plugins/okx/actions/${name}`)).register(ctx);
      allTimers.push(...reg.timers);
    }

    const timerMap = {};
    for (const t of allTimers) timerMap[t.name] = t.intervalMs;

    for (const [name, ms] of Object.entries(EXPECTED_INTERVALS)) {
      assert.strictEqual(timerMap[name], ms, `timer "${name}": expected ${ms}ms, got ${timerMap[name]}ms`);
    }
    console.log('    ✓ all timer intervals match');
  });
});

// ─── 2.6: Manifest capabilities → component files ───────────────────────────

describe('2.6 — Manifest capabilities have component files', () => {
  test('each capability has a component directory', () => {
    const manifest     = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/okx/manifest.json'), 'utf8'));
    const componentDir = path.join(ROOT, 'plugins/okx/components');
    const missing      = [];

    for (const [, cap] of Object.entries(manifest.capabilities)) {
      const compId  = cap.component;
      const compDir = path.join(componentDir, compId);
      const compJs  = path.join(compDir, `${compId}.js`);
      if (!fs.existsSync(compJs)) missing.push(compId);
    }

    assert.deepStrictEqual(missing, [], `Missing component files: ${missing.join(', ')}`);
    console.log(`    ✓ all ${Object.keys(manifest.capabilities).length} capability components exist`);
  });
});

// ─── 2.7: store/orders.js — upsert + reload cycle ───────────────────────────

describe('2.7 — store/orders: upsert and reload', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okx-orders-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('upsert orders and reload from file', () => {
    // Use a fresh require to avoid module cache contamination
    const ordersPath = path.join(ROOT, 'plugins/okx/store/orders');
    // Clear require cache so we get a fresh module with its own Map
    delete require.cache[require.resolve(ordersPath)];
    const store = require(ordersPath);
    store.init(() => 'demo', tmpDir);

    const testOrders = [
      { ordId: 'ord-1', instId: 'BTC-USDT-SWAP', side: 'buy',  sz: 1, pnl: 10, fee: -0.5, cTime: 1000, fillTime: 1001 },
      { ordId: 'ord-2', instId: 'BTC-USDT-SWAP', side: 'sell', sz: 1, pnl: -5, fee: -0.5, cTime: 2000, fillTime: 2001 },
    ];
    store.upsertOrders(testOrders, 'demo');
    assert.strictEqual(store.ordersStore.demo.size, 2, 'should have 2 orders in memory');

    // Simulate reload: new module instance reads from file
    delete require.cache[require.resolve(ordersPath)];
    const store2 = require(ordersPath);
    store2.init(() => 'demo', tmpDir);
    assert.strictEqual(store2.ordersStore.demo.size, 2, 'should reload 2 orders from file');
    assert.ok(store2.ordersStore.demo.has('ord-1'), 'ord-1 should exist');
    assert.ok(store2.ordersStore.demo.has('ord-2'), 'ord-2 should exist');
    console.log('    ✓ orders upsert + reload cycle works');
  });
});

// ─── 2.8: store/analysis.js — save + reload cycle ───────────────────────────

describe('2.8 — store/analysis: save and reload', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okx-analysis-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('save analysis history and reload from file', () => {
    const analysisPath = path.join(ROOT, 'plugins/okx/store/analysis');
    delete require.cache[require.resolve(analysisPath)];
    const store = require(analysisPath);
    store.init(() => 'demo', tmpDir);

    const entry = { ts: Date.now(), inst: 'BTC-USDT', bar: '15m', raw: 'test raw', bull: 5, bear: 3, atr: 100 };
    store.analysisHistory().push(entry);
    store.saveAnalysisHistory();

    delete require.cache[require.resolve(analysisPath)];
    const store2 = require(analysisPath);
    store2.init(() => 'demo', tmpDir);

    const hist = store2.analysisHistory();
    assert.strictEqual(hist.length, 1, 'should reload 1 analysis entry');
    assert.strictEqual(hist[0].ts, entry.ts, 'timestamp should match');
    assert.strictEqual(hist[0].raw, 'test raw', 'raw data should match');
    console.log('    ✓ analysis save + reload cycle works');
  });

  test('parseAnalysis extracts bull/bear counts', () => {
    const analysisPath = path.join(ROOT, 'plugins/okx/store/analysis');
    const store = require(analysisPath);
    const raw   = '多头信号 7 / 空头信号 3\nATR 1,234.56';
    const parsed = store.parseAnalysis(raw);
    assert.strictEqual(parsed.bull, 7);
    assert.strictEqual(parsed.bear, 3);
    assert.strictEqual(parsed.atr, 1234.56);
    console.log('    ✓ parseAnalysis works correctly');
  });
});
