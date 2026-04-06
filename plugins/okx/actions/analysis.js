'use strict';
/**
 * plugins/okx/actions/analysis.js
 *
 * Handles: askClaude, tradeReview, tradeReviewClaude, chat, chatReset.
 * Timers: postrack (3min).
 * Populates: ctx.refresh.analysis, ctx.refresh.postrack
 */

const BAR_MS = {
  '1m':60000,'3m':180000,'5m':300000,'15m':900000,
  '30m':1800000,'1H':3600000,'4H':14400000,'1D':86400000,
};

function register(ctx) {
  const { adapter, bus, cache, stores, refresh, getMode } = ctx;

  async function autoClaudeAssess() {
    const hist   = stores.analysis.analysisHistory();
    const latest = hist[hist.length - 1];
    if (!latest) return;
    try {
      const analysisPrompt = require('../prompts/analysis');
      const response = await analysisPrompt.run(latest, cache.positions || [], getMode());
      latest.claudeResponse = response;
      stores.analysis.saveAnalysisHistory();
      bus.emit('broadcast', { type: 'claudeResponse', ts: Date.now(), analysisTs: latest.ts, response, auto: true });
      console.log('[claude] auto-assess done');
    } catch (e) { console.error('[claude] auto-assess error', e.message); }
  }

  async function positionTrackRefresh() {
    if (!cache.positions?.length) return;
    const hist   = stores.analysis.analysisHistory();
    const latest = hist[hist.length - 1];
    if (!latest) return;
    try {
      const trackPrompt = require('../prompts/tracking');
      const out   = await trackPrompt.run(latest.raw, cache.positions, getMode());
      const entry = { ts: Date.now(), text: out };
      stores.postrack.posTrackHistory().push(entry);
      stores.postrack.savePosTrackHistory();
      bus.emit('broadcast', { type: 'positionTrack', ...entry, mode: getMode() });
      console.log('[posTrack] done');
    } catch (e) { console.error('[posTrack] error', e.message); }
  }

  async function analysisRefresh(inst = 'BTC-USDT', bar = '15m') {
    try {
      const raw    = await refresh.runAnalysis(inst, bar);
      const parsed = stores.analysis.parseAnalysis(raw);
      const barMs  = BAR_MS[bar] || 900000;
      const now    = Date.now();
      const hist   = stores.analysis.analysisHistory();
      const last   = hist[hist.length - 1];

      let entryTs = now;
      if (last && Math.floor(last.ts / barMs) === Math.floor(now / barMs)) {
        entryTs = last.ts;
        hist[hist.length - 1] = { ...last, raw, ...parsed };
      } else {
        hist.push({ ts: entryTs, inst, bar, raw, ...parsed });
      }

      stores.analysis.saveAnalysisHistory();
      bus.emit('broadcast', { type: 'analysis', ts: entryTs, inst, bar, raw, ...parsed });
      autoClaudeAssess().catch(e => console.error('[claude] assess error', e.message));
      positionTrackRefresh().catch(e => console.error('[posTrack] error', e.message));
    } catch (e) {
      console.error('[analysis]', e.message);
      bus.emit('broadcast', { type: 'analysisError', error: e.message });
    }
  }

  refresh.analysis = analysisRefresh;
  refresh.postrack = positionTrackRefresh;

  function findNearestAnalysis(ts) {
    const hist   = stores.analysis.analysisHistories[getMode()];
    const before = hist.filter(e => e.ts <= ts);
    return before.length ? before[before.length - 1] : null;
  }

  ctx.ws.registerConnect((ws) => {
    const aHist = stores.analysis.analysisHistory();
    if (aHist.length) {
      ws.send(JSON.stringify({ type: 'analysis',        ...aHist[aHist.length - 1] }));
      ws.send(JSON.stringify({ type: 'analysisHistory', data: aHist.slice(-20) }));
    }
    const pHist = stores.postrack.posTrackHistory();
    if (pHist.length) {
      const latest = pHist[pHist.length - 1];
      ws.send(JSON.stringify({ type: 'positionTrack',        ...latest,              mode: getMode() }));
      ws.send(JSON.stringify({ type: 'positionTrackHistory', data: pHist.slice(-30), mode: getMode() }));
    }
  });

  const actions = {
    async askClaude(msg, ws) {
      const aHist = stores.analysis.analysisHistory();
      const entry = msg.analysisTs ? aHist.find(e => e.ts === msg.analysisTs) : aHist[aHist.length - 1];
      if (!entry) return { type: 'claudeError', error: '没有分析数据' };
      ws.send(JSON.stringify({ type: 'claudeThinking' }));
      try {
        const analysisPrompt = require('../prompts/analysis');
        const response = await analysisPrompt.run(entry, cache.positions || [], getMode());
        return { type: 'claudeResponse', ts: Date.now(), analysisTs: entry.ts, response, auto: false };
      } catch (e) {
        return { type: 'claudeError', error: e.message };
      }
    },

    async tradeReview(msg) {
      const { ordId, bar = '15m' } = msg;
      const order = stores.orders.ordersStore[getMode()].get(ordId);
      if (!order) return { type: 'tradeReviewError', ordId, error: '订单不存在' };

      const fillTs = order.fillTime || order.cTime;
      const inst   = order.instId.replace('-SWAP', '');
      let candles  = [];

      try { candles = await stores.candles.loadCandlesAroundTime(inst, bar, fillTs); }
      catch (e) { console.error('[tradeReview] DuckDB', e.message); }

      if (candles.length < 10) {
        try {
          const fresh = await adapter.fetchCandlesBefore(inst, bar, 100, fillTs + 30 * 60000, getMode());
          const conn  = stores.candles.getCandleConn();
          if (conn && fresh.length) await stores.candles.upsertCandles(inst, bar, fresh);
          candles = await stores.candles.loadCandlesAroundTime(inst, bar, fillTs);
        } catch (e) { console.error('[tradeReview] fetch fresh', e.message); }
      }

      const nearest = findNearestAnalysis(fillTs);
      return {
        type:        'tradeReviewData',
        ordId, order, candles, bar,
        analysisTs:  nearest?.ts  ?? null,
        analysisRaw: nearest?.raw ?? null,
        hasData:     candles.length > 0,
      };
    },

    async tradeReviewClaude(msg, ws) {
      const { ordId, bar = '15m' } = msg;
      const order = stores.orders.ordersStore[getMode()].get(ordId);
      if (!order) return { type: 'tradeReviewClaudeError', ordId, error: '订单不存在' };

      const fillTs = order.fillTime || order.cTime;
      const inst   = order.instId.replace('-SWAP', '');
      let candles  = [];
      try { candles = await stores.candles.loadCandlesAroundTime(inst, bar, fillTs); } catch {}

      const nearest = findNearestAnalysis(fillTs);
      ws.send(JSON.stringify({ type: 'tradeReviewClaudeThinking', ordId }));
      try {
        const postmortem = require('../prompts/postmortem');
        const response   = await postmortem.run(order, candles, nearest?.raw ?? null, getMode(), bar);
        return { type: 'tradeReviewClaude', ordId, response };
      } catch (e) {
        return { type: 'tradeReviewClaudeError', ordId, error: e.message };
      }
    },

    async chat(msg, ws) {
      const { message, enabledIds = [], dashboardContext = null } = msg;
      if (!message?.trim()) return;
      ws.send(JSON.stringify({ type: 'chatThinking' }));

      let layoutPrefix;
      if (dashboardContext?.tabs?.length) {
        const lines = dashboardContext.tabs.map(tab => `- ${tab.title}: ${tab.enabledIds?.length ? tab.enabledIds.join(', ') : 'empty'}`);
        const active = dashboardContext.tabs.find(tab => tab.id === dashboardContext.activeTabId);
        layoutPrefix = `[Dashboard Tabs:\n${lines.join('\n')}\nActive Tab: ${active?.title || 'unknown'}]`;
      } else {
        layoutPrefix = `[Layout: ${enabledIds.length ? enabledIds.join(', ') : 'empty'}]`;
      }

      const ctxMessage = `${layoutPrefix}\n\n${message}`;
      let fullResponse = '';

      try {
        await ctx._chatSession.send(ctxMessage, (chunk) => {
          fullResponse += chunk;
          ws.send(JSON.stringify({ type: 'chatChunk', text: chunk }));
        });

        const actions = ctx._parseActions(fullResponse);
        for (const action of actions) {
          ws.send(JSON.stringify({ type: 'chatAction', ...action }));
        }

        ws.send(JSON.stringify({ type: 'chatDone' }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'chatError', error: e.message }));
      }
    },

    async chatReset() {
      ctx._chatSession.reset();
      return { type: 'chatReset' };
    },
  };

  return {
    actions,
    timers: [
      { name: 'postrack', fn: positionTrackRefresh, intervalMs: 180000 },
    ],
    onReady: async () => {},
  };
}

module.exports = { register };
