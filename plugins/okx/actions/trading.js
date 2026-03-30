'use strict';
/**
 * plugins/okx/actions/trading.js
 *
 * Handles: placeOrder, cancelOrder, amendOrder, closePosition,
 *          amendAlgoOrder, addAlgoOrder.
 * Depends on: ctx.refresh.slow, ctx.refresh.algoOrders, ctx.refresh.openOrders
 *             (populated by account.js, which registers before trading.js)
 */

function register(ctx) {
  const { adapter, bus, cache, refresh, getMode } = ctx;

  const actions = {

    async placeOrder(msg, ws) {
      const { inst, side, sz, sl, tp, lever, ordType = 'market', px } = msg;

      if (!inst || !side || !sz)
        return { type: 'orderResult', success: false, error: '参数不完整' };
      if ((ordType === 'limit' || ordType === 'post_only') && !px)
        return { type: 'orderResult', success: false, error: '限价单需要指定价格' };

      const posSide = cache.posMode === 'long_short' ? (side === 'buy' ? 'long' : 'short') : undefined;

      try {
        if (lever) {
          try {
            await adapter.setLeverage({ inst, lever, mgnMode: 'cross', posMode: cache.posMode }, getMode());
            ws.send(JSON.stringify({ type: 'orderStream', chunk: `✓ 杠杆已设为 ${lever}×\n` }));
          } catch (e) {
            const hint = (e.message.includes('TP/SL') || e.message.includes('trailing'))
              ? '（请先撤销现有止损止盈单）' : '';
            ws.send(JSON.stringify({ type: 'orderStream', chunk: `⚠ 杠杆设置失败${hint}，继续下单\n` }));
          }
        }

        if (ordType === 'limit' || ordType === 'post_only') {
          await adapter.placeLimitOrder({ inst, side, sz, px, postOnly: ordType === 'post_only', posSide, sl, tp }, getMode());
          const slTpNote = (sl || tp) ? `  SL:${sl || '—'}  TP:${tp || '—'}` : '';
          ws.send(JSON.stringify({ type: 'orderStream', chunk: `✓ 限价单已提交 @${px}${slTpNote}\n` }));
        } else {
          await adapter.placeMarketOrder({ inst, side, sz, posSide }, getMode());
          ws.send(JSON.stringify({ type: 'orderStream', chunk: `✓ 开仓成功\n` }));
        }

        // For market orders with SL/TP, place a separate algo order
        if ((sl || tp) && ordType === 'market') {
          const oppSide = side === 'buy' ? 'sell' : 'buy';
          try {
            await adapter.placeAlgoOrder({ inst, side: oppSide, sz, sl, tp, posSide }, getMode());
            ws.send(JSON.stringify({ type: 'orderStream', chunk: `✓ 止盈止损已设置  SL:${sl || '—'}  TP:${tp || '—'}\n` }));
          } catch (e) {
            ws.send(JSON.stringify({ type: 'orderStream', chunk: `⚠ 策略单失败: ${e.message}\n` }));
          }
        }

        refresh.slow().then(() => {
          refresh.algoOrders().catch(e => console.error('[algoOrders]', e.message));
          if (refresh.postrack) refresh.postrack().catch(e => console.error('[posTrack]', e.message));
        });
        setTimeout(() => refresh.slow(), 3000);
        refresh.openOrders();

        // Suggest enabling AI position tracking after opening a trade
        bus.emit('broadcast', {
          type:   'suggestion',
          id:     'track-new-position',
          text:   'Position opened! AI can monitor it and suggest SL/TP adjustments every 3 minutes.',
          action: { type: 'enable-component', id: 'position-track' },
          label:  'Enable AI Tracking',
        });

        return { type: 'orderResult', success: true, data: '完成' };
      } catch (e) {
        return { type: 'orderResult', success: false, error: e.message };
      }
    },

    async cancelOrder(msg) {
      const { inst, ordId } = msg;
      try {
        await adapter.cancelOrder({ inst, ordId }, getMode());
        refresh.openOrders();
        return { type: 'cancelResult', success: true, ordId };
      } catch (e) {
        return { type: 'cancelResult', success: false, ordId, error: e.message };
      }
    },

    async amendOrder(msg) {
      const { inst, ordId, newPx, newSz, side, ordType } = msg;
      try {
        await adapter.amendOrder({ inst, ordId, newPx, newSz, side, ordType }, getMode());
        refresh.openOrders();
        return { type: 'amendResult', success: true, ordId };
      } catch (e) {
        return { type: 'amendResult', success: false, ordId, error: e.message };
      }
    },

    async closePosition(msg) {
      const pos = (cache.positions || []).find(p => p.instId === msg.inst);
      if (!pos) return { type: 'orderResult', success: false, error: '找不到持仓' };

      const closeSide    = parseFloat(pos.pos) > 0 ? 'sell' : 'buy';
      const fullSz       = Math.abs(parseFloat(pos.pos));
      const sz           = msg.sz ? Math.min(parseFloat(msg.sz), fullSz) : fullSz;
      const closePosSide = cache.posMode === 'long_short' ? pos.posSide : undefined;

      try {
        await adapter.closePosition({ inst: msg.inst, closeSide, sz, posSide: closePosSide }, getMode());
        const label = sz < fullSz ? `减仓 ${sz}张完成` : '平仓完成';
        refresh.slow().then(() => refresh.algoOrders().catch(e => console.error('[algoOrders]', e.message)));
        setTimeout(() => refresh.slow(), 3000);

        // Suggest trade review after closing a position
        bus.emit('broadcast', {
          type:   'suggestion',
          id:     'review-closed-trade',
          text:   'Trade closed. Review it with chart context and AI postmortem analysis.',
          action: { type: 'enable-component', id: 'trade-review' },
          label:  'Review Trade',
        });

        return { type: 'orderResult', success: true, data: label };
      } catch (e) {
        return { type: 'orderResult', success: false, error: e.message };
      }
    },

    async amendAlgoOrder(msg) {
      const { inst, algoId, sl, tp } = msg;
      try {
        await adapter.amendAlgoOrder({ inst, algoId, sl, tp }, getMode());
        await refresh.algoOrders();
        return { type: 'orderResult', success: true, data: 'SL/TP 已更新' };
      } catch (e) {
        return { type: 'orderResult', success: false, error: e.message };
      }
    },

    async addAlgoOrder(msg) {
      const { inst, side, sz, sl, tp } = msg;
      const algoPosSide = cache.posMode === 'long_short' ? (side === 'sell' ? 'long' : 'short') : undefined;
      try {
        await adapter.placeAlgoOrder({ inst, side, sz, sl, tp, posSide: algoPosSide }, getMode());
        await refresh.algoOrders();
        return { type: 'orderResult', success: true, data: 'SL/TP 已设置' };
      } catch (e) {
        return { type: 'orderResult', success: false, error: e.message };
      }
    },

  };

  return { actions, timers: [], onReady: async () => {} };
}

module.exports = { register };
