/**
 * OKX Real-time Dashboard Server
 *
 * 用法:
 *   npm install
 *   node server.js
 *
 * 然后打开 http://localhost:3000
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const { exec } = require('child_process');
const http = require('http');
const path = require('path');
const fs   = require('fs');

// ─── Exchange Adapter ─────────────────────────────────
const ADAPTER  = process.env.EXCHANGE_ADAPTER || 'okx-cli';
const exchange = require(`./adapters/${ADAPTER}`);

// ─── Data Store ──────────────────────────────────────
const store = require('./lib/store');
const {
  ordersStore, loadOrders, saveOrders, upsertOrders,
  posTrackHistories, posTrackHistory, loadPosTrackHistory, savePosTrackHistory, setPosTrackModeGetter, closeDB,
  initCandleDB, upsertCandles, loadCandlesFromDB, loadCandlesAroundTime, getCandleConn,
  analysisHistories, analysisHistory, loadAnalysisHistory, saveAnalysisHistory, parseAnalysis,
} = store;

// ─── AI Layer ────────────────────────────────────────
const ai = require('./lib/ai');
const { spawnClaude, runClaudeAnalysis, buildPositionTrackPrompt, runPostmortem } = ai;

// ─── Chat Session (per-server singleton) ─────────────
const { ChatSession } = require('./lib/chat');
const chatSession = new ChatSession();

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const PORT = 3000;

// ─── analyze.py 路径（可通过环境变量覆盖）────────────────
const ANALYZE_PY = process.env.ANALYZE_PY
  || path.join(__dirname, 'analyze.py');

// ─── 账户模式 ───────────────────────────────────────────
let currentMode = 'demo';

// 注入 mode getter 供 store 内部使用
setPosTrackModeGetter(() => currentMode);
store.analysisHistories; // ensure loaded
// 将 currentMode getter 传给 analysisHistory / posTrackHistory（通过 store 的 getter）

// ─── 状态缓存 ─────────────────────────────────────────
const cache = {
  ticker:          null,
  balance:         null,
  positions:       null,
  history:         null,
  candles:         null,
  openOrders:      [],
  algoOrders:      [],
  posMode:         'net',   // 'net' | 'long_short'，从持仓 posSide 字段推断
  lastSlowUpdate:  0,
  lastCandleUpdate: 0,
};

// ─── 广播 ─────────────────────────────────────────────
function broadcast(msg) {
  const str = JSON.stringify(msg);
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(str);
  });
}

// ─── Claude 自动评估 ──────────────────────────────────
async function autoClaudeAssess() {
  const hist = analysisHistory();
  const latest = hist[hist.length - 1];
  if (!latest) return;
  try {
    const response = await runClaudeAnalysis(latest, cache.positions || [], currentMode);
    latest.claudeResponse = response;
    saveAnalysisHistory();
    broadcast({ type: 'claudeResponse', ts: Date.now(), analysisTs: latest.ts, response, auto: true });
    console.log('[claude] auto-assess done');
  } catch (e) {
    console.error('[claude] auto-assess error', e.message);
  }
}

// ─── 仓位追踪刷新 ────────────────────────────────────
async function positionTrackRefresh() {
  if (!cache.positions || !cache.positions.length) return;
  const hist = analysisHistory();
  const latest = hist[hist.length - 1];
  if (!latest) return;
  try {
    const prompt = buildPositionTrackPrompt(latest.raw, cache.positions, currentMode);
    const out    = await spawnClaude(prompt);
    const entry  = { ts: Date.now(), text: out };
    posTrackHistory().push(entry);
    savePosTrackHistory();
    broadcast({ type: 'positionTrack',        ...entry,                       mode: currentMode });
    console.log('[posTrack] done');
  } catch (e) {
    console.error('[posTrack] error', e.message);
  }
}

// ─── 技术分析 ─────────────────────────────────────────
const HIGHER_BAR = {
  '1m':'5m', '3m':'15m', '5m':'15m',
  '15m':'1H', '30m':'1H', '1H':'4H', '4H':'1D'
};

async function _runAnalysisForBar(inst, bar) {
  const flag = currentMode === 'demo' ? '--demo' : '--profile live';
  const cmd  = `okx ${flag} market candles ${inst} --bar ${bar} --limit 200 --json`
             + ` | python3 "${ANALYZE_PY}" --inst ${inst} --bar ${bar}`;
  return new Promise((resolve, reject) =>
    exec(cmd, { timeout: 20000 }, (err, stdout, stderr) =>
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
  // 3m 作为固定短线信号层（仅当主图本身不是 3m 时追加）
  if (bar !== '3m') tasks.push(_runAnalysisForBar(inst, '3m'));
  const [primary, higher, lower] = await Promise.all(tasks);
  const lowerSection = lower ? `\n【短线信号 3m】\n${lower}` : '';
  return `【主图 ${bar}】\n${primary}\n【趋势参考 ${higherBar}】\n${higher}${lowerSection}`;
}

const BAR_MS = { '1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1H':3600000,'4H':14400000,'1D':86400000 };

async function analysisRefresh(inst = 'BTC-USDT', bar = '15m') {
  try {
    const raw    = await runAnalysis(inst, bar);
    const parsed = parseAnalysis(raw);
    const now    = Date.now();
    const barMs  = BAR_MS[bar] || 900000;
    const hist   = analysisHistory();
    const last   = hist[hist.length - 1];

    let entryTs = now;
    if (last && Math.floor(last.ts / barMs) === Math.floor(now / barMs)) {
      entryTs = last.ts;
      hist[hist.length - 1] = { ...last, raw, ...parsed };
    } else {
      hist.push({ ts: entryTs, inst, bar, raw, ...parsed });
    }

    saveAnalysisHistory();
    broadcast({ type: 'analysis', ts: entryTs, inst, bar, raw, ...parsed });
    autoClaudeAssess().catch(e => console.error('[claude] assess error', e.message));
    positionTrackRefresh().catch(e => console.error('[posTrack] error', e.message));
  } catch (e) {
    console.error('[analysis]', e.message);
    broadcast({ type: 'analysisError', error: e.message });
  }
}

function queryPnl(mode, cutoffMs) {
  const orders = [...ordersStore[mode].values()]
    .filter(o => (o.fillTime || o.cTime) >= cutoffMs);
  const total = orders.reduce((s, o) => s + o.pnl + o.fee, 0);
  return { total, count: orders.length };
}

function findNearestAnalysis(ts, mode) {
  const hist   = analysisHistories[mode];
  const before = hist.filter(e => e.ts <= ts);
  if (!before.length) return null;
  return before[before.length - 1];
}

// ─── 刷新函数 ─────────────────────────────────────────

async function fastRefresh() {
  try {
    cache.ticker = await exchange.fetchTicker('BTC-USDT', currentMode);
  } catch (e) {
    console.error('[fast]', e.message);
  }
  broadcast({ type: 'ticker', data: cache.ticker, mode: currentMode });
}

async function slowRefresh() {
  try {
    [cache.balance, cache.positions, cache.history] = await Promise.all([
      exchange.fetchBalance(currentMode),
      exchange.fetchPositions(currentMode),
      exchange.fetchHistory(currentMode),
    ]);
    cache.lastSlowUpdate = Date.now();
    // 从持仓 posSide 字段推断持仓模式
    if (cache.positions && cache.positions.length) {
      cache.posMode = cache.positions.some(p => p.posSide !== 'net') ? 'long_short' : 'net';
    }
    try { upsertOrders(cache.history, currentMode); } catch (e) {
      console.error('[db] upsertOrders failed', e.message);
    }
  } catch (e) {
    console.error('[slow]', e.message);
  }
  broadcast({
    type: 'snapshot',
    data: {
      balance:   cache.balance,
      positions: cache.positions,
      history:   cache.history,
      posMode:   cache.posMode,
    },
    mode: currentMode,
  });
  algoOrdersRefresh().catch(e => console.error('[algoOrders]', e.message));
}

async function openOrdersRefresh() {
  try {
    cache.openOrders = await exchange.fetchOpenOrders(currentMode);
  } catch (e) {
    console.error('[openOrders]', e.message);
  }
  broadcast({ type: 'openOrders', data: cache.openOrders, mode: currentMode });
}

async function algoOrdersRefresh() {
  const positions = cache.positions || [];
  if (!positions.length) {
    cache.algoOrders = [];
    broadcast({ type: 'algoOrders', data: [] });
    return;
  }
  try {
    const results = await Promise.all(
      positions.map(p => exchange.fetchAlgoOrders(p.instId, currentMode))
    );
    cache.algoOrders = results.flat();
    broadcast({ type: 'algoOrders', data: cache.algoOrders });
  } catch (e) {
    console.error('[algoOrders]', e.message);
  }
}

async function candleRefresh(inst = 'BTC-USDT', bar = '15m') {
  try {
    const conn = getCandleConn();
    // 主图 K 线 + 3m 短线 K 线同步入库
    const fetches = [exchange.fetchCandles(inst, bar, 100, currentMode)];
    if (bar !== '3m') fetches.push(exchange.fetchCandles(inst, '3m', 100, currentMode));
    const [fresh, fresh3m] = await Promise.all(fetches);
    if (conn && fresh.length)  await upsertCandles(inst, bar,  fresh);
    if (conn && fresh3m?.length) await upsertCandles(inst, '3m', fresh3m);
    const full = conn ? await loadCandlesFromDB(inst, bar, 500) : fresh;
    cache.candles = full.length ? full : fresh;
    cache.lastCandleUpdate = Date.now();
  } catch (e) {
    console.error('[candles]', e.message);
  }
  broadcast({ type: 'candles', data: cache.candles, inst, bar });
  await analysisRefresh(inst, bar);
}

// ─── 定时器（保存 ID 便于将来 graceful shutdown）────────
const timers = {
  fast:     setInterval(fastRefresh,                  5000),
  slow:     setInterval(slowRefresh,                 60000),
  orders:   setInterval(openOrdersRefresh,           10000),
  candles:  setInterval(candleRefresh,      10 * 60 * 1000),
  postrack: setInterval(positionTrackRefresh, 3 * 60 * 1000),
};

// ─── Graceful Shutdown ────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[shutdown] ${signal} received — stopping...`);
  Object.values(timers).forEach(clearInterval);
  wss.close();
  await new Promise(resolve => server.close(resolve));
  await closeDB();
  console.log('[shutdown] clean exit');
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── WebSocket 消息处理 ───────────────────────────────
wss.on('connection', async (ws) => {
  console.log('[ws] client connected');

  if (cache.ticker)   ws.send(JSON.stringify({ type: 'ticker',   data: cache.ticker,   mode: currentMode }));
  if (cache.balance)  ws.send(JSON.stringify({ type: 'snapshot', data: { balance: cache.balance, positions: cache.positions, history: cache.history, posMode: cache.posMode }, mode: currentMode }));
  if (cache.candles)  ws.send(JSON.stringify({ type: 'candles',  data: cache.candles }));
  ws.send(JSON.stringify({ type: 'openOrders',  data: cache.openOrders,  mode: currentMode }));
  ws.send(JSON.stringify({ type: 'algoOrders',  data: cache.algoOrders,  mode: currentMode }));
  const aHist = analysisHistory();
  if (aHist.length) {
    ws.send(JSON.stringify({ type: 'analysis',        ...aHist[aHist.length - 1] }));
    ws.send(JSON.stringify({ type: 'analysisHistory', data: aHist.slice(-20) }));
  }
  const pHist = posTrackHistory();
  if (pHist.length) {
    const latest = pHist[pHist.length - 1];
    ws.send(JSON.stringify({ type: 'positionTrack',        ...latest,                   mode: currentMode }));
    ws.send(JSON.stringify({ type: 'positionTrackHistory', data: pHist.slice(-30),      mode: currentMode }));
  }

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.action === 'setMode') {
      currentMode = msg.mode === 'live' ? 'live' : 'demo';
      console.log('[ws] mode switched to', currentMode);
      const aHist = analysisHistory();
      ws.send(JSON.stringify({ type: 'analysisHistory', data: aHist.slice(-20) }));
      if (aHist.length) ws.send(JSON.stringify({ type: 'analysis', ...aHist[aHist.length - 1] }));
      const pHist = posTrackHistory();
      ws.send(JSON.stringify({ type: 'positionTrackHistory', data: pHist.slice(-30), mode: currentMode }));
      await Promise.all([fastRefresh(), slowRefresh(), openOrdersRefresh()]);
      await candleRefresh();
      await algoOrdersRefresh();
      ws.send(JSON.stringify({ type: 'modeChanged', mode: currentMode }));
    }

    if (msg.action === 'candles') {
      await candleRefresh(msg.inst || 'BTC-USDT', msg.bar || '15m');
    }

    if (msg.action === 'refresh') {
      await Promise.all([fastRefresh(), slowRefresh(), candleRefresh()]);
    }

    if (msg.action === 'askClaude') {
      const entry = msg.analysisTs
        ? analysisHistory().find(e => e.ts === msg.analysisTs)
        : analysisHistory()[analysisHistory().length - 1];
      if (!entry) { ws.send(JSON.stringify({ type: 'claudeError', error: '没有分析数据' })); return; }
      ws.send(JSON.stringify({ type: 'claudeThinking' }));
      try {
        const response = await runClaudeAnalysis(entry, cache.positions, currentMode);
        ws.send(JSON.stringify({ type: 'claudeResponse', ts: Date.now(), analysisTs: entry.ts, response, auto: false }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'claudeError', error: e.message }));
      }
    }

    if (msg.action === 'placeOrder') {
      const { inst, side, sz, sl, tp, lever, ordType = 'market', px } = msg;
      if (!inst || !side || !sz) {
        ws.send(JSON.stringify({ type: 'orderResult', success: false, error: '参数不完整' }));
        return;
      }
      if ((ordType === 'limit' || ordType === 'post_only') && !px) {
        ws.send(JSON.stringify({ type: 'orderResult', success: false, error: '限价单需要指定价格' }));
        return;
      }
      // 买卖双向模式下开仓需要 posSide：buy→long，sell→short
      const posSide = cache.posMode === 'long_short' ? (side === 'buy' ? 'long' : 'short') : undefined;
      try {
        if (lever) {
          try {
            await exchange.setLeverage({ inst, lever, mgnMode: 'cross', posMode: cache.posMode }, currentMode);
            ws.send(JSON.stringify({ type: 'orderStream', chunk: `✓ 杠杆已设为 ${lever}×\n` }));
          } catch (e) {
            // 常见原因：已有策略单需先撤销才能改杠杆
            const hint = e.message.includes('TP/SL') || e.message.includes('trailing') ? '（请先撤销现有止损止盈单）' : '';
            ws.send(JSON.stringify({ type: 'orderStream', chunk: `⚠ 杠杆设置失败${hint}，继续下单\n` }));
          }
        }
        if (ordType === 'limit' || ordType === 'post_only') {
          await exchange.placeLimitOrder({ inst, side, sz, px, postOnly: ordType === 'post_only', posSide, sl, tp }, currentMode);
          const slTpNote = (sl || tp) ? `  SL:${sl || '—'}  TP:${tp || '—'}` : '';
          ws.send(JSON.stringify({ type: 'orderStream', chunk: `✓ 限价单已提交 @${px}${slTpNote}\n` }));
        } else {
          await exchange.placeMarketOrder({ inst, side, sz, posSide }, currentMode);
          ws.send(JSON.stringify({ type: 'orderStream', chunk: `✓ 开仓成功\n` }));
        }
        if (sl || tp) {
          const isLimit = ordType === 'limit' || ordType === 'post_only';
          if (isLimit) {
            // TP/SL 已随限价单一起提交（attachAlgoOrds），无需单独挂 algo 单
          } else {
            const oppSide = side === 'buy' ? 'sell' : 'buy';
            try {
              await exchange.placeAlgoOrder({ inst, side: oppSide, sz, sl, tp, posSide }, currentMode);
              ws.send(JSON.stringify({ type: 'orderStream', chunk: `✓ 止盈止损已设置  SL:${sl || '—'}  TP:${tp || '—'}\n` }));
            } catch (e) {
              ws.send(JSON.stringify({ type: 'orderStream', chunk: `⚠ 策略单失败: ${e.message}\n` }));
            }
          }
        }
        ws.send(JSON.stringify({ type: 'orderResult', success: true, data: '完成' }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'orderResult', success: false, error: e.message }));
      }
      slowRefresh().then(() => {
        algoOrdersRefresh().catch(e => console.error('[algoOrders]', e.message));
        positionTrackRefresh().catch(e => console.error('[posTrack]', e.message));
      });
      setTimeout(slowRefresh, 3000);
      openOrdersRefresh();
    }

    if (msg.action === 'fetchAtr') {
      try {
        const candles = await exchange.fetchCandles('BTC-USDT-SWAP', '3m', 20, currentMode);
        ws.send(JSON.stringify({ type: 'atrData', candles }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'atrData', error: e.message }));
      }
    }

    if (msg.action === 'cancelOrder') {
      const { inst, ordId } = msg;
      try {
        await exchange.cancelOrder({ inst, ordId }, currentMode);
        ws.send(JSON.stringify({ type: 'cancelResult', success: true, ordId }));
        openOrdersRefresh();
      } catch (e) {
        ws.send(JSON.stringify({ type: 'cancelResult', success: false, ordId, error: e.message }));
      }
    }

    if (msg.action === 'amendOrder') {
      const { inst, ordId, newPx, newSz, side, ordType } = msg;
      try {
        await exchange.amendOrder({ inst, ordId, newPx, newSz, side, ordType }, currentMode);
        ws.send(JSON.stringify({ type: 'amendResult', success: true, ordId }));
        openOrdersRefresh();
      } catch (e) {
        ws.send(JSON.stringify({ type: 'amendResult', success: false, ordId, error: e.message }));
      }
    }

    if (msg.action === 'closePosition') {
      const pos = (cache.positions || []).find(p => p.instId === msg.inst);
      if (!pos) {
        ws.send(JSON.stringify({ type: 'orderResult', success: false, error: '找不到持仓' }));
        return;
      }
      const closeSide = parseFloat(pos.pos) > 0 ? 'sell' : 'buy';
      const fullSz    = Math.abs(parseFloat(pos.pos));
      const sz        = msg.sz ? Math.min(parseFloat(msg.sz), fullSz) : fullSz;
      // 买卖双向模式需传入持仓的 posSide
      const closePosSide = cache.posMode === 'long_short' ? pos.posSide : undefined;
      try {
        await exchange.closePosition({ inst: msg.inst, closeSide, sz, posSide: closePosSide }, currentMode);
        const label = sz < fullSz ? `减仓 ${sz}张完成` : '平仓完成';
        ws.send(JSON.stringify({ type: 'orderResult', success: true, data: label }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'orderResult', success: false, error: e.message }));
      }
      slowRefresh().then(() => algoOrdersRefresh().catch(e => console.error('[algoOrders]', e.message)));
      setTimeout(slowRefresh, 3000);
    }

    if (msg.action === 'amendAlgoOrder') {
      const { inst, algoId, sl, tp } = msg;
      try {
        await exchange.amendAlgoOrder({ inst, algoId, sl, tp }, currentMode);
        ws.send(JSON.stringify({ type: 'orderResult', success: true, data: 'SL/TP 已更新' }));
        await algoOrdersRefresh();
      } catch (e) {
        ws.send(JSON.stringify({ type: 'orderResult', success: false, error: e.message }));
      }
    }

    if (msg.action === 'addAlgoOrder') {
      const { inst, side, sz, sl, tp } = msg;
      // side 是平仓方向（sell=平多/buy=平空），posSide 是持仓方向
      const algoPosSide = cache.posMode === 'long_short' ? (side === 'sell' ? 'long' : 'short') : undefined;
      try {
        await exchange.placeAlgoOrder({ inst, side, sz, sl, tp, posSide: algoPosSide }, currentMode);
        ws.send(JSON.stringify({ type: 'orderResult', success: true, data: 'SL/TP 已设置' }));
        await algoOrdersRefresh();
      } catch (e) {
        ws.send(JSON.stringify({ type: 'orderResult', success: false, error: e.message }));
      }
    }

    if (msg.action === 'pnlQuery') {
      const windowMs = msg.window === '1d' ? 86400000 : 7 * 86400000;
      const cutoff   = Date.now() - windowMs;
      const result   = queryPnl(currentMode, cutoff);
      ws.send(JSON.stringify({ type: 'pnlResult', window: msg.window, ...result }));
    }

    // ── tradeReview：拉 K 线 + 最近分析 ──────────────────────────────────
    if (msg.action === 'tradeReview') {
      const { ordId, bar = '15m' } = msg;
      const order = ordersStore[currentMode].get(ordId);
      if (!order) {
        ws.send(JSON.stringify({ type: 'tradeReviewError', ordId, error: '订单不存在' }));
        return;
      }
      const fillTs = order.fillTime || order.cTime;
      const inst   = order.instId.replace('-SWAP', '');

      let candles = [];
      try {
        candles = await loadCandlesAroundTime(inst, bar, fillTs);
      } catch (e) { console.error('[tradeReview] DuckDB', e.message); }

      if (candles.length < 10) {
        try {
          const fresh = await exchange.fetchCandlesBefore(inst, bar, 100, fillTs + 30 * 60000, currentMode);
          const conn  = getCandleConn();
          if (conn && fresh.length) await upsertCandles(inst, bar, fresh);
          candles = await loadCandlesAroundTime(inst, bar, fillTs);
        } catch (e) { console.error('[tradeReview] fetch fresh', e.message); }
      }

      const nearest = findNearestAnalysis(fillTs, currentMode);
      ws.send(JSON.stringify({
        type:        'tradeReviewData',
        ordId,
        order,
        candles,
        bar,
        analysisTs:  nearest?.ts   ?? null,
        analysisRaw: nearest?.raw  ?? null,
        hasData:     candles.length > 0,
      }));
    }

    // ── tradeReviewClaude：Claude 复盘分析 ────────────────────────────────
    if (msg.action === 'tradeReviewClaude') {
      const { ordId, bar = '15m' } = msg;
      const order = ordersStore[currentMode].get(ordId);
      if (!order) {
        ws.send(JSON.stringify({ type: 'tradeReviewClaudeError', ordId, error: '订单不存在' }));
        return;
      }
      const fillTs = order.fillTime || order.cTime;
      const inst   = order.instId.replace('-SWAP', '');
      let candles  = [];
      try { candles = await loadCandlesAroundTime(inst, bar, fillTs); } catch {}
      const nearest = findNearestAnalysis(fillTs, currentMode);

      ws.send(JSON.stringify({ type: 'tradeReviewClaudeThinking', ordId }));
      try {
        const response = await runPostmortem(order, candles, nearest?.raw ?? null, currentMode, bar);
        ws.send(JSON.stringify({ type: 'tradeReviewClaude', ordId, response }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'tradeReviewClaudeError', ordId, error: e.message }));
      }
    }

    // ── chat: AI 对话，修改代码 ────────────────────────────────────────
    if (msg.action === 'chat') {
      const { message } = msg;
      if (!message?.trim()) return;
      ws.send(JSON.stringify({ type: 'chatThinking' }));
      try {
        await chatSession.send(message, (chunk) => {
          ws.send(JSON.stringify({ type: 'chatChunk', text: chunk }));
        });
        ws.send(JSON.stringify({ type: 'chatDone' }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'chatError', error: e.message }));
      }
    }

    if (msg.action === 'chatReset') {
      chatSession.reset();
      ws.send(JSON.stringify({ type: 'chatReset' }));
    }
  });

  ws.on('close', () => console.log('[ws] client disconnected'));
});

// ─── 静态文件 ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── 启动 ─────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`\n🚀 OKX Dashboard running at http://localhost:${PORT}`);
  console.log('  初始化中...\n');
  loadOrders();
  loadAnalysisHistory();
  loadPosTrackHistory();
  await initCandleDB();
  const cached = await loadCandlesFromDB('BTC-USDT', '1H', 500);
  if (cached.length) cache.candles = cached;
  await Promise.all([fastRefresh(), slowRefresh(), candleRefresh(), openOrdersRefresh()]);
  console.log('  ✅ 初始化完成\n');
});
