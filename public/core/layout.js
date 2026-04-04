/**
 * public/core/layout.js — Layout manager
 *
 * Manages which components are on screen.
 * Components are dynamically imported from the plugin directory.
 *
 * Storage is injectable (defaults to localStorage) to allow unit testing.
 */
import { Component } from './component.js';

const STORAGE_KEY = 'layout';

export class LayoutManager {
  /**
   * @param {HTMLElement} containerEl  — grid container
   * @param {EventBus}    bus
   * @param {object}      opts
   * @param {string}      opts.pluginId   — e.g. 'okx'
   * @param {Storage}     opts.storage    — localStorage-compatible (injectable for tests)
   */
  constructor(containerEl, bus, { pluginId = 'okx', storage = null } = {}) {
    this.container  = containerEl;
    this.bus        = bus;
    this._pluginId  = pluginId;
    this._storage   = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this._panels    = new Map();  // componentId → { component, el }
    this._layout    = [];         // [{ id, position }]
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Add a component by ID. No-op if already present. */
  async add(componentId, position = 'auto') {
    if (this._panels.has(componentId)) return;

    // Create DOM container
    const el = document.createElement('div');
    el.dataset.component = componentId;
    el.classList.add('panel', `panel--${componentId}`);
    this.container.appendChild(el);

    // Dynamically import the component module from the plugin
    let ComponentClass = await this._importComponent(componentId);

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
    this._layout.push({ id: componentId, position });
    this.save();

    this.bus.emit('layout:added', { id: componentId });
  }

  /** Remove a component by ID. No-op if not present. */
  remove(componentId) {
    const entry = this._panels.get(componentId);
    if (!entry) return;

    entry.component.destroy();
    entry.el.remove();
    this._panels.delete(componentId);
    this._layout = this._layout.filter(l => l.id !== componentId);
    this.save();

    this.bus.emit('layout:removed', { id: componentId });
  }

  /** Persist current layout to storage. */
  save() {
    if (this._storage) {
      this._storage.setItem(STORAGE_KEY, JSON.stringify(this._layout));
    }
  }

  /**
   * Restore layout from storage, or fall back to defaults.
   * @param {string[]|{id,position}[]} defaults
   */
  async restore(defaults = []) {
    let saved = null;
    if (this._storage) {
      try { saved = JSON.parse(this._storage.getItem(STORAGE_KEY)); } catch {}
    }
    const components = (saved && saved.length > 0) ? saved : defaults;
    for (const c of components) {
      const id  = typeof c === 'string' ? c : c.id;
      const pos = typeof c === 'string' ? 'auto' : (c.position ?? 'auto');
      await this.add(id, pos);
    }
  }

  /** Check if a component is currently in the layout. */
  has(componentId) {
    return this._panels.has(componentId);
  }

  /** List IDs of all active components. */
  list() {
    return [...this._panels.keys()];
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  async _importComponent(componentId) {
    try {
      const mod = await import(`/plugins/${this._pluginId}/components/${componentId}/${componentId}.js`);
      return mod.default;
    } catch {
      // Fallback: generic placeholder for unknown components
      return class Placeholder extends Component {
        static id = componentId;
        async init() {
          this.el.innerHTML = `<div class="panel__placeholder">${componentId}</div>`;
        }
      };
    }
  }
}
