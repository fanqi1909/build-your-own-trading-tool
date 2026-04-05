/**
 * public/core/suggestions.js — Recommendation and suggestion logic
 */

export const RULES = [
  { id: 'start',              stage: 'observe',            when: (en) => en.length === 0,                             target: 'ticker',           text: 'Welcome! Start by watching the BTC price live.', label: 'Add Price Ticker' },
  { id: 'add-balance',        stage: 'observe',            when: (en) => en.includes('ticker') && !en.includes('balance'),          target: 'balance',          text: 'Add the balance panel to track your account equity.', label: 'Add Balance' },
  { id: 'add-chart',          stage: 'observe→understand', when: (en) => en.includes('ticker') && !en.includes('chart'),            target: 'chart',            text: 'See price action across timeframes with the candlestick chart.', label: 'Add Chart' },
  { id: 'add-analysis',       stage: 'understand',         when: (en) => en.includes('chart') && !en.includes('analysis'),          target: 'analysis',         text: 'Read the signals — add technical analysis.', label: 'Add Analysis' },
  { id: 'start-trading',      stage: 'understand→trade',   when: (en) => en.includes('analysis') && !en.includes('order-panel'),    target: 'order-panel',      text: 'Ready to trade? Add the order panel.', label: 'Add Order Panel' },
  { id: 'add-positions',      stage: 'trade',              when: (en) => en.includes('order-panel') && !en.includes('positions'),   target: 'positions',        text: 'Track your open positions in real time.', label: 'Add Positions' },
  { id: 'add-open-orders',    stage: 'trade',              when: (en) => en.includes('order-panel') && !en.includes('open-orders'), target: 'open-orders',      text: 'See and manage your pending limit orders.', label: 'Add Open Orders' },
  { id: 'add-position-track', stage: 'trade→optimize',     when: (en) => en.includes('positions') && !en.includes('position-track'),target: 'position-track',   text: 'Let AI monitor your positions.', label: 'Enable AI Tracking' },
  { id: 'add-history',        stage: 'optimize',           when: (en) => en.includes('positions') && !en.includes('history'),       target: 'history',          text: 'Review your past trades and P&L.', label: 'Add Trade History' },
  { id: 'add-ai-assess',      stage: 'optimize',           when: (en) => en.includes('analysis') && !en.includes('claude-insights'),target: 'claude-insights',  text: 'Get an AI-powered market assessment.', label: 'Add AI Assessment' },
  { id: 'add-trade-review',   stage: 'optimize',           when: (en) => en.includes('history') && !en.includes('trade-review'),    target: 'trade-review',     text: 'Deep-dive into past trades with AI postmortem.', label: 'Add Trade Review' },
];

export function getSuggestions(enabledIds, dismissed) {
  return RULES
    .filter(r => !dismissed.has(r.id) && r.when(enabledIds))
    .map(r => ({
      id: r.id,
      text: r.text,
      action: { type: 'enable-component', id: r.target },
      label: r.label,
      stage: r.stage,
    }));
}

export function getRecommendedComponents(catalog, activeIds, removedIds = []) {
  const active  = new Set(activeIds);
  const removed = new Set(removedIds);
  const direct  = getSuggestions(activeIds, new Set()).map(s => s.action.id);

  return catalog
    .filter(item => !active.has(item.id))
    .map(item => {
      let score = item.recommendedByDefault ? 100 : 0;
      score += item.starterPriority || 0;
      if (direct.includes(item.id)) score += 120;
      if (removed.has(item.id)) score = -1;
      return { ...item, recommendationScore: score };
    })
    .filter(item => item.recommendationScore > 0)
    .sort((a, b) => b.recommendationScore - a.recommendationScore || a.title.localeCompare(b.title));
}

export function groupBuilderSections(catalog, activeIds, removedIds = []) {
  const activeSet = new Set(activeIds);
  return {
    recommended: getRecommendedComponents(catalog, activeIds, removedIds).slice(0, 6),
    active:      catalog.filter(item => activeSet.has(item.id)),
    available:   catalog.filter(item => !activeSet.has(item.id)),
  };
}

export class SuggestionEngine {
  constructor(bus, layout, catalog = []) {
    this._bus       = bus;
    this._layout    = layout;
    this._catalog   = catalog;
    this._dismissed = new Set();
    this._timer     = null;
  }

  setCatalog(catalog) {
    this._catalog = catalog;
  }

  init() {
    this._bus.on('layout:added',   () => this._schedule(1500));
    this._bus.on('layout:removed', () => this._schedule(1500));
    this._bus.on('suggestion', (msg) => this._onServer(msg));
    this._bus.on('suggestion:dismiss', ({ id }) => {
      this._dismissed.add(id);
      this._schedule(2000);
    });
    this._schedule(3000);
  }

  _schedule(ms) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._check(), ms);
  }

  _check() {
    const enabled = this._layout.list();
    const suggestions = getSuggestions(enabled, this._dismissed);
    if (suggestions.length) this._show(suggestions[0]);
  }

  _onServer({ id, text, action, label }) {
    if (!id || !text || !action) return;
    if (this._dismissed.has(id)) return;
    if (action.type === 'enable-component' && this._layout.has(action.id)) return;
    this._show({ id, text, action, label });
  }

  _show(suggestion) {
    this._bus.emit('suggestion:show', suggestion);
  }
}
