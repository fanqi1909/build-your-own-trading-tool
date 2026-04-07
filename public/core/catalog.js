/**
 * public/core/catalog.js — Normalize manifest capabilities into UI metadata.
 *
 * Shared by Build mode, Use mode, and recommendation logic.
 */

const ICONS = {
  ticker:          '₿',
  chart:           '📈',
  balance:         '💰',
  positions:       '📦',
  'order-panel':   '⚡',
  'open-orders':   '📝',
  analysis:        '📊',
  'claude-insights':'✦',
  'position-track':'🎯',
  history:         '🕘',
  'trade-review':  '🔍',
};

const CATEGORIES = {
  observe:    'Observe',
  understand: 'Understand',
  trade:      'Trade',
  optimize:   'Optimize',
};

const STARTER_PRIORITY = {
  ticker: 100,
  chart: 90,
  balance: 80,
  analysis: 70,
  'order-panel': 60,
  positions: 50,
  'open-orders': 40,
  'claude-insights': 30,
  'position-track': 20,
  history: 15,
  'trade-review': 10,
};

const DEFAULT_RECOMMENDED = new Set(['ticker', 'chart', 'balance']);

export function normalizeCatalog(manifest) {
  const caps = Object.values(manifest?.capabilities || {});

  return caps
    .map((cap) => ({
      id:                   cap.component,
      title:                cap.label,
      description:          cap.description,
      stage:                cap.stage,
      category:             CATEGORIES[cap.stage] || 'Other',
      icon:                 ICONS[cap.component] || '◻',
      requires:             [...(cap.requires || [])],
      inputs:               [...(cap.inputs  || [])],
      outputs:              [...(cap.outputs || [])],
      configSchema:         cap.configSchema || {},
      starterPriority:      STARTER_PRIORITY[cap.component] || 0,
      recommendedByDefault: DEFAULT_RECOMMENDED.has(cap.component),
      cardSize:             isWide(cap.component) ? 'wide' : 'tile',
    }))
    .sort((a, b) => b.starterPriority - a.starterPriority || a.title.localeCompare(b.title));
}

export function getCatalogById(catalog) {
  return Object.fromEntries(catalog.map(item => [item.id, item]));
}

function isWide(componentId) {
  return ['chart', 'analysis', 'position-track', 'history', 'trade-review', 'claude-insights'].includes(componentId);
}
