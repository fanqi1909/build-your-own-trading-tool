'use strict';
// Extracted from lib/store.js — orders section

const fs   = require('fs');
const path = require('path');

// Map<ordId, order>, separated by mode
const ordersStore = { demo: new Map(), live: new Map() };
let _dataDir = './data';

function _file(mode) { return path.join(_dataDir, `orders-${mode}.json`); }

function init(getMode, dataDir) {
  _dataDir = dataDir;
  for (const mode of ['demo', 'live']) {
    try {
      const file = _file(mode);
      if (fs.existsSync(file)) {
        const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
        arr.forEach(o => ordersStore[mode].set(o.ordId, o));
        console.log(`[orders:${mode}] loaded ${ordersStore[mode].size} orders`);
      }
    } catch (e) { console.error('[orders] load error', e.message); }
  }
}

function saveOrders(mode) {
  try {
    fs.writeFileSync(_file(mode), JSON.stringify([...ordersStore[mode].values()]));
  } catch (e) { console.error(`[orders] save(${mode}) error`, e.message); }
}

function upsertOrders(orders, mode) {
  if (!orders.length) return;
  orders.forEach(o => ordersStore[mode].set(o.ordId, o));
  saveOrders(mode);
}

module.exports = { init, ordersStore, saveOrders, upsertOrders };
