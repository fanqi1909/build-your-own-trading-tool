/**
 * public/core/layout.js — Layout manager
 *
 * Manages which components are on screen and persists the home-screen state.
 * Components are dynamically imported from the plugin directory.
 */
import { Component } from './component.js';

const STORAGE_KEY = 'layoutState';

export class LayoutManager {
  constructor(containerEl, bus, { pluginId = 'okx', storage = null } = {}) {
    this.container  = containerEl;
    this.bus        = bus;
    this._pluginId  = pluginId;
    this._storage   = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this._panels    = new Map();
    this._state     = {
      active:  [],   // [{ id, position }]
      removed: [],   // most recent first
    };
  }

  async add(componentId, position = 'auto') {
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

    this._panels.set(componentId, { component: instance, el });
    this._state.active.push({ id: componentId, position });
    this._state.removed = this._state.removed.filter(id => id !== componentId);
    this.save();

    this.bus.emit('layout:added', { id: componentId });
    this.bus.emit('layout:changed', this.snapshot());
  }

  remove(componentId) {
    const entry = this._panels.get(componentId);
    if (!entry) return;

    entry.component.destroy();
    entry.el.remove();
    this._panels.delete(componentId);
    this._state.active = this._state.active.filter(l => l.id !== componentId);
    this._state.removed = [componentId, ...this._state.removed.filter(id => id !== componentId)].slice(0, 8);
    this.save();

    this.bus.emit('layout:removed', { id: componentId });
    this.bus.emit('layout:changed', this.snapshot());
  }

  async restore(componentId) {
    await this.add(componentId);
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

    if (saved && Array.isArray(saved.active)) {
      this._state.active  = saved.active;
      this._state.removed = Array.isArray(saved.removed) ? saved.removed : [];
    } else {
      this._state.active  = defaults.map(c => typeof c === 'string' ? { id: c, position: 'auto' } : c);
      this._state.removed = [];
    }

    for (const c of this._state.active) {
      await this._mount(c.id, c.position ?? 'auto');
    }
    this.bus.emit('layout:changed', this.snapshot());
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

  has(componentId) {
    return this._panels.has(componentId);
  }

  list() {
    return this._state.active.map(item => item.id);
  }

  listRecentlyRemoved() {
    return [...this._state.removed];
  }

  listAvailable(catalog) {
    const active = new Set(this.list());
    return catalog.filter(item => !active.has(item.id));
  }

  snapshot() {
    return {
      active: this.list(),
      removed: this.listRecentlyRemoved(),
    };
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
