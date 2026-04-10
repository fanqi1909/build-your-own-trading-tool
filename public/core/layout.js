/**
 * public/core/layout.js — Row + column-slot tabbed layout manager (v5)
 *
 * Model:
 *   tab.layout.rows[].cols[]   — each col is a column slot
 *   col.span (1–3)             — grid columns occupied (tile=1, half=2, full=3)
 *   col.panels[]               — components stacked vertically inside the slot
 *
 * DOM:
 *   .layout-row  (display:contents — invisible to CSS grid)
 *     .layout-slot  (flex column, grid-row set by JS, grid-column by data-span)
 *       .panel  (flex:1 — shares slot height equally)
 */
import { Component } from './component.js';

const STORAGE_KEY = 'layoutState';
const COLS        = 3;

const DEFAULT_CONTEXT = {
  instrument: 'BTC-USDT-SWAP', bar: '15m',
  watchlist:  ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'],
  leverage:   10,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function rowId() { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; }
function colId() { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; }
function makeRow(id) { return { id: id || rowId(), cols: [] }; }
function makeCol(span = 1, id) { return { id: id || colId(), span, panels: [] }; }

function sizeSpan(size) {
  if (size === 'full') return 3;
  if (size === 'half') return 2;
  return 1;
}

function spanSize(span) {
  if (span === 3) return 'full';
  if (span === 2) return 'half';
  return 'tile';
}

function colUsed(row) {
  return row.cols.reduce((s, c) => s + c.span, 0);
}

/** Pack a flat list of { id, span?, size?, config } into v5 rows. */
function packIntoRows(items) {
  const rows = [];
  let cur = makeRow(), used = 0;
  for (const item of items) {
    const span = item.span ?? sizeSpan(item.size || 'tile');
    if (used + span > COLS && cur.cols.length) {
      rows.push(cur); cur = makeRow(); used = 0;
    }
    const col = makeCol(span);
    col.panels.push({ id: item.id, config: item.config ?? {} });
    cur.cols.push(col);
    used += span;
  }
  if (cur.cols.length) rows.push(cur);
  return rows;
}

function makeTab(id, title = 'New Tab') {
  return {
    id, title,
    context: { ...DEFAULT_CONTEXT },
    layout: { rows: [], removed: [] },
  };
}

// ── LayoutManager ──────────────────────────────────────────────────────────

export class LayoutManager {
  constructor(containerEl, bus, { pluginId = 'okx', storage = null } = {}) {
    this.container = containerEl;
    this.bus       = bus;
    this._pluginId = pluginId;
    this._storage  = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this._panels   = new Map(); // panelId → { component, el, colId }
    this._colEls   = new Map(); // colId   → slotEl
    this._rowEls   = new Map(); // rowId   → rowEl
    this._state    = {
      version: 5,
      activeTabId: 'tab-1',
      tabs: [makeTab('tab-1', 'Watch')],
    };

    this.bus.on('context:patch', ({ patch, tabId }) => this.patchContext(patch, tabId));
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Add a component as a new single-panel col in the last row with room. */
  async add(componentId, size = 'tile', config = {}) {
    if (this.has(componentId)) return;
    const span = sizeSpan(size);
    const tab  = this.getActiveTab();

    let targetRow = null;
    for (let i = tab.layout.rows.length - 1; i >= 0; i--) {
      if (colUsed(tab.layout.rows[i]) + span <= COLS) {
        targetRow = tab.layout.rows[i];
        break;
      }
    }
    if (!targetRow) {
      targetRow = makeRow();
      tab.layout.rows.push(targetRow);
    }

    const col = makeCol(span);
    col.panels.push({ id: componentId, config });
    targetRow.cols.push(col);
    tab.layout.removed = tab.layout.removed.filter(id => id !== componentId);

    const rowEl  = this._getOrCreateRowEl(targetRow.id);
    const slotEl = this._createSlotEl(col.id, col.span);
    rowEl.appendChild(slotEl);
    this._colEls.set(col.id, slotEl);
    await this._mountPanel(componentId, config, slotEl, col.id);
    this._refreshGridRows();
    this.save();
    this.bus.emit('layout:changed', this.snapshot());
  }

  /** Stack a new component into an existing col (below its current panels). */
  async stackInto(componentId, targetColId, config = {}) {
    if (this.has(componentId)) return;
    const tab = this.getActiveTab();
    const col = this._findCol(tab, targetColId);
    if (!col) return;

    col.panels.push({ id: componentId, config });
    tab.layout.removed = tab.layout.removed.filter(id => id !== componentId);

    const slotEl = this._colEls.get(targetColId);
    if (slotEl) await this._mountPanel(componentId, config, slotEl, targetColId);
    this.save();
    this.bus.emit('layout:changed', this.snapshot());
  }

  /** Remove a component. Cleans up empty col/row automatically. */
  remove(componentId) {
    const entry = this._panels.get(componentId);
    if (!entry) return;

    entry.component.destroy();
    entry.el.remove();
    this._panels.delete(componentId);

    const tab = this.getActiveTab();
    outer: for (const row of tab.layout.rows) {
      for (const col of row.cols) {
        const idx = col.panels.findIndex(p => p.id === componentId);
        if (idx < 0) continue;
        col.panels.splice(idx, 1);
        if (col.panels.length === 0) {
          row.cols = row.cols.filter(c => c.id !== col.id);
          const slotEl = this._colEls.get(col.id);
          if (slotEl) { slotEl.remove(); this._colEls.delete(col.id); }
          if (row.cols.length === 0) {
            tab.layout.rows = tab.layout.rows.filter(r => r.id !== row.id);
            const rowEl = this._rowEls.get(row.id);
            if (rowEl) { rowEl.remove(); this._rowEls.delete(row.id); }
          }
        }
        break outer;
      }
    }

    tab.layout.removed = [componentId, ...tab.layout.removed.filter(id => id !== componentId)].slice(0, 8);
    this._refreshGridRows();
    this.save();
    this.bus.emit('layout:changed', this.snapshot());
  }

  async restore(componentId, config = {}) {
    await this.add(componentId, 'tile', config);
  }

  /** Resize a column slot by colId. */
  setColSpan(colId, span) {
    const tab = this.getActiveTab();
    for (const row of tab.layout.rows) {
      const col = row.cols.find(c => c.id === colId);
      if (!col) continue;
      const others = row.cols.filter(c => c.id !== colId).reduce((s, c) => s + c.span, 0);
      if (others + span > COLS) return;
      col.span = span;
      const slotEl = this._colEls.get(colId);
      if (slotEl) slotEl.dataset.span = span;
      this.save();
      this.bus.emit('layout:changed', this.snapshot());
      return;
    }
  }

  /** Compat: resize by componentId (works when panel is alone in its col). */
  setItemSize(componentId, size) {
    const colId = this._panels.get(componentId)?.colId;
    if (colId) this.setColSpan(colId, sizeSpan(size));
  }

  /** Which integer spans can this col take given its row? */
  availableSpans(colId) {
    const tab = this.getActiveTab();
    for (const row of tab.layout.rows) {
      const col = row.cols.find(c => c.id === colId);
      if (!col) continue;
      const others = row.cols.filter(c => c.id !== colId).reduce((s, c) => s + c.span, 0);
      return [1, 2, 3].filter(s => others + s <= COLS);
    }
    return [1, 2, 3];
  }

  /** Compat: returns size strings for the col that owns componentId. */
  availableSizes(componentId) {
    const colId = this._panels.get(componentId)?.colId;
    return (colId ? this.availableSpans(colId) : [1, 2, 3]).map(spanSize);
  }

  /**
   * Move fromId's panel to be adjacent to toId's panel.
   * Same col → reorder within col.panels[].
   * Different col → move panel to toId's col.
   */
  reorder(fromId, toId) {
    if (fromId === toId) return;
    const tab = this.getActiveTab();

    let fromRow, fromCol, fromPIdx;
    let toRow,   toCol,   toPIdx;

    for (const row of tab.layout.rows) {
      for (const col of row.cols) {
        const fi = col.panels.findIndex(p => p.id === fromId);
        const ti = col.panels.findIndex(p => p.id === toId);
        if (fi >= 0) { fromRow = row; fromCol = col; fromPIdx = fi; }
        if (ti >= 0) { toRow   = row; toCol   = col; toPIdx   = ti; }
      }
    }
    if (!fromCol || !toCol) return;

    if (fromCol === toCol) {
      // Reorder within the same slot
      const [moved] = fromCol.panels.splice(fromPIdx, 1);
      fromCol.panels.splice(toPIdx, 0, moved);
      const slotEl = this._colEls.get(fromCol.id);
      const fromEl = this._panels.get(fromId)?.el;
      const toEl   = this._panels.get(toId)?.el;
      if (slotEl && fromEl && toEl) {
        if (toPIdx < fromPIdx) slotEl.insertBefore(fromEl, toEl);
        else slotEl.insertBefore(fromEl, toEl.nextSibling);
      }
    } else {
      // Move panel to a different slot
      const [movedPanel] = fromCol.panels.splice(fromPIdx, 1);

      // Clean up source col/row if empty
      if (fromCol.panels.length === 0) {
        fromRow.cols = fromRow.cols.filter(c => c.id !== fromCol.id);
        const slotEl = this._colEls.get(fromCol.id);
        if (slotEl) { slotEl.remove(); this._colEls.delete(fromCol.id); }
        if (fromRow.cols.length === 0) {
          tab.layout.rows = tab.layout.rows.filter(r => r.id !== fromRow.id);
          const rowEl = this._rowEls.get(fromRow.id);
          if (rowEl) { rowEl.remove(); this._rowEls.delete(fromRow.id); }
        }
      }

      toCol.panels.splice(toPIdx, 0, movedPanel);
      const toSlotEl = this._colEls.get(toCol.id);
      const fromEl   = this._panels.get(fromId)?.el;
      const toEl     = this._panels.get(toId)?.el;
      if (toSlotEl && fromEl) {
        if (toEl) toSlotEl.insertBefore(fromEl, toEl);
        else toSlotEl.appendChild(fromEl);
      }
      const entry = this._panels.get(fromId);
      if (entry) entry.colId = toCol.id;
    }

    this._refreshGridRows();
    this.save();
    this.bus.emit('layout:changed', this.snapshot());
  }

  has(componentId) { return this._panels.has(componentId); }

  list() {
    return this.getActiveTab().layout.rows
      .flatMap(row => row.cols.flatMap(col => col.panels.map(p => p.id)));
  }

  getRows() { return this.getActiveTab().layout.rows; }

  /** Return colId for a given componentId (for stack-into UI). */
  getColId(componentId) { return this._panels.get(componentId)?.colId ?? null; }

  listRecentlyRemoved() { return [...this.getActiveTab().layout.removed]; }

  listTabs() {
    return this._state.tabs.map(tab => ({
      id: tab.id, title: tab.title,
      count: tab.layout.rows.reduce((n, r) => n + r.cols.reduce((m, c) => m + c.panels.length, 0), 0),
      context: { ...tab.context },
    }));
  }

  getActiveTabId() { return this._state.activeTabId; }
  getActiveTab()   { return this._state.tabs.find(t => t.id === this._state.activeTabId) || this._state.tabs[0]; }

  getContext(tabId = this._state.activeTabId) {
    return { ...(this._state.tabs.find(t => t.id === tabId) || this.getActiveTab()).context };
  }

  patchContext(patch, tabId = this._state.activeTabId) {
    const tab = this._state.tabs.find(t => t.id === tabId);
    if (!tab || !patch) return;
    const prev = { ...tab.context };
    tab.context = { ...tab.context, ...patch };
    const changedKeys = Object.keys(patch).filter(k => prev[k] !== tab.context[k]);
    if (!changedKeys.length) return;
    this.save();
    this.bus.emit('context:changed', { tabId, context: { ...tab.context }, changedKeys });
    this.bus.emit('layout:changed', this.snapshot());
  }

  getItemConfig(componentId, tabId = this._state.activeTabId) {
    const tab = this._state.tabs.find(t => t.id === tabId) || this.getActiveTab();
    for (const row of tab.layout.rows) {
      for (const col of row.cols) {
        const p = col.panels.find(p => p.id === componentId);
        if (p) return { ...p.config };
      }
    }
    return {};
  }

  updateItemConfig(componentId, patch, tabId = this._state.activeTabId) {
    const tab = this._state.tabs.find(t => t.id === tabId) || this.getActiveTab();
    for (const row of tab.layout.rows) {
      for (const col of row.cols) {
        const p = col.panels.find(p => p.id === componentId);
        if (!p) continue;
        p.config = { ...p.config, ...patch };
        this.save();
        this.bus.emit('layout:changed', this.snapshot());
        return;
      }
    }
  }

  async addTab(title = 'New Tab', components = []) {
    const id  = `tab-${Date.now()}`;
    const tab = makeTab(id, title);
    tab.layout.rows = packIntoRows(components.map(id => ({ id, span: 1, config: {} })));
    this._state.tabs.push(tab);
    this._state.activeTabId = id;
    await this._switchMountedTab();
    this.save();
    this.bus.emit('layout:tab-changed', this.snapshot());
    this.bus.emit('context:changed', { tabId: id, context: { ...tab.context }, changedKeys: Object.keys(tab.context) });
    this.bus.emit('layout:changed', this.snapshot());
  }

  renameTab(tabId, title) {
    const tab = this._state.tabs.find(t => t.id === tabId);
    if (!tab || !title?.trim()) return;
    tab.title = title.trim();
    this.save();
    this.bus.emit('layout:tab-changed', this.snapshot());
  }

  async removeTab(tabId) {
    if (this._state.tabs.length <= 1) return;
    const idx = this._state.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    const wasActive = this._state.activeTabId === tabId;
    this._state.tabs.splice(idx, 1);
    if (wasActive) {
      this._state.activeTabId = this._state.tabs[Math.max(0, idx - 1)]?.id || this._state.tabs[0].id;
      await this._switchMountedTab();
      this.bus.emit('context:changed', { tabId: this._state.activeTabId, context: this.getContext(), changedKeys: Object.keys(this.getContext()) });
    }
    this.save();
    this.bus.emit('layout:tab-changed', this.snapshot());
    this.bus.emit('layout:changed', this.snapshot());
  }

  async switchTab(tabId) {
    if (tabId === this._state.activeTabId) return;
    if (!this._state.tabs.some(t => t.id === tabId)) return;
    this._state.activeTabId = tabId;
    await this._switchMountedTab();
    this.save();
    this.bus.emit('layout:tab-changed', this.snapshot());
    this.bus.emit('context:changed', { tabId, context: this.getContext(tabId), changedKeys: Object.keys(this.getContext(tabId)) });
    this.bus.emit('layout:changed', this.snapshot());
  }

  save() {
    if (!this._storage) return;
    this._storage.setItem(STORAGE_KEY, JSON.stringify(this._state));
  }

  async restoreFromStorage(defaults = []) {
    let saved = null;
    if (this._storage) {
      try { saved = JSON.parse(this._storage.getItem(STORAGE_KEY)); } catch {}
    }
    this._state = migrateState(saved, defaults);
    await this._switchMountedTab();
    this.bus.emit('context:changed', { tabId: this._state.activeTabId, context: this.getContext(), changedKeys: Object.keys(this.getContext()) });
    this.bus.emit('layout:changed', this.snapshot());
  }

  snapshot() {
    const tab    = this.getActiveTab();
    const active = tab.layout.rows.flatMap(r => r.cols.flatMap(c => c.panels.map(p => p.id)));
    return {
      activeTabId: this._state.activeTabId,
      activeTab:   { id: tab.id, title: tab.title, context: { ...tab.context }, active, removed: [...tab.layout.removed] },
      tabs:        this._state.tabs.map(t => ({
        id: t.id, title: t.title, context: { ...t.context },
        active:  t.layout.rows.flatMap(r => r.cols.flatMap(c => c.panels.map(p => p.id))),
        removed: [...t.layout.removed],
      })),
      active,
      removed: [...tab.layout.removed],
      context: { ...tab.context },
      rows:    tab.layout.rows,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  async _switchMountedTab() {
    for (const [, entry] of this._panels) entry.component.destroy();
    this._panels.clear();
    this._colEls.clear();
    this._rowEls.clear();
    this.container.innerHTML = '';

    const tab = this.getActiveTab();
    for (const row of tab.layout.rows) {
      const rowEl = this._createRowEl(row.id);
      this.container.appendChild(rowEl);
      this._rowEls.set(row.id, rowEl);
      for (const col of row.cols) {
        const slotEl = this._createSlotEl(col.id, col.span);
        rowEl.appendChild(slotEl);
        this._colEls.set(col.id, slotEl);
        for (const panel of col.panels) {
          await this._mountPanel(panel.id, panel.config, slotEl, col.id);
        }
      }
    }
    this._refreshGridRows();
  }

  _refreshGridRows() {
    const rows = this.getActiveTab().layout.rows;
    rows.forEach((row, rowIndex) => {
      for (const col of row.cols) {
        const slotEl = this._colEls.get(col.id);
        if (slotEl) slotEl.style.gridRow = rowIndex + 1;
      }
    });
  }

  _createRowEl(id) {
    const el = document.createElement('div');
    el.className     = 'layout-row';
    el.dataset.rowId = id;
    return el;
  }

  _getOrCreateRowEl(rowId) {
    if (this._rowEls.has(rowId)) return this._rowEls.get(rowId);
    const el = this._createRowEl(rowId);
    this.container.appendChild(el);
    this._rowEls.set(rowId, el);
    return el;
  }

  _createSlotEl(id, span) {
    const el = document.createElement('div');
    el.className     = 'layout-slot';
    el.dataset.colId = id;
    el.dataset.span  = span;
    return el;
  }

  async _mountPanel(componentId, config, slotEl, colId) {
    const el = document.createElement('div');
    el.dataset.component = componentId;
    el.classList.add('panel', `panel--${componentId}`);
    slotEl.appendChild(el);

    const ComponentClass = await this._importComponent(componentId);
    let instance;
    try {
      instance = new ComponentClass(el, this.bus, config);
      await instance.init();
    } catch (err) {
      console.error(`[layout] ${componentId} failed to init:`, err);
      el.innerHTML = `<div class="panel__error">⚠ ${componentId} failed to load<br><small>${err.message}</small></div>`;
      instance = { destroy: () => {} };
    }
    this._panels.set(componentId, { component: instance, el, colId });
  }

  async _importComponent(componentId) {
    try {
      const mod = await import(`/plugins/${this._pluginId}/components/${componentId}/${componentId}.js`);
      return mod.default;
    } catch {
      return class Placeholder extends Component {
        static id = componentId;
        async init() { this.el.innerHTML = `<div class="panel__placeholder">${componentId}</div>`; }
      };
    }
  }

  _findCol(tab, colId) {
    for (const row of tab.layout.rows) {
      const col = row.cols.find(c => c.id === colId);
      if (col) return col;
    }
    return null;
  }
}

// ── Migration ──────────────────────────────────────────────────────────────

export function migrateState(saved, defaults = []) {
  // v5: current format
  if (saved?.version === 5 && Array.isArray(saved.tabs) && saved.tabs.length) {
    saved.tabs.forEach(tab => {
      tab.context = { ...DEFAULT_CONTEXT, ...tab.context };
      tab.layout.rows = (tab.layout.rows || []).map(row => ({
        ...row,
        cols: (row.cols || []).map(col => ({
          ...col,
          span:   col.span ?? 1,
          panels: (col.panels || []).map(p => (typeof p === 'string' ? { id: p, config: {} } : p)),
        })),
      }));
      tab.layout.removed = tab.layout.removed || [];
    });
    return saved;
  }

  // v4: rows[].items[] → rows[].cols[] (each item → single-panel col)
  if (saved?.version === 4 && Array.isArray(saved.tabs) && saved.tabs.length) {
    return {
      version: 5, activeTabId: saved.activeTabId,
      tabs: saved.tabs.map(tab => ({
        ...tab,
        context: { ...DEFAULT_CONTEXT, ...tab.context },
        layout: {
          rows: (tab.layout.rows || []).map(row => ({
            id: row.id,
            cols: (row.items || []).map(item => ({
              id:     colId(),
              span:   sizeSpan(item.size || 'tile'),
              panels: [{ id: item.id, config: item.config ?? {} }],
            })),
          })),
          removed: tab.layout.removed || [],
        },
      })),
    };
  }

  // v3: active[] → convert directly to v5 cols format
  if (saved?.version === 3 && Array.isArray(saved.tabs) && saved.tabs.length) {
    return migrateState({
      version: 5, activeTabId: saved.activeTabId,
      tabs: saved.tabs.map(tab => ({
        ...tab,
        layout: {
          rows:    packIntoRows((tab.layout?.active || []).map(it =>
            typeof it === 'string' ? { id: it, size: 'tile', config: {} } : it)),
          removed: tab.layout?.removed || [],
        },
      })),
    }, defaults);
  }

  // v2 or older (flat active[])
  if (saved?.tabs || saved?.active) {
    const active = saved.active || saved.tabs?.[0]?.layout?.active || [];
    return migrateState({
      version: 3, activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', title: 'Watch', context: {}, layout: { active, removed: [] } }],
    }, defaults);
  }

  // Fresh start
  return {
    version: 5, activeTabId: 'tab-1',
    tabs: [{
      id: 'tab-1', title: 'Watch',
      context: { ...DEFAULT_CONTEXT },
      layout: {
        rows:    packIntoRows(defaults.map(id => ({ id, span: 1, config: {} }))),
        removed: [],
      },
    }],
  };
}
