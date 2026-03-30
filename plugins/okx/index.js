'use strict';
/**
 * plugins/okx/index.js — OKX plugin entry point
 *
 * Called by engine.js with a shared ctx object.
 * Initializes stores, wires up action modules, registers timers.
 */

const path = require('path');
const fs   = require('fs');

const adapter  = require('./adapter');
const orders   = require('./store/orders');
const candles  = require('./store/candles');
const analysis = require('./store/analysis');
const postrack = require('./store/postrack');
const { ChatSession }                             = require('./chat');
const { buildSystemPrompt, parseActions, stripActionTags } = require('../../core/ai/assistant');

// Action modules, loaded in dependency order:
// market → account → trading → analysis
// (account needs ctx.refresh.fast from market;
//  trading needs ctx.refresh.slow from account;
//  market.candleRefresh calls ctx.refresh.analysis from analysis)
const ACTION_MODULES = ['market', 'account', 'trading', 'analysis'];

async function register(ctx) {
  // Ensure data directory exists
  if (!fs.existsSync(ctx.dataDir)) fs.mkdirSync(ctx.dataDir, { recursive: true });

  // Attach adapter
  ctx.adapter = adapter;

  // Initialize stores
  orders.init(ctx.getMode, ctx.dataDir);
  await candles.init(ctx.getMode, ctx.dataDir);
  analysis.init(ctx.getMode, ctx.dataDir);
  postrack.init(ctx.getMode, ctx.dataDir);

  ctx.stores = { orders, candles, analysis, postrack };

  // Load persisted candles for initial cache
  try {
    const cached = await candles.loadCandlesFromDB('BTC-USDT', '1H', 500);
    if (cached.length) ctx.cache.candles = cached;
  } catch {}

  // Create chat session with dynamic system prompt built from manifest
  const systemPrompt = buildSystemPrompt(ctx.manifest);
  ctx._chatSession   = new ChatSession(systemPrompt);
  ctx._parseActions  = parseActions;
  ctx._stripTags     = stripActionTags;

  // Register cleanup on stop
  ctx.onStop.push(() => candles.closeDB());

  // Register all action modules
  const registrations = ACTION_MODULES.map(name =>
    require(`./actions/${name}`).register(ctx)
  );

  // Wire up actions with the WS server
  for (const reg of registrations) {
    for (const [action, handler] of Object.entries(reg.actions)) {
      ctx.ws.registerAction(action, handler);
    }
    for (const t of reg.timers) {
      ctx.timers.register(t.name, t.fn, t.intervalMs);
    }
  }

  // Run onReady in order after all modules registered
  // (so ctx.refresh.* cross-references are all populated)
  for (const reg of registrations) {
    await reg.onReady();
  }
}

module.exports = { register };
