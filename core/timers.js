'use strict';
/**
 * core/timers.js — Named interval registry
 * Allows plugins to register, stop, and replace named timers.
 */

class TimerRegistry {
  constructor() {
    this._timers = new Map(); // name → intervalId
  }

  /** Register (or replace) a named interval. */
  register(name, fn, intervalMs) {
    this.stop(name);
    const id = setInterval(fn, intervalMs);
    this._timers.set(name, id);
    return id;
  }

  /** Stop a named interval. No-op if not found. */
  stop(name) {
    const id = this._timers.get(name);
    if (id !== undefined) {
      clearInterval(id);
      this._timers.delete(name);
    }
  }

  /** Stop all registered intervals. */
  stopAll() {
    for (const name of [...this._timers.keys()]) {
      this.stop(name);
    }
  }

  /** List active timer names. */
  list() {
    return [...this._timers.keys()];
  }
}

module.exports = { TimerRegistry };
