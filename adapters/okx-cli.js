'use strict';

const { exec } = require('child_process');
const { AdapterError } = require('./base');

// ─── Internal CLI runner ────────────────────────────────
// Sole place that knows about --demo / --profile live flags.
function _run(args, mode) {
  const flag = mode === 'demo' ? '--demo' : '--profile live';
  const cmd  = `okx ${flag} ${args} --json`;
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        let msg = stderr?.trim() || err.message;
        try {
          const d = JSON.parse(stdout);
          msg = (Array.isArray(d) ? d[0]?.sMsg : d?.msg) || msg;
        } catch {}
        return reject(new AdapterError(msg));
      }
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new AdapterError('JSON parse failed: ' + stdout.slice(0, 200), 'PARSE_ERROR')); }
    });
  });
}

// ─── Read ───────────────────────────────────────────────

/** @returns {Promise<import('./base').Ticker|null>} */
async function fetchTicker(inst, mode) {
  const data = await _run(`market ticker ${inst}`, mode);
  return data?.[0] ?? null;
}

/** @returns {Promise<import('./base').Balance[]>} */
async function fetchBalance(mode) {
  const data = await _run('account balance', mode);
  const arr  = Array.isArray(data?.[0]?.details) ? data[0].details : (Array.isArray(data) ? data : []);
  return arr.map(d => ({
    ccy:      d.ccy,
    eq:       parseFloat(d.eq),
    eqUsd:    parseFloat(d.eqUsd),
    availBal: parseFloat(d.availBal),
  }));
}

/** @returns {Promise<import('./base').Position[]>} */
async function fetchPositions(mode) {
  const data = await _run('swap positions', mode);
  return (data ?? []).map(p => ({
    instId:      p.instId,
    pos:         p.pos,
    avgPx:       parseFloat(p.avgPx),
    markPx:      parseFloat(p.markPx),
    upl:         parseFloat(p.upl),
    uplRatio:    parseFloat(p.uplRatio),
    lever:       p.lever,
    mgnMode:     p.mgnMode,
    mgnRatio:    parseFloat(p.mgnRatio),
    notionalUsd: parseFloat(p.notionalUsd),
    liqPx:       p.liqPx,
    posSide:     p.posSide,
  }));
}

/** @returns {Promise<import('./base').Candle[]>} */
async function fetchCandles(inst, bar, limit, mode) {
  const data = await _run(`market candles ${inst} --bar ${bar} --limit ${limit}`, mode);
  return (data ?? [])
    .filter(c => c[8] === '1')
    .map(c => ({
      ts:  parseInt(c[0]),
      o:   parseFloat(c[1]),
      h:   parseFloat(c[2]),
      l:   parseFloat(c[3]),
      c:   parseFloat(c[4]),
      vol: parseFloat(c[5]),
    }))
    .reverse();
}

async function fetchCandlesBefore(inst, bar, limit, beforeTs, mode) {
  const data = await _run(
    `market candles ${inst} --bar ${bar} --limit ${limit} --before ${beforeTs}`,
    mode
  );
  return (data ?? [])
    .filter(c => c[8] === '1')
    .map(c => ({
      ts:  parseInt(c[0]),
      o:   parseFloat(c[1]),
      h:   parseFloat(c[2]),
      l:   parseFloat(c[3]),
      c:   parseFloat(c[4]),
      vol: parseFloat(c[5]),
    }))
    .reverse();
}

/** @returns {Promise<import('./base').Order[]>} */
async function fetchHistory(mode) {
  const data = await _run('swap orders --history', mode);
  return (data ?? []).map(o => ({
    ordId:      o.ordId,
    instId:     o.instId,
    side:       o.side,
    reduceOnly: o.reduceOnly === 'true',
    ordType:    o.ordType,
    sz:         parseFloat(o.sz),
    avgPx:      parseFloat(o.avgPx) || 0,
    fillSz:     parseFloat(o.accFillSz) || 0,
    pnl:        parseFloat(o.pnl) || 0,
    fee:        parseFloat(o.fee) || 0,
    state:      o.state,
    lever:      o.lever,
    cTime:      parseInt(o.cTime),
    fillTime:   parseInt(o.fillTime),
  }));
}

// ─── Write ──────────────────────────────────────────────

async function setLeverage({ inst, lever, mgnMode, posMode }, mode) {
  if (posMode === 'long_short') {
    // 买卖模式需同时设多空两侧
    await Promise.all([
      _run(`swap leverage --instId ${inst} --lever ${lever} --mgnMode ${mgnMode} --posSide long`, mode),
      _run(`swap leverage --instId ${inst} --lever ${lever} --mgnMode ${mgnMode} --posSide short`, mode),
    ]);
  } else {
    await _run(`swap leverage --instId ${inst} --lever ${lever} --mgnMode ${mgnMode}`, mode);
  }
}

/** @returns {Promise<{ ordId: string }>} */
async function placeMarketOrder({ inst, side, sz, posSide }, mode) {
  let args = `swap place --instId ${inst} --side ${side} --sz ${sz} --ordType market`;
  if (posSide) args += ` --posSide ${posSide}`;
  const data = await _run(args, mode);
  const ordId = Array.isArray(data) ? data[0]?.ordId : data?.ordId;
  return { ordId };
}

async function placeAlgoOrder({ inst, side, sz, sl, tp, posSide }, mode) {
  let args = `swap algo place --instId ${inst} --side ${side} --sz ${sz} --ordType oco --reduceOnly`;
  if (posSide) args += ` --posSide ${posSide}`;
  if (tp) args += ` --tpTriggerPx ${tp} --tpOrdPx=-1`;
  if (sl) args += ` --slTriggerPx ${sl} --slOrdPx=-1`;
  await _run(args, mode);
}

async function closePosition({ inst, closeSide, sz, posSide }, mode) {
  let args = `swap place --instId ${inst} --side ${closeSide} --sz ${sz} --ordType market`;
  if (posSide) args += ` --posSide ${posSide}`;
  await _run(args, mode);
}

// ─── Open orders ────────────────────────────────────────

async function fetchOpenOrders(mode) {
  const data = await _run('swap orders', mode);
  return (data ?? []).map(o => ({
    ordId:   o.ordId,
    instId:  o.instId,
    side:    o.side,
    sz:      parseFloat(o.sz),
    px:      parseFloat(o.px) || 0,
    ordType: o.ordType,
    state:   o.state,
    fillSz:  parseFloat(o.accFillSz) || 0,
    cTime:   parseInt(o.cTime),
  }));
}

/** @returns {Promise<{ ordId: string }>} */
async function placeLimitOrder({ inst, side, sz, px, postOnly, posSide, sl, tp }, mode) {
  const ordType = postOnly ? 'post_only' : 'limit';
  let args = `swap place --instId ${inst} --side ${side} --sz ${sz} --ordType ${ordType} --px ${px}`;
  if (posSide) args += ` --posSide ${posSide}`;
  if (tp) args += ` --tpTriggerPx ${tp} --tpOrdPx=-1`;
  if (sl) args += ` --slTriggerPx ${sl} --slOrdPx=-1`;
  const data = await _run(args, mode);
  const ordId = Array.isArray(data) ? data[0]?.ordId : data?.ordId;
  return { ordId };
}

async function cancelOrder({ inst, ordId }, mode) {
  await _run(`swap cancel ${inst} --ordId ${ordId}`, mode);
}

async function amendOrder({ inst, ordId, newPx, newSz, side, ordType }, mode) {
  // CLI has no `swap amend` — cancel and re-place
  await _run(`swap cancel ${inst} --ordId ${ordId}`, mode);
  let placeArgs = `swap place --instId ${inst} --side ${side} --ordType ${ordType || 'limit'} --sz ${newSz}`;
  if (newPx != null) placeArgs += ` --px ${newPx}`;
  const result = await _run(placeArgs, mode);
  return result;
}

async function fetchAlgoOrders(inst, mode) {
  const data = await _run(`swap algo orders --instId ${inst} --ordType oco`, mode);
  return (data ?? []).map(o => ({
    algoId:      o.algoId,
    instId:      o.instId,
    side:        o.side,
    sz:          parseFloat(o.sz),
    slTriggerPx: o.slTriggerPx || null,
    tpTriggerPx: o.tpTriggerPx || null,
    state:       o.state,
  }));
}

async function amendAlgoOrder({ inst, algoId, sl, tp }, mode) {
  let args = `swap algo amend --instId ${inst} --algoId ${algoId}`;
  if (tp) args += ` --newTpTriggerPx ${tp} --newTpOrdPx=-1`;
  if (sl) args += ` --newSlTriggerPx ${sl} --newSlOrdPx=-1`;
  await _run(args, mode);
}

module.exports = {
  fetchTicker,
  fetchBalance,
  fetchPositions,
  fetchCandles,
  fetchCandlesBefore,
  fetchHistory,
  setLeverage,
  placeMarketOrder,
  placeLimitOrder,
  placeAlgoOrder,
  closePosition,
  fetchOpenOrders,
  cancelOrder,
  amendOrder,
  fetchAlgoOrders,
  amendAlgoOrder,
};
