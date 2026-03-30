'use strict';
// Extracted from lib/store.js — postrack section

const fs   = require('fs');
const path = require('path');

let _getMode = () => 'demo';
let _dataDir = './data';
const posTrackHistories = { demo: [], live: [] };

function _file(mode) { return path.join(_dataDir, `postrack-${mode}.json`); }

function init(getMode, dataDir) {
  _getMode = getMode;
  _dataDir = dataDir;
  for (const mode of ['demo', 'live']) {
    try {
      const file = _file(mode);
      if (fs.existsSync(file)) {
        posTrackHistories[mode] = JSON.parse(fs.readFileSync(file, 'utf8'));
        console.log(`[posTrack:${mode}] loaded ${posTrackHistories[mode].length} records`);
      }
    } catch (e) { console.error(`[posTrack:${mode}] load error`, e.message); }
  }
}

function posTrackHistory() { return posTrackHistories[_getMode()]; }

function savePosTrackHistory() {
  const mode = _getMode();
  try {
    const hist = posTrackHistories[mode];
    if (hist.length > 200) posTrackHistories[mode] = hist.slice(-200);
    fs.writeFileSync(_file(mode), JSON.stringify(posTrackHistories[mode]));
  } catch (e) { console.error('[posTrack] save error', e.message); }
}

module.exports = { init, posTrackHistories, posTrackHistory, savePosTrackHistory };
