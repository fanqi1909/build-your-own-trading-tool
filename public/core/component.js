/**
 * public/core/component.js — Base component class
 */
export class Component {
  static id = '';
  static inputs = [];
  static outputs = [];
  static defaultConfig = {};

  constructor(container, bus, config = {}) {
    this.el     = container;
    this.bus    = bus;
    this.config = { ...(this.constructor.defaultConfig || {}), ...(config || {}) };
    this._subscriptions = [];
    this._statusOverlay = null;
  }

  on(event, handler) {
    const safe = (data) => {
      try { handler(data); }
      catch (err) {
        console.error(`[${this.constructor.id || 'component'}] error in "${event}" handler:`, err);
      }
    };
    this.bus.on(event, safe);
    this._subscriptions.push({ event, handler: safe });
  }

  send(action, data = {}) {
    this.bus.emit('ws:send', { action, ...data });
  }

  getContext() {
    return window.app?.layout?.getContext?.() || {};
  }

  setContext(patch) {
    this.bus.emit('context:patch', {
      patch,
      sourceComponentId: this.constructor.id,
      tabId: window.app?.layout?.getActiveTabId?.(),
    });
  }

  onContextChange(handler) {
    this.on('context:changed', ({ context, tabId, changedKeys, sourceComponentId }) => {
      const activeTabId = window.app?.layout?.getActiveTabId?.();
      if (tabId && activeTabId && tabId !== activeTabId) return;
      handler({ context, tabId, changedKeys, sourceComponentId });
    });
  }

  /**
   * setStatus(state, message?)
   * state: 'loading' | 'ready' | 'error' | 'empty'
   * Shows an overlay on the panel; 'ready' removes it.
   */
  setStatus(state, msg = '') {
    if (state === 'ready') {
      if (this._statusOverlay) {
        this._statusOverlay.remove();
        this._statusOverlay = null;
      }
      return;
    }
    if (!this._statusOverlay) {
      this._statusOverlay = document.createElement('div');
      this._statusOverlay.className = 'component-status';
    }
    this._statusOverlay.dataset.state = state;
    this._statusOverlay.innerHTML = {
      loading: `<span class="component-status__spinner"></span><span class="component-status__msg">${msg || 'Loading…'}</span>`,
      error:   `<span class="component-status__icon">⚠</span><span class="component-status__msg">${msg || 'Error'}</span>`,
      empty:   `<span class="component-status__icon">—</span><span class="component-status__msg">${msg || 'No data'}</span>`,
    }[state] || '';
    this.el.appendChild(this._statusOverlay);
  }

  getConfig() {
    return this.config;
  }

  updateConfig(patch) {
    this.config = { ...this.config, ...patch };
    window.app?.layout?.updateItemConfig?.(this.constructor.id, patch);
  }

  async init() {}
  update(data) {}

  destroy() {
    for (const { event, handler } of this._subscriptions) {
      this.bus.off(event, handler);
    }
    this._subscriptions = [];
    this.el.innerHTML = '';
  }
}
