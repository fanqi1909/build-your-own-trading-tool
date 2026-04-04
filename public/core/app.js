/**
 * public/core/app.js — Client bootstrap
 *
 * Modes:
 *   use   — dashboard view; chat is a floating overlay
 *   build — fullscreen builder panel
 *
 * Owns:
 *   - EventBus, WsClient, LayoutManager
 *   - ChatPanel (content) + chat overlay toggle
 *   - BuilderPanel + mode switching
 *   - SuggestionEngine
 */
import { EventBus }         from './bus.js';
import { WsClient }         from './ws.js';
import { LayoutManager }    from './layout.js';
import { ChatPanel }        from './chat.js';
import { SuggestionEngine } from './suggestions.js';
import { BuilderPanel }     from './builder.js';

const UI_MODE_KEY = 'uiMode';

class App {
  constructor() {
    this.bus     = new EventBus();
    this.ws      = new WsClient(`ws://${location.host}`, this.bus);
    this.layout  = null;
    this.chat    = null;
    this.builder = null;
    this.suggestions = null;
  }

  async init() {
    // ── Layout ──────────────────────────────────────────────────────────────
    this.layout = new LayoutManager(
      document.getElementById('layout-grid'),
      this.bus,
      { pluginId: 'okx' }
    );

    // ── Chat panel ──────────────────────────────────────────────────────────
    this.chat = new ChatPanel(document.getElementById('chat-panel'), this.bus);
    this.chat.init();
    this._initChatOverlay();

    // ── Builder panel ────────────────────────────────────────────────────────
    this.builder = new BuilderPanel(
      document.getElementById('builder-overlay'),
      this.layout,
      () => this._setUiMode('use')
    );
    await this.builder.init();
    this._initBuildButton();

    // ── WebSocket ────────────────────────────────────────────────────────────
    this.ws.connect();
    this.bus.on('ws:open',  () => this._setStatus(true));
    this.bus.on('ws:close', () => this._setStatus(false));

    // ── Restore layout ───────────────────────────────────────────────────────
    await this.layout.restore([]);

    // ── Suggestions ──────────────────────────────────────────────────────────
    this.suggestions = new SuggestionEngine(this.bus, this.layout);
    this.suggestions.init();

    // ── Restore UI mode ──────────────────────────────────────────────────────
    const savedMode = localStorage.getItem(UI_MODE_KEY) || 'use';
    this._setUiMode(savedMode, { skipSave: true });

    // Expose for console debugging
    window.app = this;
  }

  // ── UI mode ───────────────────────────────────────────────────────────────

  _setUiMode(mode, { skipSave = false } = {}) {
    if (mode === 'build') {
      this.builder.show();
    } else {
      this.builder.hide();
    }
    if (!skipSave) localStorage.setItem(UI_MODE_KEY, mode);
  }

  // ── Build button ──────────────────────────────────────────────────────────

  _initBuildButton() {
    const btn = document.getElementById('build-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this._setUiMode('build'));
  }

  // ── Chat overlay toggle ───────────────────────────────────────────────────

  _initChatOverlay() {
    const trigger  = document.getElementById('chat-trigger');
    const panel    = document.getElementById('chat-panel');
    const backdrop = document.getElementById('chat-backdrop');
    if (!trigger || !panel || !backdrop) return;

    const open = () => {
      panel.classList.add('is-open');
      backdrop.classList.add('is-visible');
      trigger.classList.add('is-open');
      trigger.textContent = '✕';
    };
    const close = () => {
      panel.classList.remove('is-open');
      backdrop.classList.remove('is-visible');
      trigger.classList.remove('is-open');
      trigger.textContent = '✦';
    };

    trigger.addEventListener('click',   () => panel.classList.contains('is-open') ? close() : open());
    backdrop.addEventListener('click',  () => close());
  }

  // ── Status dot ────────────────────────────────────────────────────────────

  _setStatus(connected) {
    const el = document.getElementById('status');
    if (!el) return;
    el.dataset.connected = connected;
    el.title = connected ? 'Connected' : 'Disconnected — reconnecting…';
  }
}

const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
