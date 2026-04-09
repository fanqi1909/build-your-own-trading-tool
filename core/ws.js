'use strict';
/**
 * core/ws.js — WebSocket server wrapper
 * Handles connections, routes inbound actions to handlers,
 * and broadcasts bus events to all clients.
 */
const { WebSocketServer } = require('ws');

class WsServer {
  constructor(httpServer, bus, { verifyClient } = {}) {
    this.bus    = bus;
    const wssOpts = { server: httpServer };
    if (verifyClient) wssOpts.verifyClient = verifyClient;
    this._wss   = new WebSocketServer(wssOpts);
    this._handlers       = new Map(); // action → async fn(params, ws)
    this._connectHandlers = [];       // called with ws on each new connection

    // Anything emitted as 'broadcast' on the bus goes to all clients
    bus.on('broadcast', (msg) => this.broadcast(msg));

    this._wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'connected' }));
      this._connectHandlers.forEach(fn => { try { fn(ws); } catch {} });

      ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        const handler = this._handlers.get(msg.action);
        if (!handler) return;

        try {
          const result = await handler(msg, ws);
          if (result) ws.send(JSON.stringify(result));
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', error: e.message }));
        }
      });

      ws.on('close', () => {});
      ws.on('error', () => {});
    });
  }

  /** Register a named action handler (from plugin). */
  registerAction(action, handler) {
    this._handlers.set(action, handler);
  }

  /** Register a handler called with the ws socket on each new client connection. */
  registerConnect(handler) {
    this._connectHandlers.push(handler);
  }

  /** Broadcast a message to all connected clients. */
  broadcast(msg) {
    const str = JSON.stringify(msg);
    this._wss.clients.forEach(ws => {
      if (ws.readyState === 1) ws.send(str);
    });
  }

  get clientCount() {
    return this._wss.clients.size;
  }

  close() {
    // Terminate all clients first so wss.close() doesn't hang waiting for them
    this._wss.clients.forEach(ws => ws.terminate());
    return new Promise(resolve => this._wss.close(resolve));
  }
}

module.exports = { WsServer };
