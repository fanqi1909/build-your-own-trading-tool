'use strict';
// Extracted from lib/store.js — analysis history section

const fs   = require('fs');
const path = require('path');

let _getMode = () => 'demo';
let _dataDir = './data';
const analysisHistories = { demo: [], live: [] };

function _file(mode) { return path.join(_dataDir, `analysis-${mode}.json`); }

function init(getMode, dataDir) {
  _getMode = getMode;
  _dataDir = dataDir;
  for (const mode of ['demo', 'live']) {
    try {
      const newFile = _file(mode);
      const oldFile = path.join(dataDir, 'analysis-history.json');
      if (fs.existsSync(newFile)) {
        analysisHistories[mode] = JSON.parse(fs.readFileSync(newFile, 'utf8'));
        console.log(`[analysis:${mode}] loaded ${analysisHistories[mode].length} records`);
      } else if (mode === 'demo' && fs.existsSync(oldFile)) {
        analysisHistories[mode] = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
        console.log(`[analysis:${mode}] migrated ${analysisHistories[mode].length} records from old file`);
      }
    } catch (e) { console.error(`[analysis:${mode}] load error`, e.message); }
  }
}

function analysisHistory() { return analysisHistories[_getMode()]; }

function saveAnalysisHistory() {
  const mode = _getMode();
  try {
    const hist = analysisHistories[mode];
    if (hist.length > 200) analysisHistories[mode] = hist.slice(-200);
    fs.writeFileSync(_file(mode), JSON.stringify(analysisHistories[mode]));
  } catch (e) { console.error('[analysis] save error', e.message); }
}

function parseAnalysis(raw) {
  const bullMatch = raw.match(/多头信号\s+(\d+)\s*\/\s*空头信号\s+(\d+)/);
  const atrMatch  = raw.match(/ATR\s+([\d,]+\.\d+)/);
  return {
    bull: bullMatch ? parseInt(bullMatch[1]) : 0,
    bear: bullMatch ? parseInt(bullMatch[2]) : 0,
    atr:  atrMatch  ? parseFloat(atrMatch[1].replace(/,/g, '')) : null,
  };
}

module.exports = { init, analysisHistories, analysisHistory, saveAnalysisHistory, parseAnalysis };
