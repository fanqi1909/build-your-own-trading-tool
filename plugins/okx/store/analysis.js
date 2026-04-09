'use strict';
/**
 * store/analysis.js — Write-through cache for AI analysis history.
 * Memory array is the working source of truth; DuckDB is the persistent store.
 * Action files use the same sync interface as before.
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./db');

let _getMode = () => 'demo';
const analysisHistories = { demo: [], live: [] };

async function init(getMode, dataDir) {
  _getMode = getMode;
  const accountId = db.getAccountId();

  for (const env of ['demo', 'live']) {
    try {
      const rows = await db.all(
        `SELECT * FROM analysis WHERE account_id = ? AND env = ? ORDER BY ts ASC`,
        [accountId, env]
      );
      analysisHistories[env] = rows.map(_fromRow);
      if (rows.length) console.log(`[analysis:${env}] loaded ${rows.length} from DB`);
    } catch (e) {
      console.error(`[analysis:${env}] DB load error`, e.message);
    }

    // Migrate from legacy JSON if DB was empty
    if (analysisHistories[env].length === 0) {
      const files = [
        path.join(dataDir, `analysis-${env}.json`),
        env === 'demo' ? path.join(dataDir, 'analysis-history.json') : null,
      ].filter(Boolean);

      for (const file of files) {
        try {
          if (fs.existsSync(file)) {
            analysisHistories[env] = JSON.parse(fs.readFileSync(file, 'utf8'));
            console.log(`[analysis:${env}] migrated ${analysisHistories[env].length} from JSON`);
            _saveAllAsync(env).catch(e => console.error('[analysis] migrate save error', e.message));
            break;
          }
        } catch (e) { console.error(`[analysis:${env}] JSON migrate error`, e.message); }
      }
    }
  }
}

function analysisHistory() { return analysisHistories[_getMode()]; }

function saveAnalysisHistory() {
  const env = _getMode();
  const hist = analysisHistories[env];
  if (hist.length > 200) analysisHistories[env] = hist.slice(-200);
  _saveAllAsync(env).catch(e => console.error('[analysis] save error', e.message));
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

// ── Internal ───────────────────────────────────────────────────────────────

const ANALYSIS_RETENTION = 200;

async function _saveAllAsync(env) {
  const accountId = db.getAccountId();
  for (const entry of analysisHistories[env]) {
    const id = String(entry.ts);
    await db.run(
      `INSERT OR REPLACE INTO analysis
       (account_id, env, id, inst, bar, ts, raw, bull, bear, atr, claude_response)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [accountId, env, id,
       entry.inst ?? '', entry.bar ?? '',
       entry.ts ?? 0, entry.raw ?? '',
       entry.bull ?? 0, entry.bear ?? 0,
       entry.atr ?? null,
       entry.claudeResponse ?? null]
    );
  }
  // Trim DB to retention limit
  await db.run(
    `DELETE FROM analysis WHERE account_id = ? AND env = ? AND id NOT IN (
       SELECT id FROM analysis WHERE account_id = ? AND env = ?
       ORDER BY ts DESC LIMIT ?
     )`,
    [accountId, env, accountId, env, ANALYSIS_RETENTION]
  );
}

function _fromRow(r) {
  return {
    ts:            Number(r.ts),
    inst:          r.inst,
    bar:           r.bar,
    raw:           r.raw,
    bull:          r.bull,
    bear:          r.bear,
    atr:           r.atr,
    claudeResponse: r.claude_response ?? undefined,
  };
}

module.exports = { init, analysisHistories, analysisHistory, saveAnalysisHistory, parseAnalysis };
