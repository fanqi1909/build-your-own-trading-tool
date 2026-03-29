'use strict';
/**
 * lib/ai.js — AI layer
 *
 * Contains: Claude spawn helper, prompt templates, prompt builders
 * autoClaudeAssess() and positionTrackRefresh() depend on cache/broadcast, kept in server.js
 */

const { spawn } = require('child_process');

// ─── Shared spawn helper ────────────────────────────────

async function spawnClaude(prompt, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('error', reject);
    const timer = setTimeout(() => { proc.kill(); reject(new Error('claude timeout')); }, timeoutMs);
    proc.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`));
    });
    proc.stdin.write(prompt, 'utf8');
    proc.stdin.end();
  });
}

// ─── Technical analysis Claude prompt ───────────────────────────

const CLAUDE_PROMPT_TEMPLATE = `You are a BTC perpetual swap trading assistant. Based on multi-timeframe technical analysis, provide concise trading advice.

IMPORTANT: Always respond in English, even if the input data contains Chinese.

Trading principles:
- When high and low timeframe signals align, raise confidence one level; when conflicting, reduce position or stay flat
- Stop-loss must be placed beyond the nearest support/resistance level (not a fixed ATR multiple)
- Take-profit should reference the next key resistance/support level

Reply strictly in the following format (under 200 chars):
[Direction] Bull/Bear/Hold, explain whether high and low timeframes align
[Action] Hold/Add/Reduce/Close/Open Long/Open Short, one-line core reason
[Price Reference] Entry range | SL $xxx (beyond nearest support/resistance) | TP $xxx (next key level)
[Confidence] Low/Medium/High

Demo accounts may be aggressive; live accounts should be conservative.

---

`;

function buildClaudePrompt(analysisRaw, positions, mode) {
  const modeStr = mode === 'live' ? 'Live' : 'Demo';
  let posStr = 'No positions';
  if (positions && positions.length) {
    posStr = positions.map(p => {
      const dir = parseFloat(p.pos) > 0 ? 'Long' : 'Short';
      return `${p.instId} ${dir} ${Math.abs(p.pos)} contracts ${p.lever}× | Avg Price $${p.avgPx} | Mark Price $${p.markPx} | UPL ${p.upl >= 0 ? '+' : ''}$${p.upl.toFixed(2)}(${(p.uplRatio*100).toFixed(2)}%) | Margin Ratio ${p.mgnRatio.toFixed(1)}%`;
    }).join('\n');
  }
  return CLAUDE_PROMPT_TEMPLATE
    + `Account Mode: ${modeStr}\nCurrent Positions:\n${posStr}\n\n${analysisRaw}`;
}

async function runClaudeAnalysis(analysisEntry, positions, mode) {
  const prompt = buildClaudePrompt(analysisEntry.raw, positions, mode);
  return spawnClaude(prompt);
}

// ─── Position tracking Claude prompt ───────────────────────────

const POSITION_TRACK_PROMPT = `You are a BTC perpetual swap position tracking assistant. Based on multi-timeframe analysis and current positions, provide action advice.

IMPORTANT: Always respond in English, even if the input data contains Chinese.

Reply strictly in the following format (under 100 chars):
Action: Hold / Add / Reduce / Close (pick one)
Reason: High-low timeframe direction + key indicator, one line
SL Adjustment: $xxx (long→below support; short→above resistance; if no change write "maintain")
TP Adjustment: $xxx (long→resistance; short→support; if no change write "maintain")
Confidence: Low / Medium / High

---

`;

function buildPositionTrackPrompt(analysisRaw, positions, mode) {
  const modeStr = mode === 'live' ? 'Live' : 'Demo';
  const posStr = positions.map(p => {
    const dir = parseFloat(p.pos) > 0 ? 'Long' : 'Short';
    return `${p.instId} ${dir} ${Math.abs(p.pos)} contracts ${p.lever}× | Avg Price $${p.avgPx} | Mark Price $${p.markPx} | UPL ${p.upl >= 0 ? '+' : ''}$${p.upl.toFixed(2)}(${(p.uplRatio*100).toFixed(2)}%) | Margin Ratio ${p.mgnRatio.toFixed(1)}%`;
  }).join('\n');
  return POSITION_TRACK_PROMPT + `Account Mode: ${modeStr}\nPositions:\n${posStr}\n\n${analysisRaw}`;
}

// ─── Postmortem analysis Claude prompt ───────────────────────────

const POSTMORTEM_PROMPT_TEMPLATE = `You are a BTC perpetual swap trade postmortem expert. Based on the following trade data and market context, analyze the trade performance.

IMPORTANT: Always respond in English, even if the input data contains Chinese.

Reply strictly in the following format (under 300 chars):
[Trade Rating] Profit/Loss/Breakeven — one-line assessment
[Entry Analysis] Whether entry timing was correct, core basis
[Exit Analysis] Whether exit timing was correct (close orders only)
[Key Mistakes] 1-2 main issues (if none, write "No obvious execution errors")
[Improvement] How to handle similar setups next time
[Score] X/10, one-line explanation

---

`;

const _PM_BAR_MS = {
  '1m':60000,'3m':180000,'5m':300000,'15m':900000,
  '30m':1800000,'1H':3600000,'4H':14400000,'1D':86400000
};

function buildPostmortemPrompt(order, candles, analysisRaw, mode, bar) {
  const bMs     = _PM_BAR_MS[bar] || 900000;
  const fillTs  = order.fillTime || order.cTime;
  const tradeIdx = candles.findIndex(c => fillTs >= c.ts && fillTs < c.ts + bMs);
  const context  = candles.slice(Math.max(0, tradeIdx - 5), Math.min(candles.length, tradeIdx + 6));
  const candleSummary = context.map(c => {
    const d    = new Date(c.ts);
    const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    return `  ${time} ${ c.c >= c.o ? 'Bull' : 'Bear'} O:${c.o.toFixed(0)} H:${c.h.toFixed(0)} L:${c.l.toFixed(0)} C:${c.c.toFixed(0)}`;
  }).join('\n');

  const isOpen    = !order.reduceOnly;
  const dir       = order.side === 'buy' ? 'Long' : 'Short';
  const typeLabel = isOpen ? `Open(${dir})` : (order.side === 'sell' ? 'Close Long' : 'Close Short');
  const pnlVal    = (order.pnl + order.fee).toFixed(2);

  return POSTMORTEM_PROMPT_TEMPLATE
    + `Account Mode: ${ mode === 'live' ? 'Live' : 'Demo' }\n`
    + `Trade Type: ${typeLabel}\n`
    + `Fill Time: ${ new Date(fillTs).toLocaleString('en-US', { hour12: false }) }\n`
    + `Contract: ${order.instId}  Fill Price: $${order.avgPx.toLocaleString()}  Qty: ${order.fillSz} contracts  Leverage: ${order.lever}×\n`
    + `PnL (incl. fee): ${ pnlVal > 0 ? '+' : '' }$${pnlVal}\n`
    + `\nCandles around fill (${bar}):\n${ candleSummary || 'No candle data' }\n`
    + (analysisRaw ? `\nEntry technical analysis:\n${analysisRaw.slice(0, 800)}` : '\nNo technical analysis recorded at entry');
}

async function runPostmortem(order, candles, analysisRaw, mode, bar) {
  return spawnClaude(buildPostmortemPrompt(order, candles, analysisRaw, mode, bar), 90000);
}

module.exports = {
  spawnClaude,
  buildClaudePrompt,
  runClaudeAnalysis,
  buildPositionTrackPrompt,
  POSITION_TRACK_PROMPT,
  buildPostmortemPrompt,
  runPostmortem,
};
