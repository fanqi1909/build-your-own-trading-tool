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
    this.bus         = new EventBus();
    this.ws          = new WsClient(`ws://${location.host}`, this.bus);
    this.layout      = null;
    this.chat        = null;
    this.builder     = null;
    this.suggestions = null;
    this.catalog     = [];
    this.uiMode      = 'use';
    this._dragFromId = null;
  }

  async init() {
    this.layout = new LayoutManager(document.getElementById('layout-grid'), this.bus, { pluginId: 'okx' });

    this.chat = new ChatPanel(document.getElementById('chat-panel'), this.bus);
    this.chat.init();
    this._initChatOverlay();

    this.catalog = await this._loadCatalog();

    this.builder = new BuilderPanel(document.getElementById('builder-panel'), this.layout, this.catalog, () => this._setUiMode('use'));
    await this.builder.init();
    this._initBuildButton();

    this.ws.connect();
    this.bus.on('ws:open',  () => this._setStatus(true));
    this.bus.on('ws:close', () => this._setStatus(false));

    await this.layout.restoreFromStorage([]);
    this._applyPanelSizes();

    this.suggestions = new SuggestionEngine(this.bus, this.layout, this.catalog);
    this.suggestions.init();

    this.bus.on('layout:changed', () => {
      this.builder.render();
      this._renderTabsBar();
      this._applyPanelSizes();
      this._renderLayoutDecorations();
    });
    this.bus.on('layout:tab-changed', () => {
      this.builder.render();
      this._renderTabsBar();
      this._applyPanelSizes();
      this._renderLayoutDecorations();
    });

    const savedMode = localStorage.getItem(UI_MODE_KEY) || 'use';
    this._setUiMode(savedMode, { skipSave: true });
    this._renderTabsBar();

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
    this.uiMode = mode;
    document.body.dataset.uiMode = mode;

    const builderPanel = document.getElementById('builder-panel');
    if (builderPanel) builderPanel.hidden = mode !== 'build';

    this._renderLayoutDecorations();
    this.bus.emit('ui:mode-changed', { mode });
    if (!skipSave) localStorage.setItem(UI_MODE_KEY, mode);
  }

  _initBuildButton() {
    const btn = document.getElementById('build-btn');
    if (!btn) return;
    btn.addEventListener('click', () => this._setUiMode(this.uiMode === 'build' ? 'use' : 'build'));
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

  _renderTabsBar() {
    const el = document.getElementById('tabs-bar');
    if (!el) return;
    const tabs = this.layout.listTabs();
    const activeTabId = this.layout.getActiveTabId();

    el.innerHTML = `
      <div class="tabs">
        ${tabs.map(tab => `
          <div class="tabs__item ${tab.id === activeTabId ? 'is-active' : ''}" data-tab-id="${tab.id}">
            <button class="tabs__switch" data-tab-id="${tab.id}">${tab.title}</button>
            <button class="tabs__rename" data-tab-id="${tab.id}" title="Rename">✎</button>
            ${tabs.length > 1 ? `<button class="tabs__remove" data-tab-id="${tab.id}" title="Remove">×</button>` : ''}
          </div>
        `).join('')}
        <button class="tabs__add" id="tab-add-btn">＋ New Tab</button>
      </div>
    `;

    el.querySelectorAll('.tabs__switch').forEach(btn => btn.addEventListener('click', () => this.layout.switchTab(btn.dataset.tabId)));
    el.querySelectorAll('.tabs__rename').forEach(btn => btn.addEventListener('click', () => {
      const tab = tabs.find(t => t.id === btn.dataset.tabId);
      const title = prompt('Rename tab', tab?.title || '');
      if (title) this.layout.renameTab(btn.dataset.tabId, title);
    }));
    el.querySelectorAll('.tabs__remove').forEach(btn => btn.addEventListener('click', () => {
      if (confirm('Delete this tab?')) this.layout.removeTab(btn.dataset.tabId);
    }));
    el.querySelector('#tab-add-btn')?.addEventListener('click', async () => {
      await this.layout.addTab(`Tab ${tabs.length + 1}`);
    });
  }

  _applyPanelSizes() {
    const grid = document.getElementById('layout-grid');
    if (!grid) return;
    const activeLayout = this.layout.getActiveTab().layout.active;
    for (const item of activeLayout) {
      const panel = grid.querySelector(`.panel--${item.id}`);
      if (!panel) continue;
      const catalogItem = this.catalog.find(c => c.id === item.id);
      const size = item.size || catalogItem?.defaultSize || 'tile';
      panel.dataset.size = size;
    }
  }

  _renderLayoutDecorations() {
    const grid = document.getElementById('layout-grid');
    if (!grid) return;

    grid.querySelectorAll('.panel__remove-btn, .panel__drag-handle, .panel__size-btn, .panel--add-widget').forEach(el => el.remove());
    grid.classList.toggle('layout-grid--build', this.uiMode === 'build');

    // Reset drag state on all panels
    grid.querySelectorAll('.panel').forEach(p => {
      p.removeAttribute('draggable');
      p.classList.remove('panel--dragging', 'panel--drop-target');
    });

    if (this.uiMode !== 'build') return;

    for (const id of this.layout.list()) {
      const panel = grid.querySelector(`.panel--${id}`);
      if (!panel) continue;

      // Remove button
      const btn = document.createElement('button');
      btn.className = 'panel__remove-btn';
      btn.textContent = '−';
      btn.title = `Remove ${id}`;
      btn.addEventListener('click', () => this.layout.remove(id));
      panel.appendChild(btn);

      // Size toggle button
      const SIZE_CYCLE = ['tile', 'half', 'full'];
      const SIZE_LABEL = { tile: '⊡ Tile', half: '◫ Half', full: '⊞ Full' };
      const catalogItem = this.catalog.find(c => c.id === id);
      const activeItem = this.layout.getActiveTab().layout.active.find(i => i.id === id);
      const currentSize = activeItem?.size || catalogItem?.defaultSize || 'tile';
      const sizeBtn = document.createElement('button');
      sizeBtn.className = 'panel__size-btn';
      sizeBtn.textContent = SIZE_LABEL[currentSize] || '⊡ Tile';
      sizeBtn.title = 'Cycle panel size';
      sizeBtn.addEventListener('click', () => {
        const idx = SIZE_CYCLE.indexOf(currentSize);
        const next = SIZE_CYCLE[(idx + 1) % SIZE_CYCLE.length];
        this.layout.setItemSize(id, next);
      });
      panel.appendChild(sizeBtn);

      // Drag handle
      const handle = document.createElement('div');
      handle.className = 'panel__drag-handle';
      handle.title = 'Drag to reorder';
      handle.textContent = '⠿';
      panel.appendChild(handle);

      // Make panel draggable via handle
      handle.addEventListener('mousedown', () => { panel.draggable = true; });
      panel.addEventListener('dragend', () => { panel.draggable = false; });

      panel.addEventListener('dragstart', (e) => {
        this._dragFromId = id;
        panel.classList.add('panel--dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      panel.addEventListener('dragend', () => {
        this._dragFromId = null;
        panel.classList.remove('panel--dragging');
        grid.querySelectorAll('.panel--drop-target').forEach(p => p.classList.remove('panel--drop-target'));
      });

      panel.addEventListener('dragover', (e) => {
        if (!this._dragFromId || this._dragFromId === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        grid.querySelectorAll('.panel--drop-target').forEach(p => p.classList.remove('panel--drop-target'));
        panel.classList.add('panel--drop-target');
      });

      panel.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!this._dragFromId || this._dragFromId === id) return;
        this.layout.reorder(this._dragFromId, id);
        this._dragFromId = null;
        grid.querySelectorAll('.panel--drop-target').forEach(p => p.classList.remove('panel--drop-target'));
      });
    }

    const add = document.createElement('button');
    add.className = 'panel panel--add-widget';
    add.innerHTML = '<div class="panel__add-widget">＋ Add widget</div>';
    add.addEventListener('click', () => {
      this._setUiMode('build');
      document.getElementById('builder-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
