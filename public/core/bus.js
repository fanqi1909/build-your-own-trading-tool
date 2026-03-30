/**
 * public/core/bus.js — Client-side event bus
 * Lightweight pub/sub for decoupling components from each other and from WebSocket.
 */
export class EventBus {
  constructor() {
    this._listeners = new Map(); // event → [handler]
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
  }

  off(event, handler) {
    const handlers = this._listeners.get(event);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  emit(event, data) {
    const handlers = this._listeners.get(event) || [];
    // Slice to avoid mutation issues if a handler calls off()
    for (const h of handlers.slice()) h(data);
  }

  /** Remove all listeners for an event (useful for cleanup). */
  clear(event) {
    this._listeners.delete(event);
  }
}
