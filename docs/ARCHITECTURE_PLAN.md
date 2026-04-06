# Architecture Plan: AI-Driven Trading Tool Builder

> Status: Refactor largely implemented; doc now serves as architecture reference and roadmap | 2026-04-06

## Vision

A **conversational-first** platform where users build their own trading dashboard through dialogue with an AI assistant. The AI understands all available capabilities, enables features on demand, and proactively suggests what to build next based on usage patterns.

The OKX trading domain is the **reference implementation** — the architecture supports swapping to any CLI/API domain.

---

## Design Principles

1. **Assistant is the main character** — Chat panel is always visible; dashboard panels are supporting context that the AI manages
2. **Progressive disclosure** — Start minimal (chat + price), grow organically through conversation
3. **Component = capability** — Every UI panel maps to a declared capability in the plugin manifest
4. **Zero build step** — Vanilla JS with ES modules, no bundler required
5. **Plugin self-containment** — Everything about a domain lives in one directory
6. **Non-intrusive** — The framework doesn't force a workflow; it suggests and the user decides

---

## Current State (what we're refactoring from)

| Module | LOC | Issue |
|--------|-----|-------|
| `server.js` | 600 | Monolith: refresh loops + WS handlers + order logic + AI calls |
| `public/index.html` | 3,358 | Single file: 473 CSS + 270 HTML + 2,500 JS, all global state |
| `lib/store.js` | 269 | Mixed concerns: orders + candles + analysis + postrack |
| `lib/ai.js` | 158 | Hard-coded prompts, tightly coupled to OKX data shapes |
| `lib/chat.js` | 124 | Clean but system prompt is hard-coded |
| `adapters/okx-cli.js` | 237 | Well-structured, good interface |
| `adapters/base.js` | 73 | Good type definitions |

**Total: ~4,000 LOC** — manageable for a full refactor.

---

## Target Architecture

```
build-your-own-trading-tool/
│
├── core/                              # Domain-agnostic engine
│   ├── engine.js                      # Plugin loader, lifecycle, DI container
│   ├── bus.js                         # Server-side event bus (pub/sub)
│   ├── ws.js                          # WebSocket server wrapper
│   ├── store.js                       # Store interface + base helpers (DuckDB, JSON)
│   ├── timers.js                      # Managed refresh timer registry
│   └── ai/
│       ├── assistant.js               # AI assistant (conversation + capability awareness)
│       ├── suggestions.js             # Proactive suggestion engine
│       └── journey.js                 # User journey stage tracker
│
├── plugins/
│   └── okx/                           # OKX reference plugin (self-contained)
│       ├── manifest.json              # Capability map + journey stages + metadata
│       ├── adapter.js                 # Exchange adapter (current okx-cli.js)
│       ├── types.js                   # Data type definitions (current base.js)
│       ├── store/                     # Domain-specific storage
│       │   ├── orders.js
│       │   ├── candles.js
│       │   └── analysis.js
│       ├── actions/                   # Server-side action handlers
│       │   ├── market.js              # fetchTicker, fetchCandles
│       │   ├── trading.js             # placeOrder, closePosition, etc.
│       │   ├── account.js             # fetchBalance, pnlQuery
│       │   └── analysis.js            # runAnalysis, autoAssess, posTrack
│       ├── prompts/                   # AI prompt templates
│       │   ├── system.md              # Assistant system prompt for this domain
│       │   ├── analysis.js            # Technical analysis prompt builder
│       │   ├── tracking.js            # Position tracking prompt builder
│       │   └── postmortem.js          # Trade review prompt builder
│       └── components/                # UI components (served to browser)
│           ├── ticker/
│           │   └── ticker.js          # ES module: export default class extends Component
│           ├── chart/
│           │   └── chart.js
│           ├── positions/
│           │   └── positions.js
│           ├── open-orders/
│           │   └── open-orders.js
│           ├── order-panel/
│           │   └── order-panel.js
│           ├── analysis/
│           │   └── analysis.js
│           ├── claude-insights/
│           │   └── claude-insights.js
│           ├── position-track/
│           │   └── position-track.js
│           ├── balance/
│           │   └── balance.js
│           ├── history/
│           │   └── history.js
│           └── trade-review/
│               └── trade-review.js
│
├── public/                            # Core UI shell (domain-agnostic)
│   ├── index.html                     # Minimal shell: sidebar + layout grid + chat
│   ├── core/
│   │   ├── app.js                     # Bootstrap: load plugin, init components
│   │   ├── bus.js                     # Client-side event bus
│   │   ├── ws.js                      # WebSocket client wrapper
│   │   ├── component.js              # Base component class
│   │   ├── layout.js                  # Layout manager (add/remove/rearrange panels)
│   │   ├── chat.js                    # Chat panel UI (always present)
│   │   └── theme.css                  # CSS variables, base grid, typography
│   └── assets/                        # Icons, fonts if needed
│
├── server.js                          # Slim entry: create engine, load plugin, listen
├── analyze.py                         # External tool (unchanged)
├── package.json
└── docs/
    ├── ARCHITECTURE_PLAN.md           # This file
    └── PLUGIN_CONTRACT.md             # Plugin developer guide (Phase 6)
```

---

## Core Contracts

### 1. Plugin Manifest (`manifest.json`)

The manifest is the **single source of truth** for what a domain plugin provides.

```jsonc
{
  "id": "okx",
  "name": "OKX Trading",
  "version": "1.0.0",
  "description": "Build your own OKX perpetual swap trading dashboard",

  // Server-side entry points
  "adapter": "./adapter.js",
  "stores": ["./store/orders.js", "./store/candles.js", "./store/analysis.js"],
  "actions": ["./actions/market.js", "./actions/trading.js", "./actions/account.js", "./actions/analysis.js"],
  "prompts": {
    "system": "./prompts/system.md",
    "analysis": "./prompts/analysis.js",
    "tracking": "./prompts/tracking.js",
    "postmortem": "./prompts/postmortem.js"
  },

  // Capability map — every feature the plugin can provide
  "capabilities": {
    "market.ticker": {
      "label": "Real-time Price",
      "description": "BTC/USDT price, 24h change, volume",
      "stage": "observe",
      "component": "ticker",
      "refresh": { "event": "fast", "interval": 5000 }
    },
    "market.candles": {
      "label": "Candlestick Chart",
      "description": "Multi-timeframe K-line chart with crosshair",
      "stage": "observe",
      "component": "chart",
      "refresh": { "event": "candles", "interval": 600000 }
    },
    "account.balance": {
      "label": "Account Balance",
      "description": "Total equity, available balance, currency breakdown",
      "stage": "observe",
      "component": "balance",
      "refresh": { "event": "slow", "interval": 60000 }
    },
    "trading.positions": {
      "label": "Position Management",
      "description": "View and close/reduce current positions",
      "stage": "trade",
      "component": "positions",
      "requires": ["market.ticker"]
    },
    "trading.orders": {
      "label": "Place Orders",
      "description": "Market/limit orders with SL/TP and leverage",
      "stage": "trade",
      "component": "order-panel",
      "requires": ["market.ticker"]
    },
    "trading.open-orders": {
      "label": "Open Orders",
      "description": "Pending orders with cancel/amend",
      "stage": "trade",
      "component": "open-orders",
      "refresh": { "event": "orders", "interval": 10000 }
    },
    "analysis.technical": {
      "label": "Technical Analysis",
      "description": "Multi-timeframe indicators: RSI, MACD, BB, StochRSI, ADX, S/R",
      "stage": "understand",
      "component": "analysis",
      "requires": ["market.candles"]
    },
    "analysis.ai-assess": {
      "label": "AI Market Assessment",
      "description": "Claude analyzes signals and gives trading advice",
      "stage": "optimize",
      "component": "claude-insights",
      "requires": ["analysis.technical"]
    },
    "analysis.position-track": {
      "label": "Position Tracking",
      "description": "AI monitors positions and suggests SL/TP adjustments",
      "stage": "optimize",
      "component": "position-track",
      "requires": ["trading.positions", "analysis.technical"],
      "refresh": { "event": "postrack", "interval": 180000 }
    },
    "review.history": {
      "label": "Order History",
      "description": "Past trades with P&L",
      "stage": "optimize",
      "component": "history"
    },
    "review.postmortem": {
      "label": "Trade Postmortem",
      "description": "AI reviews past trades with chart context",
      "stage": "optimize",
      "component": "trade-review",
      "requires": ["review.history", "market.candles"]
    }
  },

  // User journey — progressive stages
  "journey": {
    "stages": [
      {
        "id": "observe",
        "label": "Watch the Market",
        "hint": "Start by observing price action and getting familiar with the data",
        "defaults": ["market.ticker"]
      },
      {
        "id": "understand",
        "label": "Read the Signals",
        "hint": "Add technical analysis to understand what the indicators are telling you",
        "defaults": ["market.candles", "analysis.technical"]
      },
      {
        "id": "trade",
        "label": "Start Trading",
        "hint": "Place your first trade with proper risk management",
        "defaults": ["trading.positions", "trading.orders", "trading.open-orders"]
      },
      {
        "id": "optimize",
        "label": "Optimize & Review",
        "hint": "Use AI insights and trade reviews to improve your strategy",
        "defaults": ["analysis.ai-assess", "analysis.position-track", "review.history"]
      }
    ]
  }
}
```

### 2. Component Interface (client-side)

Every UI component is an ES module with this contract:

```javascript
// public/core/component.js — Base class

export class Component {
  /** @type {string} */
  static id = '';

  /**
   * @param {HTMLElement} container — DOM element to render into
   * @param {EventBus}    bus       — client-side event bus
   * @param {object}      config    — component-specific config
   */
  constructor(container, bus, config = {}) {
    this.el = container;
    this.bus = bus;
    this.config = config;
    this._subscriptions = [];
  }

  /** Subscribe to a bus event (auto-cleanup on destroy) */
  on(event, handler) {
    this.bus.on(event, handler);
    this._subscriptions.push({ event, handler });
  }

  /** Send action to server via bus */
  send(action, data) {
    this.bus.emit('ws:send', { action, ...data });
  }

  /** Called once when component is added to layout */
  async init() {}

  /** Called when component receives new data */
  update(data) {}

  /** Called when component is removed from layout */
  destroy() {
    this._subscriptions.forEach(({ event, handler }) =>
      this.bus.off(event, handler)
    );
    this.el.innerHTML = '';
  }
}
```

**Example: Ticker component**

```javascript
// plugins/okx/components/ticker/ticker.js

import { Component } from '/core/component.js';

export default class TickerComponent extends Component {
  static id = 'ticker';

  async init() {
    this.el.innerHTML = `
      <div class="ticker">
        <span class="ticker-price">--</span>
        <span class="ticker-change">--</span>
        <span class="ticker-vol">Vol --</span>
      </div>
    `;
    this.on('ticker', (data) => this.update(data));
  }

  update({ last, change24h, vol24h }) {
    this.el.querySelector('.ticker-price').textContent = `$${Number(last).toLocaleString()}`;
    // ... etc
  }
}
```

### 3. Action Handler Interface (server-side)

```javascript
// Plugin action modules export a function that receives the engine context

/**
 * @param {object} ctx
 * @param {object} ctx.adapter   — exchange adapter instance
 * @param {object} ctx.store     — plugin store modules
 * @param {object} ctx.bus       — server event bus
 * @param {Function} ctx.getMode — returns current mode ('demo'|'live')
 */
export function register(ctx) {
  return {
    // WebSocket action handlers (client → server)
    'fetchTicker': async (params, ws) => {
      const ticker = await ctx.adapter.fetchTicker(params.inst || 'BTC-USDT', ctx.getMode());
      return { type: 'ticker', data: ticker, mode: ctx.getMode() };
    },

    // Refresh loop handlers (timer-driven)
    refreshes: {
      fast: async () => {
        const ticker = await ctx.adapter.fetchTicker('BTC-USDT', ctx.getMode());
        ctx.bus.emit('broadcast', { type: 'ticker', data: ticker, mode: ctx.getMode() });
      }
    }
  };
}
```

### 4. Layout Manager (client-side)

```javascript
// public/core/layout.js

export class LayoutManager {
  constructor(containerEl, bus) {
    this.container = containerEl;  // CSS grid container
    this.bus = bus;
    this.panels = new Map();       // componentId → { component, el }
    this.layout = [];              // persisted layout config
  }

  /** Add a component to the layout */
  async add(componentId, position = 'auto') {
    // 1. Dynamic import from plugin component path
    // 2. Create container div, insert into grid
    // 3. Instantiate component, call init()
    // 4. Save to layout config
  }

  /** Remove a component */
  remove(componentId) {
    // 1. Call component.destroy()
    // 2. Remove DOM element
    // 3. Update layout config
  }

  /** Persist current layout to localStorage */
  save() {
    localStorage.setItem('layout', JSON.stringify(this.layout));
  }

  /** Restore layout from localStorage or defaults */
  restore(defaults = []) {
    const saved = localStorage.getItem('layout');
    const components = saved ? JSON.parse(saved) : defaults;
    components.forEach(c => this.add(c.id, c.position));
  }
}
```

### 5. AI Assistant Integration

The assistant has access to:
- The full **capability map** from the manifest
- The current **enabled components** (from layout manager)
- The **user's journey stage** (from journey tracker)
- **Usage stats** (from suggestion engine)

```javascript
// core/ai/assistant.js

// The system prompt is dynamically built:
function buildSystemPrompt(manifest, enabledComponents, journeyStage, usageStats) {
  return `
You are an AI assistant helping the user build their trading dashboard.

## Available Capabilities (from ${manifest.name} plugin)
${formatCapabilities(manifest.capabilities)}

## Currently Enabled
${enabledComponents.map(c => `- ${c.id}: ${c.label}`).join('\n')}

## User's Current Stage: ${journeyStage.label}
${journeyStage.hint}

## What You Can Do
- Enable a component: respond with <enable-component id="..."/>
- Disable a component: respond with <disable-component id="..."/>
- Configure a component: respond with <configure-component id="..." config={...}/>
- Suggest next steps based on their stage and usage patterns

## Usage Insights
${formatUsageStats(usageStats)}

Guidelines:
- When the user asks for a feature, check capabilities first
- If it maps to an existing capability, enable the component
- If it requires building something new, use code editing tools
- Be concise. Enable first, explain after.
`;
}
```

The assistant parses its own output for action tags (`<enable-component>`, etc.) and executes them, then broadcasts layout changes to the client.

### 6. Suggestion Engine

```javascript
// core/ai/suggestions.js

export class SuggestionEngine {
  constructor(manifest, journeyTracker) {
    this.capabilities = manifest.capabilities;
    this.journey = manifest.journey;
    this.tracker = journeyTracker;
  }

  /**
   * Returns 1-3 contextual suggestions based on:
   * - What's enabled vs what's available
   * - Current journey stage
   * - Recent user actions
   * - Time-based triggers (e.g., held position for 30min without SL)
   */
  getSuggestions(enabledComponents, recentActions) {
    const suggestions = [];
    const enabled = new Set(enabledComponents);

    // Rule: has positions but no position tracking → suggest it
    if (enabled.has('positions') && !enabled.has('position-track')) {
      suggestions.push({
        text: 'You have open positions. Want me to enable AI position tracking? It monitors your positions and suggests SL/TP adjustments.',
        action: { type: 'enable', component: 'position-track' }
      });
    }

    // Rule: has history but never used postmortem → suggest it
    if (enabled.has('history') && !enabled.has('trade-review')) {
      suggestions.push({
        text: 'I see you have trade history. Want to review past trades with AI? It analyzes entry/exit timing and suggests improvements.',
        action: { type: 'enable', component: 'trade-review' }
      });
    }

    // Journey-based: suggest next stage
    const nextStage = this.getNextStage(enabled);
    if (nextStage) {
      suggestions.push({
        text: `Ready to ${nextStage.hint.toLowerCase()}?`,
        action: { type: 'stage', stage: nextStage.id }
      });
    }

    return suggestions.slice(0, 3);
  }
}
```

---

## Event Flow

```
┌─────────────┐     WebSocket      ┌──────────────┐      Bus       ┌────────────┐
│   Browser    │ ←───────────────→  │   server.js   │ ←──────────→  │   Plugin   │
│             │                    │   (engine)    │               │  Actions   │
│  ┌────────┐ │  ws:send/receive   │  ┌──────────┐ │  bus events   │            │
│  │ Layout │ │ ←───────────────→  │  │ WS Server│ │ ←──────────→  │  Adapter   │
│  │Manager │ │                    │  └──────────┘ │               │  Store     │
│  └────────┘ │                    │  ┌──────────┐ │               │  Prompts   │
│  ┌────────┐ │                    │  │  Timer   │ │               └────────────┘
│  │ Event  │ │                    │  │ Registry │ │
│  │  Bus   │ │                    │  └──────────┘ │
│  └────────┘ │                    │  ┌──────────┐ │
│  ┌────────┐ │   chat messages    │  │   AI     │ │
│  │  Chat  │ │ ←───────────────→  │  │Assistant │ │
│  │ Panel  │ │                    │  └──────────┘ │
│  └────────┘ │                    └──────────────┘
│  ┌────────┐ │
│  │  Comp  │ │  subscribes to
│  │  Comp  │ │  bus events
│  │  Comp  │ │
│  └────────┘ │
└─────────────┘

Data flow:
1. Timer fires → Plugin action handler fetches from adapter
2. Action handler → bus.emit('broadcast', {...})
3. Engine WS layer → sends to all clients
4. Client bus dispatches → subscribed components update

User interaction:
1. User clicks in component → component calls this.send('action', data)
2. Client bus → ws:send → server
3. Engine routes to plugin action handler
4. Handler executes → returns response → broadcast
```

---

## Execution Plan

> Legend:
> - `[AI]` = Sonnet/Opus can verify autonomously
> - `[YOU]` = Needs your manual verification (browser, UX, real API)
> - `[BOTH]` = AI does first pass, you do final confirmation

---

### Phase 1: Core Infrastructure
> Goal: Build the skeleton that everything plugs into

**Files to create:**
- `core/engine.js` — Plugin loader + DI container + lifecycle
- `core/bus.js` — Server event bus (EventEmitter-based pub/sub)
- `core/ws.js` — WebSocket server (wraps `ws`, routes actions to handlers)
- `core/timers.js` — Timer registry (register/start/stop/clear named intervals)
- `core/store.js` — Base store helpers (JSON file read/write, DuckDB helpers)
- `public/core/app.js` — Client bootstrap
- `public/core/bus.js` — Client event bus
- `public/core/ws.js` — Client WebSocket wrapper
- `public/core/component.js` — Base component class
- `public/core/layout.js` — Layout manager
- `public/core/theme.css` — CSS variables + grid layout
- `public/index.html` — Minimal shell (sidebar + grid + chat area)

**Verification checklist:**

| # | Check | How | Who |
|---|-------|-----|-----|
| 1.1 | `node server.js` starts without errors | Run and check stdout for listening message | `[AI]` |
| 1.2 | Server loads plugin manifest and logs capability count | Check stdout: `[engine] loaded plugin "okx" with N capabilities` | `[AI]` |
| 1.3 | WebSocket connection established | Write test: client connects → receives `{ type: 'connected' }` | `[AI]` |
| 1.4 | Event bus round-trip works | Write test: emit event on server bus → verify client receives via WS | `[AI]` |
| 1.5 | Layout manager: add dummy component | Write test: `layout.add('dummy')` → DOM has `<div data-component="dummy">` | `[AI]` |
| 1.6 | Layout manager: remove component | Write test: `layout.remove('dummy')` → DOM element gone, component.destroy() called | `[AI]` |
| 1.7 | Layout persists to localStorage | Write test: add component → save → reload → restore → component present | `[AI]` |
| 1.8 | Shell page renders correctly | Open `http://localhost:3000` — see chat area on left, empty grid on right | `[YOU]` |
| 1.9 | CSS grid layout looks right | Resize browser window — grid responds, no overflow, chat stays visible | `[YOU]` |

**Gate:** All `[AI]` checks pass in automated tests + you confirm 1.8 and 1.9 visually.

---

### Phase 2: Extract OKX Plugin
> Goal: Move all OKX-specific code into `plugins/okx/` — same behavior, new structure

**Files to create/move:**
- `plugins/okx/manifest.json` — Full capability map (as designed above)
- `plugins/okx/adapter.js` — Move from `adapters/okx-cli.js`
- `plugins/okx/types.js` — Move from `adapters/base.js`
- `plugins/okx/store/orders.js` — Extract from `lib/store.js`
- `plugins/okx/store/candles.js` — Extract from `lib/store.js`
- `plugins/okx/store/analysis.js` — Extract from `lib/store.js`
- `plugins/okx/actions/market.js` — Extract ticker + candle refresh from `server.js`
- `plugins/okx/actions/trading.js` — Extract order/position actions from `server.js`
- `plugins/okx/actions/account.js` — Extract balance/PnL from `server.js`
- `plugins/okx/actions/analysis.js` — Extract analysis + AI calls from `server.js`
- `plugins/okx/prompts/system.md` — Extract from `lib/chat.js`
- `plugins/okx/prompts/analysis.js` — Extract from `lib/ai.js`
- `plugins/okx/prompts/tracking.js` — Extract from `lib/ai.js`
- `plugins/okx/prompts/postmortem.js` — Extract from `lib/ai.js`

**Verification checklist:**

| # | Check | How | Who |
|---|-------|-----|-----|
| 2.1 | `npm test` passes (existing tests, adapted imports) | Run `npm test` | `[AI]` |
| 2.2 | `server.js` is ≤ 60 lines | `wc -l server.js` | `[AI]` |
| 2.3 | Old files removed | Verify `lib/store.js`, `lib/ai.js`, `lib/chat.js`, `adapters/` no longer exist | `[AI]` |
| 2.4 | All 22 WebSocket action types still handled | Grep for every action name in old server.js, confirm each exists in `plugins/okx/actions/` | `[AI]` |
| 2.5 | All 14 broadcast message types still emitted | Grep for every `type:` in old server.js, confirm each exists in new code | `[AI]` |
| 2.6 | Manifest matches actual code | Every capability in manifest.json has a corresponding component file and action handler | `[AI]` |
| 2.7 | Timer intervals unchanged | Compare old `setInterval` values with new timer registry config | `[AI]` |
| 2.8 | Data files still load | Start server → check `./data/*.json` loads correctly, DuckDB initializes | `[AI]` |
| 2.9 | Server connects to OKX API (demo mode) | Start with `.env` configured → ticker data arrives within 10s | `[YOU]` |
| 2.10 | Full dashboard works end-to-end | Open browser → price updates, positions load, chart renders, analysis runs | `[YOU]` |

**Gate:** 2.1–2.8 all pass automatically. You confirm 2.9 + 2.10 with a running server.

---

### Phase 3: UI Componentization
> Goal: Break the 3,358-line `index.html` into 11 self-contained components

**Components to extract:**

| Component ID | Source (approx lines in old index.html) | Bus Events |
|-------------|----------------------------------------|------------|
| `ticker` | Header market section | `ticker` |
| `chart` | Chart card + drawChart/drawCrosshair | `candles` |
| `positions` | Positions card + renderPositions | `snapshot` |
| `open-orders` | Open orders card | `openOrders` |
| `order-panel` | Inline order panel (cpXxx functions) | `ticker`, `atrData` |
| `analysis` | Technical analysis pre block | `analysis`, `analysisHistory` |
| `claude-insights` | Claude response display | `claudeResponse` |
| `position-track` | Position tracking card | `positionTrack`, `positionTrackHistory` |
| `balance` | Holdings + donut chart | `snapshot` |
| `history` | Order history table | `snapshot` |
| `trade-review` | Trade review modal | `tradeReviewData`, `tradeReviewClaude` |

**New `index.html` (~50 lines):**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Trading Tool Builder</title>
  <link rel="stylesheet" href="/core/theme.css">
</head>
<body>
  <div id="app">
    <aside id="chat-panel"></aside>
    <main id="layout-grid"></main>
  </div>
  <script type="module" src="/core/app.js"></script>
</body>
</html>
```

**Verification checklist:**

| # | Check | How | Who |
|---|-------|-----|-----|
| 3.1 | Each component extends `Component` base class | Grep: every component file has `extends Component` | `[AI]` |
| 3.2 | Each component has correct `static id` | Parse all component files, verify IDs match manifest | `[AI]` |
| 3.3 | Each component subscribes to correct bus events | Compare component `this.on()` calls with manifest expectations | `[AI]` |
| 3.4 | Each component implements `destroy()` cleanup | Grep for `destroy()` in each component | `[AI]` |
| 3.5 | No global variables in component files | Grep for `window.` or top-level `let/var` outside class | `[AI]` |
| 3.6 | Old `index.html` replaced | `wc -l public/index.html` ≤ 60 lines | `[AI]` |
| 3.7 | All BEM class names are prefixed | Grep CSS for unprefixed generic names (`.price`, `.card`, etc.) | `[AI]` |
| 3.8 | `layout.add('ticker')` works → ticker panel appears | Open browser, run in console: `app.layout.add('ticker')` | `[YOU]` |
| 3.9 | `layout.remove('ticker')` works → panel disappears cleanly | Run in console: `app.layout.remove('ticker')` | `[YOU]` |
| 3.10 | Add all 11 components → full dashboard renders | Run in console: add all components one by one | `[YOU]` |
| 3.11 | Ticker: price updates in real-time with flash animation | Watch for 10 seconds, price changes and flashes green/red | `[YOU]` |
| 3.12 | Chart: candlesticks render, crosshair works on hover | Hover over chart, crosshair follows mouse | `[YOU]` |
| 3.13 | Chart: bar selector (3m/15m/1H/4H/1D) switches timeframe | Click each bar option | `[YOU]` |
| 3.14 | Positions: shows current positions (or empty state) | Check against OKX app for accuracy | `[YOU]` |
| 3.15 | Order panel: place a demo market order (small size) | Buy 0.1 BTC-USDT-SWAP on demo, verify success message | `[YOU]` |
| 3.16 | Open orders: shows pending limit orders, cancel works | Place limit order far from price → see it → cancel it | `[YOU]` |
| 3.17 | Analysis: technical analysis text renders | Wait for analysis refresh or trigger manually | `[YOU]` |
| 3.18 | Claude insights: AI response appears after analysis | Wait for auto-assess or click "Ask Claude" | `[YOU]` |
| 3.19 | Position track: tracking text appears when holding position | Hold a position, wait 3 min | `[YOU]` |
| 3.20 | Balance: equity and holdings display correctly | Compare with OKX app | `[YOU]` |
| 3.21 | History: past orders listed with correct P&L | Compare a few entries with OKX app | `[YOU]` |
| 3.22 | Trade review: click review on a history entry → modal with chart + AI analysis | Click review button on any order | `[YOU]` |
| 3.23 | Remove one component → others still work | Remove `analysis`, verify `ticker` and `chart` unaffected | `[YOU]` |
| 3.24 | Page refresh → layout restored from localStorage | Refresh browser, same components re-appear | `[YOU]` |

**Gate:** 3.1–3.7 pass automatically. You walk through 3.8–3.24 (takes ~15 minutes with a demo account).

---

### Phase 4: AI Assistant Core
> Goal: The assistant understands capabilities and controls the layout

**Files to create/modify:**
- `core/ai/assistant.js` — Dynamic system prompt with capability awareness
- `public/core/chat.js` — Chat UI with action tag parsing

**Verification checklist:**

| # | Check | How | Who |
|---|-------|-----|-----|
| 4.1 | System prompt includes all capabilities from manifest | Log the generated system prompt, verify it lists all 11 capabilities | `[AI]` |
| 4.2 | System prompt includes current enabled components | Enable 3 components → check system prompt lists exactly those 3 | `[AI]` |
| 4.3 | Action tag parsing works | Unit test: parse `<enable-component id="chart"/>` from response text | `[AI]` |
| 4.4 | Chat panel renders and accepts input | Open browser, type a message, see it appear | `[YOU]` |
| 4.5 | "Show me the chart" → chart component appears | Type this in chat, chart panel should appear in the grid | `[YOU]` |
| 4.6 | "I want to start trading" → positions + order-panel + open-orders appear | Type this in chat | `[YOU]` |
| 4.7 | "Remove the analysis panel" → analysis component removed | Type this in chat | `[YOU]` |
| 4.8 | "What can I do?" → AI lists available but not-yet-enabled capabilities | Type this in chat, verify list makes sense | `[YOU]` |
| 4.9 | AI explains what it enabled after doing it | Check AI response includes explanation, not just silent action | `[YOU]` |
| 4.10 | Ambiguous request handled gracefully | Type "make it better" — AI should ask for clarification, not crash | `[YOU]` |
| 4.11 | Layout persists after AI changes + page refresh | AI enables chart → refresh page → chart still there | `[YOU]` |
| 4.12 | Chat history preserved in session | Send 3 messages → scroll up → all 3 visible | `[YOU]` |
| 4.13 | Mode switch via chat | "Switch to live mode" → mode changes, data refreshes | `[YOU]` |

**Gate:** 4.1–4.3 automated. You run through 4.4–4.13 conversationally (~10 minutes).

---

### Phase 5: Suggestion Engine
> Goal: Proactive, contextual "what's next" suggestions

**Files to create:**
- `core/ai/suggestions.js` — Rule-based suggestion engine
- `core/ai/journey.js` — Journey stage tracker + usage stats

**Verification checklist:**

| # | Check | How | Who |
|---|-------|-----|-----|
| 5.1 | Suggestion rules cover all journey transitions | Code review: each stage pair has at least one rule | `[AI]` |
| 5.2 | No duplicate suggestions in single session | Unit test: trigger same condition twice → suggestion appears once | `[AI]` |
| 5.3 | Suggestion data structure is valid | Unit test: `getSuggestions()` returns `{ text, action }` objects | `[AI]` |
| 5.4 | New user gets initial suggestion | Open with empty layout → within 5s chat shows a welcome suggestion | `[YOU]` |
| 5.5 | "Accept" a suggestion → component enables | Click accept on suggestion → component appears | `[YOU]` |
| 5.6 | "Dismiss" a suggestion → it goes away | Click dismiss → suggestion disappears, doesn't come back immediately | `[YOU]` |
| 5.7 | Trade triggers position-track suggestion | Place a demo order → suggestion to enable position tracking appears | `[YOU]` |
| 5.8 | Close position triggers postmortem suggestion | Close a demo position → suggestion to review the trade appears | `[YOU]` |
| 5.9 | Suggestions don't interrupt active chat | While typing a message, suggestion appears without stealing focus or clearing input | `[YOU]` |
| 5.10 | Suggestion timing feels natural | Use the dashboard for 5 min — suggestions should feel helpful, not annoying | `[YOU]` |

**Gate:** 5.1–5.3 automated. You do 5.4–5.10 by using the dashboard normally for ~10 minutes.

---

### Phase 6: Polish & Documentation
> Goal: Production-ready UX + plugin developer guide

**Tasks:**
- Default onboarding: new user sees chat + ticker only, AI greets and offers guided tour
- Responsive layout: mobile-friendly grid
- Mode toggle (demo/live) integrated into chat ("switch to live mode")
- Error handling: graceful degradation when components fail
- `docs/PLUGIN_CONTRACT.md` — How to build a new domain plugin
- Update README with new architecture
- Migration guide from old structure

**Verification checklist:**

| # | Check | How | Who |
|---|-------|-----|-----|
| 6.1 | First visit shows welcome onboarding | Clear localStorage, open page — see chat greeting + ticker only | `[YOU]` |
| 6.2 | Responsive: desktop (≥1200px) | Full layout with chat sidebar + multi-column grid | `[YOU]` |
| 6.3 | Responsive: tablet (768–1199px) | Chat collapses to bottom sheet or overlay, grid reduces columns | `[YOU]` |
| 6.4 | Responsive: mobile (< 768px) | Single column, chat is primary view, components stack | `[YOU]` |
| 6.5 | Component error isolation | Kill OKX API mid-session → ticker shows error state, other components survive | `[YOU]` |
| 6.6 | Plugin contract doc is complete | Follow PLUGIN_CONTRACT.md to create a dummy "hello" plugin — it works | `[BOTH]` |
| 6.7 | README reflects new architecture | Read it — accurately describes project, setup, and usage | `[BOTH]` |
| 6.8 | Overall feel | Use for 15 min as if first time. Is it intuitive? Does the AI guide well? | `[YOU]` |

**Gate:** You walk through all checks. This is a UX-focused phase — human judgment required throughout.

---

## Key Decisions & Trade-offs

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| Vanilla JS + ES modules | Zero build step, accessible to beginners | No TypeScript, no tree-shaking |
| Plugin components served dynamically | Self-contained plugins, no copy step | Need server route for `/plugins/:id/components/*` |
| Action tags in AI output | Simple, parseable component control | Requires reliable AI output formatting |
| localStorage for layout | No server-side user state needed | Lost if user clears browser data |
| CSS Grid for layout | Native, flexible, no library | Manual responsive breakpoints |
| Single WebSocket | Simple, proven pattern | All data on one connection |

---

## Migration Strategy

We refactor **incrementally** — each phase produces a working system.

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5 ──→ Phase 6
  │            │            │            │            │            │
  ▼            ▼            ▼            ▼            ▼            ▼
 Core        Plugin       UI split    AI-driven    Suggestions  Production
 skeleton    extracted    components  layout       engine       ready
 (boots,     (same        (modular    (chat        (proactive   (onboarding
  empty)     behavior)    panels)     controls)    hints)       polish)
```

Each phase is independently deployable. We can stop at any phase and have a working system.

---

## Decisions (resolved)

1. **Component styling**: Global CSS + BEM naming. No Shadow DOM — keeps AI style editing simple, low complexity for ~11 components.
2. **Multi-user**: Single-user (single-tenant). Personal tool, no auth needed.
3. **Plugin hot-reload**: Manual browser refresh. No cache-busting or auto-reload in v1.
4. **Component communication**: Event bus only. Components never reference each other directly. Cross-component interaction via custom bus events (e.g. `chart:select-time`).
