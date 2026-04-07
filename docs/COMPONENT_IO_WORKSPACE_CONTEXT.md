# Component I/O + Workspace Context Design

## Why this exists

The project is evolving from a dashboard made of loosely connected panels into a true **workspace model**.

We now have:
- tabbed workspaces
- Build / Use mode
- AI recommendations for modules and tab structures

The next architectural step is to make component linkage explicit. Instead of treating panels as isolated UI blocks, we define:

- **component inputs** — what state a component consumes
- **component outputs** — what user-driven selections or changes it can publish
- **workspace context** — shared tab-level state that linked components can react to

A concrete example:
- the user selects `BTC-USDT-SWAP` in the ticker
- the current tab’s workspace context updates
- chart, analysis, order-panel, positions, and open-orders can react consistently

---

## Core idea

Use two layers of state:

### 1. Workspace context (shared, tab-level)
This is state shared by multiple components inside the same tab.

Initial recommended keys:

```js
{
  instrument: 'BTC-USDT-SWAP',
  bar: '15m'
}
```

Future-safe examples:

```js
{
  instrument: 'BTC-USDT-SWAP',
  bar: '1H',
  selection: {
    orderId: '123',
    positionId: '456'
  },
  range: '30d'
}
```

### 2. Component config (persistent, instance-level)
This is configuration specific to one component instance.

Examples:

```js
// ticker config
{
  symbols: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
  preset: 'majors'
}
```

```js
// order-panel config
{
  defaultLeverage: 5,
  defaultOrderType: 'limit'
}
```

```js
// chart config
{
  studies: ['ema', 'volume'],
  publishBarChanges: true
}
```

---

## Rule of thumb

### Put state in **workspace context** if:
- multiple components may need it
- changing it should update other components in the same tab
- it represents the current working focus of the tab

Examples:
- current instrument
- current timeframe
- shared row/order/position selection

### Put state in **component config** if:
- it belongs to one component only
- it should persist for that component instance
- changing it should not necessarily update other components

Examples:
- ticker watchlist symbols
- order-panel defaults
- chart visual preferences
- analysis display preferences

---

## Persisted state model

Each tab should own both workspace context and layout items.

Recommended tab shape:

```js
{
  id: 'watch',
  title: 'Watch',
  context: {
    instrument: 'BTC-USDT-SWAP',
    bar: '15m'
  },
  layout: {
    active: [
      {
        id: 'ticker',
        position: 'auto',
        config: {
          symbols: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP']
        }
      },
      {
        id: 'chart',
        position: 'auto',
        config: {}
      }
    ],
    removed: []
  }
}
```

This keeps all dashboard composition inside one persisted owner while clearly separating:
- shared tab state
- per-component configuration

---

## Event model

We should continue to use the existing client-side event bus.

Do **not** introduce direct component-to-component references.

### Recommended events

#### Write shared context
```js
bus.emit('context:patch', {
  patch: { instrument: 'BTC-USDT-SWAP' },
  sourceComponentId: 'ticker',
  tabId: 'watch'
})
```

#### Notify listeners of changes
```js
bus.emit('context:changed', {
  tabId: 'watch',
  context: { instrument: 'BTC-USDT-SWAP', bar: '15m' },
  changedKeys: ['instrument'],
  sourceComponentId: 'ticker'
})
```

Optional scoped events can be added later if helpful:
- `context:instrument:changed`
- `context:bar:changed`

---

## Propagation flow

Recommended flow:

1. User interacts inside a component
2. That component emits `context:patch`
3. The active tab context is updated in layout-owned state
4. The new state is persisted
5. `context:changed` is emitted
6. Other interested components react

Example:

```text
ticker selection
  → context:patch { instrument: 'BTC-USDT-SWAP' }
  → tab.context.instrument updated
  → context:changed
  → chart refreshes
  → analysis refreshes
  → order-panel switches instrument
```

---

## What should NOT go into workspace context

Workspace context should stay semantic and lightweight.

Do **not** put these into tab context:
- latest ticker payload
- candle arrays
- analysis history blobs
- positions / open-orders datasets
- temporary loading state
- server-fetched market data caches

Those belong in:
- streamed server data
- component-local state
- caches keyed by instrument/bar

---

## Component contract direction

The base component model should eventually support lightweight I/O metadata.

Conceptually:

```js
static inputs = ['instrument', 'bar']
static outputs = ['instrument']
static defaultConfig = {
  symbols: ['BTC-USDT-SWAP']
}
```

And components should have small runtime helpers such as:
- `getContext()`
- `setContext(patch)`
- `onContextChange(handler)`
- `getConfig()`
- `updateConfig(patch)`

This does **not** require a heavy framework. It simply makes the existing event-bus architecture more explicit and consistent.

---

## First rollout targets

### 1. `ticker`
**Inputs**
- current `instrument`

**Outputs**
- publishes new `instrument` when user selects a symbol

**Config**
- watchlist symbols
- preset name

### 2. `chart`
**Inputs**
- `instrument`
- `bar`

**Outputs**
- publishes `bar` when the timeframe is changed

**Config**
- studies / visual options

### 3. `order-panel`
**Inputs**
- `instrument`

**Outputs**
- none for shared context initially

**Config**
- default leverage
- default order type

### 4. `analysis`
**Inputs**
- `instrument`
- `bar`

**Outputs**
- none initially

**Config**
- display / auto-run preferences

### 5. `positions` / `open-orders`
**Inputs**
- `instrument` (for filtering or highlighting)

**Outputs**
- later may publish shared selection state

**Config**
- filters / sort preferences

---

## Migration path

Recommended sequence:

1. Extend tab state to include `context`
2. Extend layout items to include `config`
3. Add context helper API in core
4. Add context events (`context:patch`, `context:changed`)
5. Convert `chart` first
6. Convert `order-panel`
7. Convert `ticker`
8. Convert `analysis`, `positions`, `open-orders`
9. Surface component inputs/outputs metadata in docs and possibly manifest-driven tooling later

This sequence gives visible value quickly without requiring a full rewrite.

---

## File impact (future implementation)

Likely implementation files:
- `public/core/layout.js`
- `public/core/component.js`
- `public/core/app.js`
- `public/core/bus.js`
- `plugins/okx/components/ticker/ticker.js`
- `plugins/okx/components/chart/chart.js`
- `plugins/okx/components/analysis/analysis.js`
- `plugins/okx/components/order-panel/order-panel.js`
- `plugins/okx/components/positions/positions.js`
- `plugins/okx/components/open-orders/open-orders.js`
- `plugins/okx/actions/market.js`
- `plugins/okx/actions/analysis.js`

---

## Summary

The design principle is:

- **workspace context** = shared tab-level truth
- **component config** = per-instance persistent settings
- **event bus** = propagation mechanism
- **components** = explicit input/output nodes, not isolated panels

This keeps the current architecture intact while making cross-component linkage first-class.
