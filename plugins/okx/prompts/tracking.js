'use strict';
// Extracted from lib/ai.js — position tracking prompt

const { spawnClaude } = require('./_spawn');

const TEMPLATE = `You are a BTC perpetual swap position tracking assistant. Based on multi-timeframe analysis and current positions, provide action advice.

IMPORTANT: Always respond in English, even if the input data contains Chinese.

Reply strictly in the following format (under 100 chars):
Action: Hold / Add / Reduce / Close (pick one)
Reason: High-low timeframe direction + key indicator, one line
SL Adjustment: $xxx (long→below support; short→above resistance; if no change write "maintain")
TP Adjustment: $xxx (long→resistance; short→support; if no change write "maintain")
Confidence: Low / Medium / High

---

`;

function buildPrompt(analysisRaw, positions, mode) {
  const modeStr = mode === 'live' ? 'Live' : 'Demo';
  const posStr = positions.map(p => {
    const dir = parseFloat(p.pos) > 0 ? 'Long' : 'Short';
    return `${p.instId} ${dir} ${Math.abs(p.pos)} contracts ${p.lever}× | Avg Price $${p.avgPx} | Mark Price $${p.markPx} | UPL ${p.upl >= 0 ? '+' : ''}$${p.upl.toFixed(2)}(${(p.uplRatio * 100).toFixed(2)}%) | Margin Ratio ${p.mgnRatio.toFixed(1)}%`;
  }).join('\n');
  return TEMPLATE + `Account Mode: ${modeStr}\nPositions:\n${posStr}\n\n${analysisRaw}`;
}

async function run(analysisRaw, positions, mode) {
  return spawnClaude(buildPrompt(analysisRaw, positions, mode));
}

module.exports = { buildPrompt, run };
