'use strict';
/**
 * core/bus.js — Server-side event bus
 * Domain-agnostic pub/sub built on EventEmitter.
 */
const { EventEmitter } = require('events');

class ServerBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
}

module.exports = { ServerBus };
