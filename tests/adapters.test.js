'use strict';
// Unit tests — no server, no network, no OKX CLI needed

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { AdapterError } = require('../adapters/base');
const restAdapter      = require('../adapters/okx-rest');
const cliAdapter       = require('../adapters/okx-cli');

// ─── AdapterError ──────────────────────────────────────
describe('AdapterError', () => {
  test('sets name and default code', () => {
    const e = new AdapterError('something failed');
    assert.equal(e.name,    'AdapterError');
    assert.equal(e.message, 'something failed');
    assert.equal(e.code,    'API_ERROR');
    assert.ok(e instanceof Error);
  });

  test('accepts custom code', () => {
    const e = new AdapterError('parse failed', 'PARSE_ERROR');
    assert.equal(e.code, 'PARSE_ERROR');
  });
});

// ─── okx-rest stub ─────────────────────────────────────
describe('okx-rest: all methods throw AdapterError', () => {
  const METHODS = [
    'fetchTicker', 'fetchBalance', 'fetchPositions',
    'fetchCandles', 'fetchHistory', 'setLeverage',
    'placeMarketOrder', 'placeLimitOrder', 'placeAlgoOrder',
    'closePosition', 'fetchOpenOrders', 'cancelOrder',
    'fetchAlgoOrders', 'amendAlgoOrder',
  ];

  for (const m of METHODS) {
    test(m, async () => {
      await assert.rejects(
        () => Promise.resolve().then(() => restAdapter[m]()),
        e => {
          assert.ok(e instanceof AdapterError, 'should be AdapterError');
          assert.equal(e.message, 'REST adapter not implemented');
          return true;
        }
      );
    });
  }
});

// ─── okx-cli exports ───────────────────────────────────
describe('okx-cli: exports all required methods', () => {
  const METHODS = [
    'fetchTicker', 'fetchBalance', 'fetchPositions',
    'fetchCandles', 'fetchHistory', 'setLeverage',
    'placeMarketOrder', 'placeLimitOrder', 'placeAlgoOrder',
    'closePosition', 'fetchOpenOrders', 'cancelOrder',
    'fetchAlgoOrders', 'amendAlgoOrder',
  ];

  for (const m of METHODS) {
    test(`exports ${m} as function`, () => {
      assert.equal(typeof cliAdapter[m], 'function');
    });
  }
});
