'use strict';
/**
 * store/db.js — Shared DuckDB connection for all account-specific data.
 *
 * Tables: orders, analysis, postrack, indicators
 * Market data (candles) stays in candles.duckdb via store/candles.js.
 *
 * Account isolation: every row tagged with account_id (sha256 of api_key[:16]).
 * Switching OKX accounts → different account_id → data automatically separated.
 */

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');
const duckdb = require('duckdb');

let _db   = null;
let _conn = null;
let _accountId = 'local';

// ── Helpers ────────────────────────────────────────────────────────────────

function _run(sql, params = []) {
  return new Promise((resolve, reject) => {
    const cb = err => err ? reject(err) : resolve();
    if (params.length) _conn.run(sql, ...params, cb);
    else _conn.run(sql, cb);
  });
}

function _all(sql, params = []) {
  return new Promise((resolve, reject) => {
    const cb = (err, rows) => err ? reject(err) : resolve(rows ?? []);
    if (params.length) _conn.all(sql, ...params, cb);
    else _conn.all(sql, cb);
  });
}

// ── Account ID ─────────────────────────────────────────────────────────────

function _computeAccountId() {
  // 1. From env vars (fly.io deployment)
  const key = process.env.OKX_DEMO_API_KEY || process.env.OKX_LIVE_API_KEY;
  if (key) return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

  // 2. From ~/.okx/config.toml (local dev)
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.okx', 'config.toml'), 'utf8');
    const m   = raw.match(/api_key\s*=\s*"([^"]+)"/);
    if (m?.[1]) return crypto.createHash('sha256').update(m[1]).digest('hex').slice(0, 16);
  } catch {}

  return 'local';
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init(dataDir) {
  _accountId = _computeAccountId();
  console.log(`[db] account_id: ${_accountId}`);

  const dbPath = path.join(dataDir, 'trading.duckdb');
  _db = await new Promise((resolve, reject) => {
    const database = new duckdb.Database(dbPath, err => err ? reject(err) : resolve(database));
  });
  _conn = _db.connect();

  await _run(`
    CREATE TABLE IF NOT EXISTS orders (
      account_id  TEXT,
      env         TEXT,
      ord_id      TEXT,
      inst_id     TEXT,
      side        TEXT,
      ord_type    TEXT,
      sz          DOUBLE,
      avg_px      DOUBLE,
      fill_sz     DOUBLE,
      pnl         DOUBLE,
      fee         DOUBLE,
      state       TEXT,
      lever       TEXT,
      reduce_only BOOLEAN,
      c_time      BIGINT,
      fill_time   BIGINT,
      PRIMARY KEY (account_id, env, ord_id)
    )
  `);

  await _run(`
    CREATE TABLE IF NOT EXISTS analysis (
      account_id     TEXT,
      env            TEXT,
      id             TEXT,
      inst           TEXT,
      bar            TEXT,
      ts             BIGINT,
      raw            TEXT,
      bull           INTEGER,
      bear           INTEGER,
      atr            DOUBLE,
      claude_response TEXT,
      PRIMARY KEY (account_id, env, id)
    )
  `);

  await _run(`
    CREATE TABLE IF NOT EXISTS postrack (
      account_id TEXT,
      env        TEXT,
      id         TEXT,
      ts         BIGINT,
      text       TEXT,
      PRIMARY KEY (account_id, env, id)
    )
  `);

  await _run(`
    CREATE TABLE IF NOT EXISTS indicators (
      inst_id TEXT,
      bar     TEXT,
      ts      BIGINT,
      name    TEXT,
      value   DOUBLE,
      PRIMARY KEY (inst_id, bar, ts, name)
    )
  `);

  console.log('[db] trading DB ready');
}

function close() {
  return new Promise(resolve => {
    if (!_db) return resolve();
    try {
      _conn = null;
      _db.close((err) => {
        if (err) console.error('[db] close error', err.message);
        _db = null;
        resolve();
      });
    } catch { resolve(); }
  });
}

function getAccountId() { return _accountId; }

module.exports = { init, close, getAccountId, run: _run, all: _all };
