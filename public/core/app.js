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
    this.ws          = new WsClient(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`, this.bus);
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

    this.builder = new BuilderPanel(
      document.getElementById('build-topbar'),
      document.getElementById('build-left'),
      this.layout, this.catalog,
      () => this._setUiMode('use')
    );
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

    const topbar = document.getElementById('build-topbar');
    const left   = document.getElementById('build-left');
    if (topbar) topbar.hidden = mode !== 'build';
    if (left)   left.hidden   = mode !== 'build';

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
    // v5: slot spans are managed directly by layout.js; nothing to sync here.
  }

  /** Find the closest real panel to (x, y), excluding excludeId and add-widget. */
  _nearestPanel(grid, x, y, excludeId) {
    let nearest = null, minDist = Infinity;
    for (const p of grid.querySelectorAll('.panel:not(.panel--add-widget)')) {
      if (p.dataset.component === excludeId) continue;
      const r = p.getBoundingClientRect();
      const dist = Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2);
      if (dist < minDist) { minDist = dist; nearest = p; }
    }
    return nearest;
  }

  _renderLayoutDecorations() {
    const grid = document.getElementById('layout-grid');
    if (!grid) return;

    // Remove all build-mode decorations
    grid.querySelectorAll(
      '.panel__remove-btn, .panel__drag-handle, .slot__size-btn, .slot__stack-btn, .panel--add-widget'
    ).forEach(el => el.remove());
    grid.querySelectorAll('.layout-slot').forEach(s => s.classList.remove('slot--stack-target'));
    grid.classList.toggle('layout-grid--build', this.uiMode === 'build');
    grid.querySelectorAll('.panel').forEach(p => {
      p.removeAttribute('draggable');
      p.classList.remove('panel--dragging', 'panel--drop-target');
    });

    // Remove stale grid-level drag handlers
    if (grid._dragHandlers) {
      grid.removeEventListener('dragover', grid._dragHandlers.over);
      grid.removeEventListener('drop',     grid._dragHandlers.drop);
      delete grid._dragHandlers;
    }

    if (this.uiMode !== 'build') return;

    const SPAN_LABEL = { 1: '⊡ Tile', 2: '◫ Half', 3: '⊞ Full' };

    // ── Per-slot decorations (size button + stack button) ──────────────────
    for (const row of this.layout.getRows()) {
      for (const col of row.cols) {
        const colId  = col.id;
        const slotEl = grid.querySelector(`.layout-slot[data-col-id="${colId}"]`);
        if (!slotEl) continue;

        // Size toggle — resizes the slot
        const curSpan = parseInt(slotEl.dataset.span || '1');
        const sizeBtn = document.createElement('button');
        sizeBtn.className   = 'slot__size-btn';
        sizeBtn.textContent = SPAN_LABEL[curSpan] || '⊡ Tile';
        sizeBtn.title       = 'Cycle slot width';
        sizeBtn.addEventListener('click', () => {
          const cur   = parseInt(slotEl.dataset.span || '1');
          const avail = this.layout.availableSpans(colId);
          const next  = avail[(avail.indexOf(cur) + 1) % avail.length];
          this.layout.setColSpan(colId, next);
          sizeBtn.textContent = SPAN_LABEL[next] || '⊡ Tile';
        });
        slotEl.appendChild(sizeBtn);

        // Stack button — signals builder to add into this slot
        const stackBtn = document.createElement('button');
        stackBtn.className   = 'slot__stack-btn';
        stackBtn.textContent = '＋';
        stackBtn.title       = 'Stack a component into this slot';
        stackBtn.addEventListener('click', () => {
          this.builder.setStackTarget(colId);
          this._setUiMode('build');
          document.getElementById('build-left')?.scrollTo({ top: 0, behavior: 'smooth' });
          grid.querySelectorAll('.layout-slot').forEach(s => s.classList.remove('slot--stack-target'));
          slotEl.classList.add('slot--stack-target');
        });
        slotEl.appendChild(stackBtn);
      }
    }

    // ── Per-panel decorations (remove + drag handle) ───────────────────────
    for (const id of this.layout.list()) {
      const panel = grid.querySelector(`.panel--${id}`);
      if (!panel) continue;

      const btn = document.createElement('button');
      btn.className = 'panel__remove-btn';
      btn.textContent = '−';
      btn.title = `Remove ${id}`;
      btn.addEventListener('click', () => this.layout.remove(id));
      panel.appendChild(btn);

      const handle = document.createElement('div');
      handle.className = 'panel__drag-handle';
      handle.title = 'Drag to reorder';
      handle.textContent = '⠿';
      panel.appendChild(handle);

      handle.addEventListener('mousedown', () => { panel.draggable = true; });
      panel.addEventListener('dragend', () => {
        panel.draggable = false;
        this._dragFromId = null;
        panel.classList.remove('panel--dragging');
        grid.querySelectorAll('.panel--drop-target').forEach(p => p.classList.remove('panel--drop-target'));
      });
      panel.addEventListener('dragstart', (e) => {
        this._dragFromId = id;
        panel.classList.add('panel--dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      panel.addEventListener('dragover', (e) => {
        if (!this._dragFromId || this._dragFromId === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        grid.querySelectorAll('.panel--drop-target, .panel--stack-target').forEach(p => {
          p.classList.remove('panel--drop-target', 'panel--stack-target');
        });
        const r = panel.getBoundingClientRect();
        const isBottom = e.clientY > r.top + r.height * 0.6;
        panel.classList.add(isBottom ? 'panel--stack-target' : 'panel--drop-target');
      });
      panel.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!this._dragFromId || this._dragFromId === id) return;
        const fromId = this._dragFromId;
        this._dragFromId = null;
        const r = panel.getBoundingClientRect();
        const isBottom = e.clientY > r.top + r.height * 0.6;
        grid.querySelectorAll('.panel--drop-target, .panel--stack-target').forEach(p => {
          p.classList.remove('panel--drop-target', 'panel--stack-target');
        });
        if (isBottom) {
          const colId = this.layout.getColId(id);
          if (colId) this.layout.stackInto(fromId, colId);
        } else {
          this.layout.reorder(fromId, id);
        }
      });
    }

    // ── Grid-level drop (empty space → nearest panel) ──────────────────────
    const onGridDragOver = (e) => {
      if (!this._dragFromId) return;
      if (e.target.closest?.('.panel:not(.panel--add-widget)')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const nearest = this._nearestPanel(grid, e.clientX, e.clientY, this._dragFromId);
      grid.querySelectorAll('.panel--drop-target').forEach(p => p.classList.remove('panel--drop-target'));
      if (nearest) nearest.classList.add('panel--drop-target');
    };
    const onGridDrop = (e) => {
      if (!this._dragFromId) return;
      if (e.target.closest?.('.panel:not(.panel--add-widget)')) return;
      e.preventDefault();
      const fromId = this._dragFromId;
      this._dragFromId = null;
      grid.querySelectorAll('.panel--drop-target').forEach(p => p.classList.remove('panel--drop-target'));
      const nearest = this._nearestPanel(grid, e.clientX, e.clientY, fromId);
      if (nearest?.dataset.component) this.layout.reorder(fromId, nearest.dataset.component);
    };
    grid.addEventListener('dragover', onGridDragOver);
    grid.addEventListener('drop',     onGridDrop);
    grid._dragHandlers = { over: onGridDragOver, drop: onGridDrop };

    // ── Add widget placeholder ─────────────────────────────────────────────
    const addRow = document.createElement('div');
    addRow.className = 'layout-row';
    const add = document.createElement('button');
    add.className = 'panel panel--add-widget';
    add.style.gridColumn = '1 / -1';
    add.innerHTML = '<div class="panel__add-widget">＋ Add widget</div>';
    add.addEventListener('click', () => {
      this._setUiMode('build');
      document.getElementById('build-left')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    addRow.appendChild(add);
    grid.appendChild(addRow);
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
