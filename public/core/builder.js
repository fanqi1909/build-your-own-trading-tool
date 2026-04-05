/**
 * public/core/builder.js — Dashboard builder panel
 */
import { groupBuilderSections } from './suggestions.js';

const PRESETS = [
  { id: 'watch',   icon: '👁', label: 'Watch Market',  desc: 'Price ticker + candlestick chart', components: ['ticker', 'chart'] },
  { id: 'analyze', icon: '📊', label: 'Analyze',       desc: 'Chart + indicators + AI assessment', components: ['ticker', 'chart', 'analysis', 'claude-insights'] },
  { id: 'trade',   icon: '⚡', label: 'Trade',         desc: 'Trading setup with orders and positions', components: ['ticker', 'chart', 'order-panel', 'positions', 'open-orders'] },
  { id: 'full',    icon: '🔲', label: 'Full Dashboard',desc: 'Everything enabled', components: ['ticker', 'balance', 'chart', 'analysis', 'order-panel', 'positions', 'open-orders', 'position-track', 'claude-insights', 'history', 'trade-review'] },
];

export class BuilderPanel {
  constructor(overlayEl, layout, catalog, onDone) {
    this.el      = overlayEl;
    this.layout  = layout;
    this.catalog = catalog;
    this.onDone  = onDone;
  }

  async init() {
    this.render();
  }

  setCatalog(catalog) {
    this.catalog = catalog;
    this.render();
  }

  show() {
    this.el.hidden = false;
    this.render();
  }

  hide() {
    this.el.hidden = true;
  }

  render() {
    const panel = this.el.querySelector('#builder-panel');
    if (!panel) return;

    const { recommended, active, available } = groupBuilderSections(
      this.catalog,
      this.layout.list(),
      this.layout.listRecentlyRemoved()
    );

    panel.innerHTML = `
      <div class="builder__header">
        <div class="builder__title">Build Your Dashboard</div>
        <button class="builder__done" id="builder-done">Done →</button>
      </div>

      <div class="builder__section">
        <div class="builder__section-title">Recommended</div>
        <div class="builder__components builder__components--recommended">
          ${recommended.map(item => this._card(item, 'add')).join('') || '<div class="builder__empty">Everything recommended is already on your home screen.</div>'}
        </div>
      </div>

      <div class="builder__section">
        <div class="builder__section-title">On Your Home Screen</div>
        <div class="builder__components">
          ${active.map(item => this._card(item, 'remove')).join('') || '<div class="builder__empty">No cards yet. Start from a recommendation or template.</div>'}
        </div>
      </div>

      <div class="builder__section">
        <div class="builder__section-title">Templates</div>
        <div class="builder__presets">
          ${PRESETS.map(p => `
            <div class="builder__preset" data-preset="${p.id}">
              <div class="builder__preset-icon">${p.icon}</div>
              <div class="builder__preset-label">${p.label}</div>
              <div class="builder__preset-desc">${p.desc}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="builder__section">
        <div class="builder__section-title">Available Cards</div>
        <div class="builder__components">
          ${available.map(item => this._card(item, 'add')).join('')}
        </div>
      </div>
    `;

    panel.querySelector('#builder-done')?.addEventListener('click', () => this.onDone());
    panel.querySelectorAll('.builder__preset').forEach(el => el.addEventListener('click', () => this._applyPreset(el.dataset.preset)));
    panel.querySelectorAll('.builder__component-action').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.dataset.component;
        const action = el.dataset.action;
        if (action === 'add') this.layout.restore(id).then(() => this.render());
        if (action === 'remove') { this.layout.remove(id); this.render(); }
      });
    });
  }

  _card(item, action) {
    return `
      <div class="builder__component ${action === 'remove' ? 'is-active' : ''}" data-component="${item.id}">
        <div class="builder__component-icon">${item.icon}</div>
        <div class="builder__component-info">
          <div class="builder__component-label">${item.title}</div>
          <div class="builder__component-desc">${item.description}</div>
        </div>
        <button class="builder__component-action builder__component-action--${action}" data-component="${item.id}" data-action="${action}">${action === 'add' ? 'Add' : 'Remove'}</button>
      </div>
    `;
  }

  async _applyPreset(presetId) {
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    for (const id of this.layout.list()) {
      if (!preset.components.includes(id)) this.layout.remove(id);
    }
    for (const id of preset.components) {
      if (!this.layout.has(id)) await this.layout.restore(id);
    }
    this.render();
  }
}
