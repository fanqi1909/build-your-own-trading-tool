'use strict';
// Unit tests for lib/ai.js — no Claude CLI needed (tests prompt builders only)

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../lib/ai');

// ─── buildClaudePrompt ───────────────────────────────────
describe('buildClaudePrompt', () => {
  const rawAnalysis = '多头信号 5 / 空头信号 2\nATR 1234.56';

  test('contains mode string for demo', () => {
    const prompt = ai.buildClaudePrompt(rawAnalysis, [], 'demo');
    assert.ok(prompt.includes('模拟盘'), 'should include 模拟盘');
  });

  test('contains mode string for live', () => {
    const prompt = ai.buildClaudePrompt(rawAnalysis, [], 'live');
    assert.ok(prompt.includes('实盘'), 'should include 实盘');
  });

  test('shows 无持仓 when positions empty', () => {
    const prompt = ai.buildClaudePrompt(rawAnalysis, [], 'demo');
    assert.ok(prompt.includes('无持仓'));
  });

  test('shows 无持仓 when positions null', () => {
    const prompt = ai.buildClaudePrompt(rawAnalysis, null, 'demo');
    assert.ok(prompt.includes('无持仓'));
  });

  test('includes position details when positions provided', () => {
    const positions = [{
      instId:   'BTC-USDT-SWAP',
      pos:      '2',
      lever:    '10',
      avgPx:    85000,
      markPx:   86000,
      upl:      200,
      uplRatio: 0.02,
      mgnRatio: 50,
    }];
    const prompt = ai.buildClaudePrompt(rawAnalysis, positions, 'demo');
    assert.ok(prompt.includes('BTC-USDT-SWAP'));
    assert.ok(prompt.includes('多仓'));
    assert.ok(prompt.includes('10×'));
  });

  test('includes raw analysis text', () => {
    const prompt = ai.buildClaudePrompt(rawAnalysis, [], 'demo');
    assert.ok(prompt.includes(rawAnalysis));
  });

  test('marks short position correctly', () => {
    const positions = [{
      instId: 'BTC-USDT-SWAP', pos: '-3', lever: '5',
      avgPx: 85000, markPx: 84000, upl: 300, uplRatio: 0.03, mgnRatio: 40,
    }];
    const prompt = ai.buildClaudePrompt(rawAnalysis, positions, 'live');
    assert.ok(prompt.includes('空仓'));
  });
});

// ─── buildPositionTrackPrompt ────────────────────────────
describe('buildPositionTrackPrompt', () => {
  const raw = '多头信号 3 / 空头信号 4';
  const positions = [{
    instId: 'BTC-USDT-SWAP', pos: '1', lever: '20',
    avgPx: 90000, markPx: 90500, upl: 50, uplRatio: 0.005, mgnRatio: 60,
  }];

  test('contains POSITION_TRACK_PROMPT template', () => {
    const prompt = ai.buildPositionTrackPrompt(raw, positions, 'demo');
    assert.ok(prompt.includes(ai.POSITION_TRACK_PROMPT.slice(0, 20)));
  });

  test('contains position info', () => {
    const prompt = ai.buildPositionTrackPrompt(raw, positions, 'demo');
    assert.ok(prompt.includes('BTC-USDT-SWAP'));
    assert.ok(prompt.includes('20×'));
  });

  test('contains raw analysis', () => {
    const prompt = ai.buildPositionTrackPrompt(raw, positions, 'demo');
    assert.ok(prompt.includes(raw));
  });

  test('demo mode label', () => {
    const prompt = ai.buildPositionTrackPrompt(raw, positions, 'demo');
    assert.ok(prompt.includes('模拟盘'));
  });

  test('live mode label', () => {
    const prompt = ai.buildPositionTrackPrompt(raw, positions, 'live');
    assert.ok(prompt.includes('实盘'));
  });
});

// ─── exports ─────────────────────────────────────────────
describe('ai module exports', () => {
  const EXPECTED = ['spawnClaude', 'buildClaudePrompt', 'runClaudeAnalysis', 'buildPositionTrackPrompt', 'POSITION_TRACK_PROMPT'];
  for (const name of EXPECTED) {
    test(`exports ${name}`, () => {
      assert.ok(name in ai, `missing export: ${name}`);
    });
  }
});
