/**
 * public/core/ws.js — WebSocket client wrapper
 *
 * - Connects to server, auto-reconnects on close
 * - Dispatches received messages to the event bus by message type
 * - Routes bus 'ws:send' events to the server
 */
export class WsClient {
  constructor(url, bus) {
    this.url  = url;
    this.bus  = bus;
    this._ws  = null;
    this._reconnectTimer = null;
    this._connected = false;

    // Route outbound messages from bus → server
    this.bus.on('ws:send', (data) => this.send(data));
  }

  connect() {
    clearTimeout(this._reconnectTimer);
    this._ws = new WebSocket(this.url);

    this._ws.onopen = () => {
      this._connected = true;
      this.bus.emit('ws:open');
    };

    this._ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      // Dispatch by message type (e.g. 'ticker', 'snapshot', ...)
      if (msg.type) this.bus.emit(msg.type, msg);
      // Also emit a catch-all for logging/debugging
      this.bus.emit('ws:message', msg);
    };

    this._ws.onclose = () => {
      this._connected = false;
      this.bus.emit('ws:close');
      this._reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this._ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }

  send(data) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    clearTimeout(this._reconnectTimer);
    this._ws?.close();
  }

  get connected() { return this._connected; }
}
