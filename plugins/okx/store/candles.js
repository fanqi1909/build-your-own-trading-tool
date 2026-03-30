'use strict';
// Extracted from lib/store.js — DuckDB candles section

const path   = require('path');
const duckdb = require('duckdb');

let _db, _conn;

const POSTMORTEM_BAR_MS = {
  '1m':60000,'3m':180000,'5m':300000,'15m':900000,
  '30m':1800000,'1H':3600000,'4H':14400000,'1D':86400000,
};

function _dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    const cb = err => err ? reject(err) : resolve();
    if (params?.length) _conn.run(sql, ...params, cb);
    else _conn.run(sql, cb);
  });
}

function _dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    const cb = (err, rows) => err ? reject(err) : resolve(rows);
    if (params?.length) _conn.all(sql, ...params, cb);
    else _conn.all(sql, cb);
  });
}

async function init(getMode, dataDir) {
  const dbPath = path.join(dataDir, 'candles.duckdb');
  _db   = new duckdb.Database(dbPath);
  _conn = _db.connect();
  await _dbRun(`
    CREATE TABLE IF NOT EXISTS candles (
      inst VARCHAR,
      bar  VARCHAR,
      ts   BIGINT,
      o    DOUBLE,
      h    DOUBLE,
      l    DOUBLE,
      c    DOUBLE,
      vol  DOUBLE,
      PRIMARY KEY (inst, bar, ts)
    )
  `);
  console.log('[duckdb] candles DB ready');
}

function getCandleConn() { return _conn; }

async function upsertCandles(inst, bar, candles) {
  if (!candles.length) return;
  for (const c of candles) {
    await _dbRun(
      `INSERT OR REPLACE INTO candles (inst, bar, ts, o, h, l, c, vol) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [inst, bar, c.ts, c.o, c.h, c.l, c.c, c.vol]
    );
  }
}

async function loadCandlesFromDB(inst, bar, limit = 500) {
  const rows = await _dbAll(
    `SELECT ts, o, h, l, c, vol FROM (
       SELECT ts, o, h, l, c, vol FROM candles
       WHERE inst = ? AND bar = ?
       ORDER BY ts DESC
       LIMIT ?
     ) ORDER BY ts ASC`,
    [inst, bar, limit]
  );
  return rows.map(r => ({ ts: Number(r.ts), o: r.o, h: r.h, l: r.l, c: r.c, vol: r.vol }));
}

async function loadCandlesAroundTime(inst, bar, centerTs, before = 40, after = 20) {
  const barMs  = POSTMORTEM_BAR_MS[bar] || 900000;
  const fromTs = centerTs - (before + 1) * barMs;
  const toTs   = centerTs + (after  + 2) * barMs;
  const rows   = await _dbAll(
    `SELECT ts, o, h, l, c, vol FROM candles
     WHERE inst = ? AND bar = ? AND ts >= ? AND ts <= ?
     ORDER BY ts ASC`,
    [inst, bar, fromTs, toTs]
  );
  return rows.map(r => ({ ts: Number(r.ts), o: r.o, h: r.h, l: r.l, c: r.c, vol: r.vol }));
}

function closeDB() {
  return new Promise(resolve => {
    if (!_conn && !_db) return resolve();
    try {
      if (_conn) { _conn.close(); _conn = null; }
      if (_db)   { _db.close(() => { _db = null; resolve(); }); }
      else resolve();
    } catch { resolve(); }
  });
}

module.exports = {
  init, getCandleConn,
  upsertCandles, loadCandlesFromDB, loadCandlesAroundTime,
  closeDB, POSTMORTEM_BAR_MS,
};
