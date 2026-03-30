'use strict';
/**
 * plugins/okx/actions/account.js
 *
 * Handles: balance/positions/history (slow refresh), open orders, algo orders,
 *          setMode, refresh, pnlQuery.
 * Populates: ctx.refresh.slow, ctx.refresh.openOrders, ctx.refresh.algoOrders
 */

function register(ctx) {
  const { adapter, bus, cache, stores, refresh, getMode, setMode } = ctx;

  // ── Slow refresh: balance + positions + history ─────────────────────────────

  async function slowRefresh() {
    try {
      [cache.balance, cache.positions, cache.history] = await Promise.all([
        adapter.fetchBalance(getMode()),
        adapter.fetchPositions(getMode()),
        adapter.fetchHistory(getMode()),
      ]);
      cache.lastSlowUpdate = Date.now();
      if (cache.positions?.length) {
        cache.posMode = cache.positions.some(p => p.posSide !== 'net') ? 'long_short' : 'net';
      }
      try { stores.orders.upsertOrders(cache.history, getMode()); } catch (e) {
        console.error('[db] upsertOrders failed', e.message);
      }
    } catch (e) { console.error('[slow]', e.message); }
    bus.emit('broadcast', {
      type: 'snapshot',
      data: {
        balance:   cache.balance,
        positions: cache.positions,
        history:   cache.history,
        posMode:   cache.posMode,
      },
      mode: getMode(),
    });
    if (refresh.algoOrders) {
      refresh.algoOrders().catch(e => console.error('[algoOrders]', e.message));
    }
  }

  // ── Open orders refresh ─────────────────────────────────────────────────────

  async function openOrdersRefresh() {
    try {
      cache.openOrders = await adapter.fetchOpenOrders(getMode());
    } catch (e) { console.error('[openOrders]', e.message); }
    bus.emit('broadcast', { type: 'openOrders', data: cache.openOrders, mode: getMode() });
  }

  // ── Algo orders refresh ─────────────────────────────────────────────────────

  async function algoOrdersRefresh() {
    const positions = cache.positions || [];
    if (!positions.length) {
      cache.algoOrders = [];
      bus.emit('broadcast', { type: 'algoOrders', data: [] });
      return;
    }
    try {
      const results    = await Promise.all(positions.map(p => adapter.fetchAlgoOrders(p.instId, getMode())));
      cache.algoOrders = results.flat();
    } catch (e) { console.error('[algoOrders]', e.message); }
    bus.emit('broadcast', { type: 'algoOrders', data: cache.algoOrders });
  }

  // Expose on ctx.refresh
  refresh.slow       = slowRefresh;
  refresh.openOrders = openOrdersRefresh;
  refresh.algoOrders = algoOrdersRefresh;

  // ── Connect handler: send cached state on new WS connection ────────────────

  ctx.ws.registerConnect((ws) => {
    if (cache.balance) {
      ws.send(JSON.stringify({
        type: 'snapshot',
        data: { balance: cache.balance, positions: cache.positions, history: cache.history, posMode: cache.posMode },
        mode: getMode(),
      }));
    }
    ws.send(JSON.stringify({ type: 'openOrders', data: cache.openOrders, mode: getMode() }));
    ws.send(JSON.stringify({ type: 'algoOrders', data: cache.algoOrders, mode: getMode() }));
  });

  // ── Action handlers ─────────────────────────────────────────────────────────

  const actions = {
    async setMode(msg, ws) {
      setMode(msg.mode);
      // Send cached history for the new mode
      const aHist = ctx.stores.analysis.analysisHistory();
      ws.send(JSON.stringify({ type: 'analysisHistory', data: aHist.slice(-20) }));
      if (aHist.length) ws.send(JSON.stringify({ type: 'analysis', ...aHist[aHist.length - 1] }));
      const pHist = ctx.stores.postrack.posTrackHistory();
      ws.send(JSON.stringify({ type: 'positionTrackHistory', data: pHist.slice(-30), mode: getMode() }));
      await Promise.all([refresh.fast(), slowRefresh(), openOrdersRefresh()]);
      if (refresh.candles) await refresh.candles();
      await algoOrdersRefresh();
      return { type: 'modeChanged', mode: getMode() };
    },

    async refresh() {
      await Promise.all([refresh.fast(), slowRefresh()]);
      if (refresh.candles) await refresh.candles();
    },

    async pnlQuery(msg) {
      const windowMs = msg.window === '1d' ? 86400000 : 7 * 86400000;
      const cutoff   = Date.now() - windowMs;
      const orders   = [...stores.orders.ordersStore[getMode()].values()]
        .filter(o => (o.fillTime || o.cTime) >= cutoff);
      const total    = orders.reduce((s, o) => s + o.pnl + o.fee, 0);
      return { type: 'pnlResult', window: msg.window, total, count: orders.length };
    },
  };

  // ── Timers ──────────────────────────────────────────────────────────────────

  const timers = [
    { name: 'slow',   fn: slowRefresh,       intervalMs: 60000 },
    { name: 'orders', fn: openOrdersRefresh, intervalMs: 10000 },
  ];

  async function onReady() {
    await Promise.all([slowRefresh(), openOrdersRefresh()]);
  }

  return { actions, timers, onReady };
}

module.exports = { register };
