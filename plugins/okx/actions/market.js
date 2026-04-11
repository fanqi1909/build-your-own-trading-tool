'use strict';
/**
 * plugins/okx/actions/market.js
 *
 * Handles: ticker fast refresh, candle refresh, technical analysis runner.
 * Populates: ctx.refresh.fast, ctx.refresh.candles, ctx.refresh.runAnalysis
 */

const { exec } = require('child_process');
const path     = require('path');
const fs       = require('fs');

const HIGHER_BAR = {
  '1m':'5m', '3m':'15m', '5m':'15m',
  '15m':'1H', '30m':'1H', '1H':'4H', '4H':'1D',
};

const BAR_MS = {
  '1m':60000,'3m':180000,'5m':300000,'15m':900000,
  '30m':1800000,'1H':3600000,'4H':14400000,'1D':86400000,
};

function register(ctx) {
  const { adapter, bus, cache, stores, refresh, getMode } = ctx;
  const ANALYZE_PY = process.env.ANALYZE_PY || path.join(__dirname, '../../../analyze.py');

  // Instrument metadata cache: instId → { instId, baseCcy, ctVal, lotSz, minSz, tickSz, maxLever }
  cache.instruments = {};
  // Active instrument (updated by client via fetchTicker)
  cache.activeInst = 'BTC-USDT';

  async function _loadInstruments() {
    try {
      const raw = await adapter.fetchInstruments(getMode());
      for (const inst of raw) {
        cache.instruments[inst.instId] = {
          instId:   inst.instId,
          baseCcy:  inst.ctBaseCcy || inst.baseCcy || inst.instId.split('-')[0],
          ctVal:    inst.ctVal    || '1',
          lotSz:    inst.lotSz   || '1',
          minSz:    inst.minSz   || '1',
          tickSz:   inst.tickSz  || '0.1',
          maxLever: inst.lever   || '125',
        };
      }
      console.log(`[instruments] loaded ${raw.length} SWAP instruments`);
    } catch (e) {
      console.warn('[instruments] failed to load:', e.message);
    }
  }

  async function fastRefresh(inst = cache.activeInst || 'BTC-USDT') {
    try {
      cache.ticker = await adapter.fetchTicker(inst, getMode());
    } catch (e) {
      console.error('[fast]', e.message);
    }
    bus.emit('broadcast', { type: 'ticker', data: cache.ticker, mode: getMode() });
  }

  function _runAnalysisForBar(inst, bar) {
    const flag = getMode() === 'demo' ? '--demo' : '--profile live';
    const cmd  = `okx ${flag} market candles ${inst} --bar ${bar} --limit 200 --json`
               + ` | python3 "${ANALYZE_PY}" --inst ${inst} --bar ${bar}`;
    const env  = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` };
    return new Promise((resolve, reject) =>
      exec(cmd, { timeout: 20000, env }, (err, stdout, stderr) =>
        err ? reject(new Error(stderr || err.message)) : resolve(stdout)
      )
    );
  }

  async function runAnalysis(inst = 'BTC-USDT', bar = '15m') {
    if (!fs.existsSync(ANALYZE_PY)) throw new Error(`analyze.py not found: ${ANALYZE_PY}`);
    const higherBar = HIGHER_BAR[bar] || '1H';
    const tasks = [
      _runAnalysisForBar(inst, bar),
      _runAnalysisForBar(inst, higherBar),
    ];
    if (bar !== '3m') tasks.push(_runAnalysisForBar(inst, '3m'));
    const [primary, higher, lower] = await Promise.all(tasks);
    const lowerSection = lower ? `\n【短线信号 3m】\n${lower}` : '';
    return `【主图 ${bar}】\n${primary}\n【趋势参考 ${higherBar}】\n${higher}${lowerSection}`;
  }

  async function candleRefresh(inst = cache.activeInst || 'BTC-USDT', bar = '15m') {
    try {
      const conn    = stores.candles.getCandleConn();
      const fetches = [adapter.fetchCandles(inst, bar, 100, getMode())];
      if (bar !== '3m') fetches.push(adapter.fetchCandles(inst, '3m', 100, getMode()));
      const [fresh, fresh3m] = await Promise.all(fetches);
      if (conn && fresh.length) await stores.candles.upsertCandles(inst, bar, fresh);
      if (conn && fresh3m?.length) await stores.candles.upsertCandles(inst, '3m', fresh3m);
      const full = conn ? await stores.candles.loadCandlesFromDB(inst, bar, 500) : fresh;
      cache.candles = full.length ? full : fresh;
      cache.lastCandleUpdate = Date.now();
    } catch (e) {
      console.error('[candles]', e.message);
    }
    bus.emit('broadcast', { type: 'candles', data: cache.candles, inst, bar });
    if (refresh.analysis) {
      await refresh.analysis(inst, bar);
    }
  }

  refresh.fast        = fastRefresh;
  refresh.candles     = candleRefresh;
  refresh.runAnalysis = runAnalysis;

  ctx.ws.registerConnect((ws) => {
    if (cache.ticker)  ws.send(JSON.stringify({ type: 'ticker',  data: cache.ticker,  mode: getMode() }));
    if (cache.candles) ws.send(JSON.stringify({ type: 'candles', data: cache.candles }));
  });

  const actions = {
    async candles(msg) {
      await candleRefresh(msg.inst || 'BTC-USDT-SWAP', msg.bar || '15m');
    },

    async fetchTicker(msg) {
      const inst = msg.inst || cache.activeInst || 'BTC-USDT';
      cache.activeInst = inst;   // remember for timer
      await fastRefresh(inst);
    },

    async fetchAtr(msg) {
      try {
        const inst = msg?.inst || 'BTC-USDT-SWAP';
        const candles = await adapter.fetchCandles(inst, '3m', 20, getMode());
        return { type: 'atrData', candles };
      } catch (e) {
        return { type: 'atrData', error: e.message };
      }
    },

    async fetchInstruments() {
      const list = Object.values(cache.instruments);
      if (!list.length) await _loadInstruments();
      return { type: 'instrumentList', instruments: Object.values(cache.instruments) };
    },

    async fetchInstrumentMeta(msg) {
      const inst = msg?.inst;
      if (!inst) return { type: 'instrumentMeta', inst, meta: null };
      let meta = cache.instruments[inst];
      if (!meta) {
        await _loadInstruments();
        meta = cache.instruments[inst] || null;
      }
      return { type: 'instrumentMeta', inst, meta };
    },
  };

  const timers = [
    { name: 'fast', fn: fastRefresh, intervalMs: 5000 },
    { name: 'candles', fn: () => candleRefresh(), intervalMs: 10 * 60 * 1000 },
  ];

  async function onReady() {
    _loadInstruments(); // warm cache in background, don't block startup
    await fastRefresh();
    await candleRefresh();
  }

  return { actions, timers, onReady };
}

module.exports = { register };
