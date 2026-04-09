'use strict';
/**
 * store/postrack.js — Write-through cache for position tracking history.
 * Memory array is the working source of truth; DuckDB is the persistent store.
 * Action files use the same sync interface as before.
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./db');

let _getMode = () => 'demo';
const posTrackHistories = { demo: [], live: [] };

async function init(getMode, dataDir) {
  _getMode = getMode;
  const accountId = db.getAccountId();

  for (const env of ['demo', 'live']) {
    try {
      const rows = await db.all(
        `SELECT * FROM postrack WHERE account_id = ? AND env = ? ORDER BY ts ASC`,
        [accountId, env]
      );
      posTrackHistories[env] = rows.map(r => ({ ts: Number(r.ts), text: r.text }));
      if (rows.length) console.log(`[postrack:${env}] loaded ${rows.length} from DB`);
    } catch (e) {
      console.error(`[postrack:${env}] DB load error`, e.message);
    }

    // Migrate from legacy JSON if DB was empty
    if (posTrackHistories[env].length === 0) {
      const file = path.join(dataDir, `postrack-${env}.json`);
      try {
        if (fs.existsSync(file)) {
          posTrackHistories[env] = JSON.parse(fs.readFileSync(file, 'utf8'));
          console.log(`[postrack:${env}] migrated ${posTrackHistories[env].length} from JSON`);
          _saveAllAsync(env).catch(e => console.error('[postrack] migrate save error', e.message));
        }
      } catch (e) { console.error(`[postrack:${env}] JSON migrate error`, e.message); }
    }
  }
}

function posTrackHistory() { return posTrackHistories[_getMode()]; }

function savePosTrackHistory() {
  const env  = _getMode();
  const hist = posTrackHistories[env];
  if (hist.length > 200) posTrackHistories[env] = hist.slice(-200);
  _saveAllAsync(env).catch(e => console.error('[postrack] save error', e.message));
}

// ── Internal ───────────────────────────────────────────────────────────────

async function _saveAllAsync(env) {
  const accountId = db.getAccountId();
  for (const entry of posTrackHistories[env]) {
    await db.run(
      `INSERT OR REPLACE INTO postrack (account_id, env, id, ts, text) VALUES (?,?,?,?,?)`,
      [accountId, env, String(entry.ts), entry.ts, entry.text ?? '']
    );
  }
}

module.exports = { init, posTrackHistories, posTrackHistory, savePosTrackHistory };
