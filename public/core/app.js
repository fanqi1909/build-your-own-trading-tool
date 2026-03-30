/**
 * public/core/app.js — Client bootstrap
 *
 * Creates the bus, WebSocket client, and layout manager.
 * Exposes `window.app` for console debugging.
 */
import { EventBus }        from './bus.js';
import { WsClient }        from './ws.js';
import { LayoutManager }   from './layout.js';
import { ChatPanel }       from './chat.js';
import { SuggestionEngine } from './suggestions.js';

class App {
  constructor() {
    this.bus    = new EventBus();
    this.ws     = new WsClient(`ws://${location.host}`, this.bus);
    this.layout = null;
    this.chat   = null;
  }

  async init() {
    const layoutGrid = document.getElementById('layout-grid');
    this.layout = new LayoutManager(layoutGrid, this.bus, { pluginId: 'okx' });

    const chatPanel = document.getElementById('chat-panel');
    this.chat = new ChatPanel(chatPanel, this.bus);
    this.chat.init();

    // Connect to server
    this.ws.connect();

    // Status indicator
    this.bus.on('ws:open',  () => this._setStatus(true));
    this.bus.on('ws:close', () => this._setStatus(false));

    // Restore saved layout (empty by default for new users — AI will build it)
    await this.layout.restore([]);

    // Start suggestion engine after layout is restored
    this.suggestions = new SuggestionEngine(this.bus, this.layout);
    this.suggestions.init();

    // Expose globally for console debugging and AI assistant access
    window.app = this;
  }

  _setStatus(connected) {
    const el = document.getElementById('status');
    if (!el) return;
    el.dataset.connected = connected;
    el.title = connected ? 'Connected' : 'Disconnected — reconnecting…';
  }
}

const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
