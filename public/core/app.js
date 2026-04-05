/**
 * public/core/app.js — Client bootstrap
 */
import { EventBus }         from './bus.js';
import { WsClient }         from './ws.js';
import { LayoutManager }    from './layout.js';
import { ChatPanel }        from './chat.js';
import { SuggestionEngine } from './suggestions.js';
import { BuilderPanel }     from './builder.js';
import { normalizeCatalog } from './catalog.js';

const UI_MODE_KEY = 'uiMode';

class App {
  constructor() {
    this.bus     = new EventBus();
    this.ws      = new WsClient(`ws://${location.host}`, this.bus);
    this.layout  = null;
    this.chat    = null;
    this.builder = null;
    this.suggestions = null;
    this.catalog = [];
  }

  async init() {
    this.layout = new LayoutManager(document.getElementById('layout-grid'), this.bus, { pluginId: 'okx' });

    this.chat = new ChatPanel(document.getElementById('chat-panel'), this.bus);
    this.chat.init();
    this._initChatOverlay();

    this.catalog = await this._loadCatalog();

    this.builder = new BuilderPanel(document.getElementById('builder-overlay'), this.layout, this.catalog, () => this._setUiMode('use'));
    await this.builder.init();
    this._initBuildButton();

    this.ws.connect();
    this.bus.on('ws:open',  () => this._setStatus(true));
    this.bus.on('ws:close', () => this._setStatus(false));

    await this.layout.restoreFromStorage([]);

    this.suggestions = new SuggestionEngine(this.bus, this.layout, this.catalog);
    this.suggestions.init();

    this._renderUseControls();
    this.bus.on('layout:changed', () => {
      this.builder.render();
      this._renderUseControls();
    });

    const savedMode = localStorage.getItem(UI_MODE_KEY) || 'use';
    this._setUiMode(savedMode, { skipSave: true });

    window.app = this;
  }

  async _loadCatalog() {
    try {
      const res = await fetch('/api/manifest');
      const manifest = await res.json();
      return normalizeCatalog(manifest);
    } catch (e) {
      console.error('[app] failed to load manifest:', e);
      return [];
    }
  }

  _setUiMode(mode, { skipSave = false } = {}) {
    if (mode === 'build') this.builder.show();
    else this.builder.hide();
    if (!skipSave) localStorage.setItem(UI_MODE_KEY, mode);
  }

  _initBuildButton() {
    const btn = document.getElementById('build-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this._setUiMode('build'));
  }

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

    trigger.addEventListener('click', () => panel.classList.contains('is-open') ? close() : open());
    backdrop.addEventListener('click', () => close());
  }

  _renderUseControls() {
    const grid = document.getElementById('layout-grid');
    if (!grid) return;

    grid.querySelectorAll('.panel__remove-btn, .panel--add-widget').forEach(el => el.remove());

    for (const id of this.layout.list()) {
      const panel = grid.querySelector(`.panel--${id}`);
      if (!panel) continue;
      const btn = document.createElement('button');
      btn.className = 'panel__remove-btn';
      btn.textContent = '−';
      btn.title = `Remove ${id}`;
      btn.addEventListener('click', () => this.layout.remove(id));
      panel.appendChild(btn);
    }

    const add = document.createElement('button');
    add.className = 'panel panel--add-widget';
    add.innerHTML = '<div class="panel__add-widget">＋ Add widget</div>';
    add.addEventListener('click', () => this._setUiMode('build'));
    grid.appendChild(add);
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
