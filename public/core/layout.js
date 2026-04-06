/**
 * public/core/layout.js — Tabbed layout manager
 *
 * Owns persisted dashboard composition state.
 * Tabs are the top-level layout unit; add/remove/restore/list APIs operate
 * on the currently active tab.
 */
import { Component } from './component.js';

const STORAGE_KEY = 'layoutState';

function makeTab(id, title = 'New Tab') {
  return {
    id,
    title,
    layout: {
      active: [],
      removed: [],
    },
  };
}

export class LayoutManager {
  constructor(containerEl, bus, { pluginId = 'okx', storage = null } = {}) {
    this.container  = containerEl;
    this.bus        = bus;
    this._pluginId  = pluginId;
    this._storage   = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this._panels    = new Map();
    this._state     = {
      version: 2,
      activeTabId: 'tab-1',
      tabs: [makeTab('tab-1', 'Watch')],
    };
  }

  async add(componentId, position = 'auto') {
    if (this._panels.has(componentId)) return;
    await this._mount(componentId, position);

    const tab = this.getActiveTab();
    tab.layout.active.push({ id: componentId, position });
    tab.layout.removed = tab.layout.removed.filter(id => id !== componentId);
    this.save();

    this.bus.emit('layout:added', { id: componentId, tabId: tab.id });
    this.bus.emit('layout:changed', this.snapshot());
  }

  remove(componentId) {
    const entry = this._panels.get(componentId);
    if (!entry) return;

    entry.component.destroy();
    entry.el.remove();
    this._panels.delete(componentId);

    const tab = this.getActiveTab();
    tab.layout.active = tab.layout.active.filter(l => l.id !== componentId);
    tab.layout.removed = [componentId, ...tab.layout.removed.filter(id => id !== componentId)].slice(0, 8);
    this.save();

    this.bus.emit('layout:removed', { id: componentId, tabId: tab.id });
    this.bus.emit('layout:changed', this.snapshot());
  }

  async restore(componentId) {
    await this.add(componentId);
  }

  has(componentId) {
    return this._panels.has(componentId);
  }

  list() {
    return this.getActiveTab().layout.active.map(item => item.id);
  }

  listRecentlyRemoved() {
    return [...this.getActiveTab().layout.removed];
  }

  listAvailable(catalog) {
    const active = new Set(this.list());
    const removed = new Set(this.listRecentlyRemoved());
    return catalog.filter(item => !active.has(item.id) && !removed.has(item.id));
  }

  listTabs() {
    return this._state.tabs.map(tab => ({
      id: tab.id,
      title: tab.title,
      count: tab.layout.active.length,
    }));
  }

  getActiveTabId() {
    return this._state.activeTabId;
  }

  getActiveTab() {
    return this._state.tabs.find(tab => tab.id === this._state.activeTabId) || this._state.tabs[0];
  }

  async addTab(title = 'New Tab', components = []) {
    const id = `tab-${Date.now()}`;
    const tab = makeTab(id, title);
    tab.layout.active = components.map(componentId => ({ id: componentId, position: 'auto' }));
    this._state.tabs.push(tab);
    this._state.activeTabId = id;
    await this._switchMountedTab();
    this.save();
    this.bus.emit('layout:tab-changed', this.snapshot());
    this.bus.emit('layout:changed', this.snapshot());
  }

  renameTab(tabId, title) {
    const tab = this._state.tabs.find(t => t.id === tabId);
    if (!tab || !title?.trim()) return;
    tab.title = title.trim();
    this.save();
    this.bus.emit('layout:tab-changed', this.snapshot());
    this.bus.emit('layout:changed', this.snapshot());
  }

  async removeTab(tabId) {
    if (this._state.tabs.length <= 1) return;
    const idx = this._state.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    const removingActive = this._state.activeTabId === tabId;
    this._state.tabs.splice(idx, 1);
    if (removingActive) {
      this._state.activeTabId = this._state.tabs[Math.max(0, idx - 1)]?.id || this._state.tabs[0].id;
      await this._switchMountedTab();
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
    this.bus.emit('layout:changed', this.snapshot());
  }

  snapshot() {
    const activeTab = this.getActiveTab();
    return {
      activeTabId: this._state.activeTabId,
      activeTab: {
        id: activeTab.id,
        title: activeTab.title,
        active: activeTab.layout.active.map(item => item.id),
        removed: [...activeTab.layout.removed],
      },
      tabs: this._state.tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        active: tab.layout.active.map(item => item.id),
        removed: [...tab.layout.removed],
      })),
      active: activeTab.layout.active.map(item => item.id),
      removed: [...activeTab.layout.removed],
    };
  }

  async _switchMountedTab() {
    for (const [, entry] of this._panels) {
      entry.component.destroy();
      entry.el.remove();
    }
    this._panels.clear();

    const tab = this.getActiveTab();
    for (const c of tab.layout.active) {
      await this._mount(c.id, c.position ?? 'auto');
    }
  }

  async _mount(componentId, position = 'auto') {
    if (this._panels.has(componentId)) return;

    const el = document.createElement('div');
    el.dataset.component = componentId;
    el.classList.add('panel', `panel--${componentId}`);
    this.container.appendChild(el);

    const ComponentClass = await this._importComponent(componentId);
    let instance;
    try {
      instance = new ComponentClass(el, this.bus, {});
      await instance.init();
    } catch (err) {
      console.error(`[layout] ${componentId} failed to init:`, err);
      el.innerHTML = `<div class="panel__error">⚠ ${componentId} failed to load<br><small>${err.message}</small></div>`;
      instance = { destroy: () => {} };
    }
    this._panels.set(componentId, { component: instance, el, position });
  }

  async _importComponent(componentId) {
    try {
      const mod = await import(`/plugins/${this._pluginId}/components/${componentId}/${componentId}.js`);
      return mod.default;
    } catch {
      return class Placeholder extends Component {
        static id = componentId;
        async init() {
          this.el.innerHTML = `<div class="panel__placeholder">${componentId}</div>`;
        }
      };
    }
  }
}

export function migrateState(saved, defaults = []) {
  if (saved?.version === 2 && Array.isArray(saved.tabs) && saved.tabs.length) {
    return saved;
  }

  if (saved && Array.isArray(saved.active)) {
    return {
      version: 2,
      activeTabId: 'tab-1',
      tabs: [{
        id: 'tab-1',
        title: 'Watch',
        layout: {
          active: saved.active,
          removed: Array.isArray(saved.removed) ? saved.removed : [],
        },
      }],
    };
  }

  return {
    version: 2,
    activeTabId: 'tab-1',
    tabs: [{
      id: 'tab-1',
      title: 'Watch',
      layout: {
        active: defaults.map(c => typeof c === 'string' ? { id: c, position: 'auto' } : c),
        removed: [],
      },
    }],
  };
}
