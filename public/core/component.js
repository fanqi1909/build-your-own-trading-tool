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
