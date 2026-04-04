/**
 * public/core/component.js — Base component class
 *
 * All UI components extend this class.
 * Provides:
 *  - Scoped event bus subscriptions (auto-cleaned up on destroy)
 *  - Convenience send() for dispatching actions to server
 *  - Lifecycle hooks: init(), update(), destroy()
 */
export class Component {
  /** @type {string} Unique component ID — must match manifest capability component field */
  static id = '';

  /**
   * @param {HTMLElement} container — DOM element to render into
   * @param {EventBus}    bus       — client-side event bus
   * @param {object}      config    — optional component-specific config
   */
  constructor(container, bus, config = {}) {
    this.el     = container;
    this.bus    = bus;
    this.config = config;
    this._subscriptions = []; // { event, handler }
  }

  /**
   * Subscribe to a bus event.
   * Handler is auto-removed when destroy() is called.
   */
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

  /**
   * Send an action to the server via the bus.
   * Equivalent to: ws.send({ action, ...data })
   */
  send(action, data = {}) {
    this.bus.emit('ws:send', { action, ...data });
  }

  /** Called once when the component is added to the layout. Override to render. */
  async init() {}

  /** Called when new data arrives. Override to update DOM. */
  update(data) {}

  /** Remove all subscriptions and clear the container. */
  destroy() {
    for (const { event, handler } of this._subscriptions) {
      this.bus.off(event, handler);
    }
    this._subscriptions = [];
    this.el.innerHTML = '';
  }
}
