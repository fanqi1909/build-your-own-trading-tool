'use strict';
// Extracted from lib/ai.js — technical analysis prompt

const { spawnClaude } = require('./_spawn');

const TEMPLATE = `You are a BTC perpetual swap trading assistant. Based on multi-timeframe technical analysis, provide concise trading advice.

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

function buildPrompt(analysisRaw, positions, mode) {
  const modeStr = mode === 'live' ? 'Live' : 'Demo';
  let posStr = 'No positions';
  if (positions && positions.length) {
    posStr = positions.map(p => {
      const dir = parseFloat(p.pos) > 0 ? 'Long' : 'Short';
      return `${p.instId} ${dir} ${Math.abs(p.pos)} contracts ${p.lever}× | Avg Price $${p.avgPx} | Mark Price $${p.markPx} | UPL ${p.upl >= 0 ? '+' : ''}$${p.upl.toFixed(2)}(${(p.uplRatio * 100).toFixed(2)}%) | Margin Ratio ${p.mgnRatio.toFixed(1)}%`;
    }).join('\n');
  }
  return TEMPLATE + `Account Mode: ${modeStr}\nCurrent Positions:\n${posStr}\n\n${analysisRaw}`;
}

async function run(analysisEntry, positions, mode) {
  const prompt = buildPrompt(analysisEntry.raw, positions, mode);
  return spawnClaude(prompt);
}

module.exports = { buildPrompt, run };
