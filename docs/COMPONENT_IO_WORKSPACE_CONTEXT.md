# Component I/O + Workspace Context

> Status: **Implemented** — this document describes the current working system.

## Overview

Components in the same tab share a **workspace context** object. When one component writes a value (e.g. the instrument changes in the ticker), all other components in the same tab that declared that key as an `input` are automatically notified and can react.

```
ticker selects ETH-USDT-SWAP
  → setContext({ instrument: 'ETH-USDT-SWAP' })
  → tab.context updated + persisted to localStorage
  → context:changed broadcast
  → chart re-fetches ETH candles
  → analysis triggers ETH analysis
  → order-panel switches to ETH
  → claude-insights shows stale indicator
  → history re-fetches ETH trade history
```

---

## Component Contract

Every component should declare what context keys it reads and writes:

```js
export default class MyComponent extends Component {
  static id     = 'my-component';
  static inputs  = ['instrument'];   // context keys this component reads
  static outputs = ['instrument'];   // context keys this component writes
}
```

### Reading context

Call `this.getContext()` once in `init()` to get the current tab context:

```js
async init() {
  const ctx = this.getContext();
  this._instrument = ctx.instrument || 'BTC-USDT-SWAP';
  // ... render with this._instrument
}
```

### Reacting to context changes

Override `onInputChange(key, value)` — the framework calls this automatically when any key listed in `static inputs` changes. No boilerplate needed.

```js
onInputChange(key, value) {
  if (key === 'instrument') {
    this._instrument = value;
    this._refetch();
  }
}
```

The framework guarantees:
- Only fires for keys in `static inputs`
- Never fires if this component itself wrote the change (no infinite loops)
- Only fires for the active tab (inactive tabs are skipped)

### Writing context

Call `this.setContext(patch)` when the user makes a selection that other components should react to:

```js
selectEl.addEventListener('change', (e) => {
  this._instrument = e.target.value;
  this.setContext({ instrument: this._instrument });
});
```

---

## Full Component Example

```js
import { Component } from '/core/component.js';

export default class ExampleComponent extends Component {
  static id      = 'example';
  static inputs  = ['instrument'];
  static outputs = ['instrument'];
  static defaultConfig = { symbols: ['BTC-USDT-SWAP'] };

  async init() {
    // 1. Read current context once at startup
    const ctx = this.getContext();
    this._instrument = ctx.instrument || 'BTC-USDT-SWAP';

    // 2. Render UI
    this.el.innerHTML = `<select id="inst-select">...</select>`;

    // 3. Write to context when user makes a selection
    this.el.querySelector('#inst-select').addEventListener('change', (e) => {
      this._instrument = e.target.value;
      this.setContext({ instrument: this._instrument });
    });

    // 4. Subscribe to server-pushed data
    this.on('someEvent', (msg) => this._onData(msg));
  }

  // 5. React to context changes from other components
  onInputChange(key, value) {
    if (key === 'instrument') {
      this._instrument = value;
      this._refetch();
    }
  }
}
```

---

## Context Keys (current)

| Key | Type | Who writes | Who reads |
|-----|------|------------|-----------|
| `instrument` | `string` e.g. `'BTC-USDT-SWAP'` | ticker, instrument-picker, watchlist | chart, order-panel, analysis, claude-insights, history |
| `bar` | `string` e.g. `'15m'` | chart | chart (self), (future: analysis) |

---

## Workspace Context vs Component Config

### Use **workspace context** when:
- multiple components need the same value
- changing it should update other panels in the same tab
- it represents the current working focus (instrument, timeframe, selected order)

### Use **component config** when:
- the setting belongs to one component only
- it should persist per instance
- other components don't care about it

```js
// Config example — per-instance, not shared
static defaultConfig = {
  symbols:          ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'],
  defaultLeverage:  5,
  defaultOrderType: 'limit',
}
```

---

## How the Framework Wires It Up

Implemented in `public/core/component.js` and `public/core/layout.js`.

**Write path:**
```
component.setContext(patch)
  → bus.emit('context:patch', { patch, sourceComponentId, tabId })
  → LayoutManager.patchContext()
      diffs old vs new context
      saves to localStorage
      emits bus 'context:changed' { tabId, context, changedKeys, sourceComponentId }
```

**Read path:**
```
bus 'context:changed'
  → Component._initContextInputs() listener (wired by LayoutManager after init)
      skips if sourceComponentId === this.constructor.id  (no self-loops)
      skips if tabId !== activeTabId                      (inactive tabs)
      for each key in static inputs that changed:
        calls onInputChange(key, value)
```

`_initContextInputs()` is called automatically by `LayoutManager._mountPanel()` after `init()`. Components never call it directly.

---

## What NOT to Put in Context

Keep context small and semantic. Do **not** put these in context:
- ticker price payloads
- candle arrays
- analysis blobs
- position lists
- loading states
- server cache data

These belong in component-local state or server-streamed events.
