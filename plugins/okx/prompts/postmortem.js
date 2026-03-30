'use strict';
// Extracted from lib/ai.js — trade postmortem prompt

const { spawnClaude } = require('./_spawn');

const TEMPLATE = `You are a BTC perpetual swap trade postmortem expert. Based on the following trade data and market context, analyze the trade performance.

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

const BAR_MS = {
  '1m':60000,'3m':180000,'5m':300000,'15m':900000,
  '30m':1800000,'1H':3600000,'4H':14400000,'1D':86400000,
};

function buildPrompt(order, candles, analysisRaw, mode, bar) {
  const bMs      = BAR_MS[bar] || 900000;
  const fillTs   = order.fillTime || order.cTime;
  const tradeIdx = candles.findIndex(c => fillTs >= c.ts && fillTs < c.ts + bMs);
  const context  = candles.slice(Math.max(0, tradeIdx - 5), Math.min(candles.length, tradeIdx + 6));
  const candleSummary = context.map(c => {
    const d    = new Date(c.ts);
    const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `  ${time} ${c.c >= c.o ? 'Bull' : 'Bear'} O:${c.o.toFixed(0)} H:${c.h.toFixed(0)} L:${c.l.toFixed(0)} C:${c.c.toFixed(0)}`;
  }).join('\n');

  const isOpen    = !order.reduceOnly;
  const dir       = order.side === 'buy' ? 'Long' : 'Short';
  const typeLabel = isOpen ? `Open(${dir})` : (order.side === 'sell' ? 'Close Long' : 'Close Short');
  const pnlVal    = (order.pnl + order.fee).toFixed(2);

  return TEMPLATE
    + `Account Mode: ${mode === 'live' ? 'Live' : 'Demo'}\n`
    + `Trade Type: ${typeLabel}\n`
    + `Fill Time: ${new Date(fillTs).toLocaleString('en-US', { hour12: false })}\n`
    + `Contract: ${order.instId}  Fill Price: $${order.avgPx.toLocaleString()}  Qty: ${order.fillSz} contracts  Leverage: ${order.lever}×\n`
    + `PnL (incl. fee): ${pnlVal > 0 ? '+' : ''}$${pnlVal}\n`
    + `\nCandles around fill (${bar}):\n${candleSummary || 'No candle data'}\n`
    + (analysisRaw
      ? `\nEntry technical analysis:\n${analysisRaw.slice(0, 800)}`
      : '\nNo technical analysis recorded at entry');
}

async function run(order, candles, analysisRaw, mode, bar) {
  return spawnClaude(buildPrompt(order, candles, analysisRaw, mode, bar), 90000);
}

module.exports = { buildPrompt, run };
