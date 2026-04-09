'use strict';
/**
 * store/orders.js — Write-through cache for trade orders.
 * Memory Map is the working source of truth; DuckDB is the persistent store.
 * Action files use the same sync interface as before.
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const ordersStore = { demo: new Map(), live: new Map() };

async function init(getMode, dataDir) {
  const accountId = db.getAccountId();

  for (const env of ['demo', 'live']) {
    // Load from DuckDB
    try {
      const rows = await db.all(
        `SELECT * FROM orders WHERE account_id = ? AND env = ?`,
        [accountId, env]
      );
      rows.forEach(r => ordersStore[env].set(r.ord_id, _fromRow(r)));
      if (rows.length) console.log(`[orders:${env}] loaded ${rows.length} from DB`);
    } catch (e) {
      console.error(`[orders:${env}] DB load error`, e.message);
    }

    // Migrate from legacy JSON if DB was empty
    if (ordersStore[env].size === 0) {
      const file = path.join(dataDir, `orders-${env}.json`);
      try {
        if (fs.existsSync(file)) {
          const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
          arr.forEach(o => ordersStore[env].set(o.ordId, o));
          console.log(`[orders:${env}] migrated ${arr.length} from JSON`);
          // Persist migrated data to DuckDB
          _saveAllAsync(env).catch(e => console.error('[orders] migrate save error', e.message));
        }
      } catch (e) { console.error(`[orders:${env}] JSON migrate error`, e.message); }
    }
  }
}

function upsertOrders(orders, mode) {
  if (!orders.length) return;
  orders.forEach(o => ordersStore[mode].set(o.ordId, o));
  _saveAllAsync(mode).catch(e => console.error('[orders] save error', e.message));
}

// ── Internal ───────────────────────────────────────────────────────────────

async function _saveAllAsync(env) {
  const accountId = db.getAccountId();
  for (const o of ordersStore[env].values()) {
    await db.run(
      `INSERT OR REPLACE INTO orders
       (account_id, env, ord_id, inst_id, side, ord_type, sz, avg_px, fill_sz,
        pnl, fee, state, lever, reduce_only, c_time, fill_time)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [accountId, env,
       o.ordId, o.instId, o.side, o.ordType,
       o.sz ?? 0, o.avgPx ?? 0, o.fillSz ?? 0,
       o.pnl ?? 0, o.fee ?? 0, o.state ?? '',
       o.lever ?? '', o.reduceOnly ?? false,
       o.cTime ?? 0, o.fillTime ?? 0]
    );
  }
}

function _fromRow(r) {
  return {
    ordId:      r.ord_id,
    instId:     r.inst_id,
    side:       r.side,
    ordType:    r.ord_type,
    sz:         r.sz,
    avgPx:      r.avg_px,
    fillSz:     r.fill_sz,
    pnl:        r.pnl,
    fee:        r.fee,
    state:      r.state,
    lever:      r.lever,
    reduceOnly: r.reduce_only,
    cTime:      Number(r.c_time),
    fillTime:   Number(r.fill_time),
  };
}

module.exports = { init, ordersStore, upsertOrders };
