/**
 * public/core/suggestions.js — Client-side suggestion engine
 *
 * RULES are pure data — each rule fires when its condition is met
 * and has not been dismissed this session.
 *
 * SuggestionEngine listens to layout + WS events, picks the top
 * matching rule, and emits 'suggestion:show' on the bus.
 */

// ── Rules ─────────────────────────────────────────────────────────────────────
// stage field documents which journey transition each rule covers (for tests).

export const RULES = [
  // ── observe ──────────────────────────────────────────────────────────────
  {
    id:        'start',
    stage:     'observe',
    condition: (en) => en.length === 0,
    text:      'Welcome! Start by watching the BTC price live.',
    action:    { type: 'enable-component', id: 'ticker' },
    label:     'Add Price Ticker',
  },
  {
    id:        'add-balance',
    stage:     'observe',
    condition: (en) => en.includes('ticker') && !en.includes('balance'),
    text:      'Add the balance panel to track your account equity.',
    action:    { type: 'enable-component', id: 'balance' },
    label:     'Add Balance',
  },

  // ── observe → understand ─────────────────────────────────────────────────
  {
    id:        'add-chart',
    stage:     'observe→understand',
    condition: (en) => en.includes('ticker') && !en.includes('chart'),
    text:      'See price action across timeframes with the candlestick chart.',
    action:    { type: 'enable-component', id: 'chart' },
    label:     'Add Chart',
  },

  // ── understand ───────────────────────────────────────────────────────────
  {
    id:        'add-analysis',
    stage:     'understand',
    condition: (en) => en.includes('chart') && !en.includes('analysis'),
    text:      'Read the signals — add technical analysis (RSI, MACD, S/R levels).',
    action:    { type: 'enable-component', id: 'analysis' },
    label:     'Add Analysis',
  },

  // ── understand → trade ───────────────────────────────────────────────────
  {
    id:        'start-trading',
    stage:     'understand→trade',
    condition: (en) => en.includes('analysis') && !en.includes('order-panel'),
    text:      'Ready to trade? Add the order panel to place your first position.',
    action:    { type: 'enable-component', id: 'order-panel' },
    label:     'Add Order Panel',
  },

  // ── trade ────────────────────────────────────────────────────────────────
  {
    id:        'add-positions',
    stage:     'trade',
    condition: (en) => en.includes('order-panel') && !en.includes('positions'),
    text:      'Track your open positions in real time.',
    action:    { type: 'enable-component', id: 'positions' },
    label:     'Add Positions',
  },
  {
    id:        'add-open-orders',
    stage:     'trade',
    condition: (en) => en.includes('order-panel') && !en.includes('open-orders'),
    text:      'See and manage your pending limit orders.',
    action:    { type: 'enable-component', id: 'open-orders' },
    label:     'Add Open Orders',
  },

  // ── trade → optimize ─────────────────────────────────────────────────────
  {
    id:        'add-position-track',
    stage:     'trade→optimize',
    condition: (en) => en.includes('positions') && !en.includes('position-track'),
    text:      'Let AI monitor your positions and suggest SL/TP adjustments every 3 minutes.',
    action:    { type: 'enable-component', id: 'position-track' },
    label:     'Enable AI Tracking',
  },

  // ── optimize ─────────────────────────────────────────────────────────────
  {
    id:        'add-history',
    stage:     'optimize',
    condition: (en) => en.includes('positions') && !en.includes('history'),
    text:      'Review your past trades and P&L in the order history panel.',
    action:    { type: 'enable-component', id: 'history' },
    label:     'Add Trade History',
  },
  {
    id:        'add-ai-assess',
    stage:     'optimize',
    condition: (en) => en.includes('analysis') && !en.includes('claude-insights'),
    text:      'Get an AI-powered market assessment based on current technical signals.',
    action:    { type: 'enable-component', id: 'claude-insights' },
    label:     'Add AI Assessment',
  },
  {
    id:        'add-trade-review',
    stage:     'optimize',
    condition: (en) => en.includes('history') && !en.includes('trade-review'),
    text:      'Deep-dive into past trades with chart context and AI postmortem.',
    action:    { type: 'enable-component', id: 'trade-review' },
    label:     'Add Trade Review',
  },
];

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Return all matching rules, excluding dismissed ones.
 * @param {string[]} enabledIds
 * @param {Set<string>} dismissed
 * @returns {{ id, text, action, label, stage }[]}
 */
export function getSuggestions(enabledIds, dismissed) {
  return RULES.filter(r => !dismissed.has(r.id) && r.condition(enabledIds));
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class SuggestionEngine {
  constructor(bus, layout) {
    this._bus       = bus;
    this._layout    = layout;
    this._dismissed = new Set();
    this._timer     = null;
  }

  init() {
    // Recheck when layout changes (debounced)
    this._bus.on('layout:added',   () => this._schedule(1500));
    this._bus.on('layout:removed', () => this._schedule(1500));

    // Server-pushed suggestions (after trade events)
    this._bus.on('suggestion', (msg) => this._onServer(msg));

    // Dismiss feedback from chat panel → mark dismissed, check for next
    this._bus.on('suggestion:dismiss', ({ id }) => {
      this._dismissed.add(id);
      this._schedule(2000);
    });

    // Initial check after layout has had time to restore
    this._schedule(3000);
  }

  _schedule(ms) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._check(), ms);
  }

  _check() {
    const enabled     = this._layout.list();
    const suggestions = getSuggestions(enabled, this._dismissed);
    if (suggestions.length) this._show(suggestions[0]);
  }

  _onServer({ id, text, action, label }) {
    if (!id || !text || !action) return;
    if (this._dismissed.has(id)) return;
    // Skip if the target component is already enabled
    if (action.type === 'enable-component' && this._layout.has(action.id)) return;
    this._show({ id, text, action, label });
  }

  _show(suggestion) {
    this._bus.emit('suggestion:show', suggestion);
  }
}
