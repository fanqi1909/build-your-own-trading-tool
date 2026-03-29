'use strict';
/**
 * lib/store.js — 数据持久化层
 *
 * 包含：订单存储、仓位追踪历史、DuckDB K线、技术分析历史
 * 供 server.js 通过 require('./lib/store') 引入
 */

const fs     = require('fs');
const path   = require('path');
const duckdb = require('duckdb');

// 确保 data/ 目录存在
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

// ─── 订单存储（JSON 文件 + 内存 Map）────────────────────

// Map<ordId, order>，按 mode 分开
const ordersStore = { demo: new Map(), live: new Map() };

function ordersFile(mode) {
  return `./data/orders-${mode}.json`;
}

function loadOrders() {
  for (const mode of ['demo', 'live']) {
    try {
      const file = ordersFile(mode);
      if (fs.existsSync(file)) {
        const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
        arr.forEach(o => ordersStore[mode].set(o.ordId, o));
        console.log(`[db] loaded ${ordersStore[mode].size} orders (${mode})`);
      }
    } catch (e) {
      console.error(`[db] load error`, e.message);
    }
  }
}

function saveOrders(mode) {
  try {
    const arr = [...ordersStore[mode].values()];
    fs.writeFileSync(ordersFile(mode), JSON.stringify(arr));
  } catch (e) {
    console.error(`[db] saveOrders(${mode}) error`, e.message);
  }
}

function upsertOrders(orders, mode) {
  if (!orders.length) return;
  orders.forEach(o => ordersStore[mode].set(o.ordId, o));
  saveOrders(mode);
}

// ─── 仓位追踪历史存储 ─────────────────────────────────

const POSTRACK_FILES = {
  demo: './data/postrack-demo.json',
  live: './data/postrack-live.json',
};
const posTrackHistories = { demo: [], live: [] };

// currentMode 由 server.js 通过 getter 注入
let _getCurrentMode = () => 'demo';
function setPosTrackModeGetter(fn) { _getCurrentMode = fn; }

function posTrackHistory() { return posTrackHistories[_getCurrentMode()]; }

function loadPosTrackHistory() {
  for (const mode of ['demo', 'live']) {
    try {
      const file = POSTRACK_FILES[mode];
      if (fs.existsSync(file)) {
        posTrackHistories[mode] = JSON.parse(fs.readFileSync(file, 'utf8'));
        console.log(`[posTrack:${mode}] loaded ${posTrackHistories[mode].length} records`);
      }
    } catch (e) { console.error(`[posTrack:${mode}] load error`, e.message); }
  }
}

function savePosTrackHistory() {
  const mode = _getCurrentMode();
  try {
    const hist = posTrackHistories[mode];
    if (hist.length > 200) posTrackHistories[mode] = hist.slice(-200);
    fs.writeFileSync(POSTRACK_FILES[mode], JSON.stringify(posTrackHistories[mode]));
  } catch (e) {
    console.error(`[posTrack] savePosTrackHistory error`, e.message);
  }
}

// ─── DuckDB K线存储 ───────────────────────────────────

const DB_PATH = './data/candles.duckdb';
let _db, _conn;

function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    const cb = err => err ? reject(err) : resolve();
    if (params && params.length) {
      _conn.run(sql, ...params, cb);
    } else {
      _conn.run(sql, cb);
    }
  });
}

function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    const cb = (err, rows) => err ? reject(err) : resolve(rows);
    if (params && params.length) {
      _conn.all(sql, ...params, cb);
    } else {
      _conn.all(sql, cb);
    }
  });
}

async function initCandleDB() {
  _db   = new duckdb.Database(DB_PATH);
  _conn = _db.connect();
  await dbRun(`
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
  // 参数化逐条 upsert，避免 SQL 注入
  for (const c of candles) {
    await dbRun(
      `INSERT OR REPLACE INTO candles (inst, bar, ts, o, h, l, c, vol) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [inst, bar, c.ts, c.o, c.h, c.l, c.c, c.vol]
    );
  }
}

async function loadCandlesFromDB(inst, bar, limit = 500) {
  const rows = await dbAll(
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

const POSTMORTEM_BAR_MS = {
  '1m':60000,'3m':180000,'5m':300000,'15m':900000,
  '30m':1800000,'1H':3600000,'4H':14400000,'1D':86400000
};

async function loadCandlesAroundTime(inst, bar, centerTs, before = 40, after = 20) {
  const barMs  = POSTMORTEM_BAR_MS[bar] || 900000;
  const fromTs = centerTs - (before + 1) * barMs;
  const toTs   = centerTs + (after  + 2) * barMs;
  const rows   = await dbAll(
    `SELECT ts, o, h, l, c, vol FROM candles
     WHERE inst = ? AND bar = ? AND ts >= ? AND ts <= ?
     ORDER BY ts ASC`,
    [inst, bar, fromTs, toTs]
  );
  return rows.map(r => ({ ts: Number(r.ts), o: r.o, h: r.h, l: r.l, c: r.c, vol: r.vol }));
}

// ─── 技术分析历史存储 ─────────────────────────────────

const ANALYSIS_FILES = {
  demo: './data/analysis-demo.json',
  live: './data/analysis-live.json',
};
const analysisHistories = { demo: [], live: [] };

// currentMode 通过同一个 getter
function analysisHistory() { return analysisHistories[_getCurrentMode()]; }

function loadAnalysisHistory() {
  for (const mode of ['demo', 'live']) {
    try {
      const newFile = ANALYSIS_FILES[mode];
      const oldFile = './data/analysis-history.json';
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

function saveAnalysisHistory() {
  const mode = _getCurrentMode();
  try {
    const hist = analysisHistories[mode];
    if (hist.length > 200) analysisHistories[mode] = hist.slice(-200);
    fs.writeFileSync(ANALYSIS_FILES[mode], JSON.stringify(analysisHistories[mode]));
  } catch (e) {
    console.error(`[analysis] saveAnalysisHistory error`, e.message);
  }
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

// ─── Graceful shutdown helper ─────────────────────────

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
  // orders
  ordersStore,
  loadOrders,
  saveOrders,
  upsertOrders,
  // postrack
  posTrackHistories,
  posTrackHistory,
  loadPosTrackHistory,
  savePosTrackHistory,
  setPosTrackModeGetter,
  // candles / DuckDB
  initCandleDB,
  upsertCandles,
  loadCandlesFromDB,
  loadCandlesAroundTime,
  POSTMORTEM_BAR_MS,
  getCandleConn,
  closeDB,
  // analysis
  analysisHistories,
  analysisHistory,
  loadAnalysisHistory,
  saveAnalysisHistory,
  parseAnalysis,
};
