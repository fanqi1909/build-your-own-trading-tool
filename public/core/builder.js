/**
 * public/core/builder.js — Build mode UI (topbar + left panel)
 */
import { groupBuilderSections, getSuggestedTabs } from './suggestions.js';

const PRESETS = [
  { id: 'watch',   icon: '👁', label: 'Watch',   components: ['ticker', 'chart'] },
  { id: 'analyze', icon: '📊', label: 'Analyze',  components: ['ticker', 'chart', 'analysis', 'claude-insights'] },
  { id: 'trade',   icon: '⚡', label: 'Trade',    components: ['ticker', 'chart', 'order-panel', 'positions', 'open-orders'] },
  { id: 'full',    icon: '🔲', label: 'Full',     components: ['ticker', 'balance', 'chart', 'analysis', 'order-panel', 'positions', 'open-orders', 'position-track', 'claude-insights', 'history', 'trade-review'] },
];

export class BuilderPanel {
  constructor(topbarEl, leftEl, layout, catalog, onDone) {
    this.topbarEl = topbarEl;
    this.leftEl   = leftEl;
    this.layout   = layout;
    this.catalog  = catalog;
    this.onDone   = onDone;
  }

  async init() {
    this.render();
  }

  setCatalog(catalog) {
    this.catalog = catalog;
    this.render();
  }

  render() {
    this._renderTopbar();
    this._renderLeft();
  }

  _renderTopbar() {
    if (!this.topbarEl) return;
    const suggestedTabs = getSuggestedTabs(this.layout.listTabs());

    this.topbarEl.innerHTML = `
      <span class="btb__label">Presets</span>
      ${PRESETS.map(p => `
        <button class="btb__preset" data-preset="${p.id}">${p.icon} ${p.label}</button>
      `).join('')}
      <span class="btb__sep"></span>
      ${suggestedTabs.length ? `<button class="btb__new-tab" id="btb-new-tab">＋ New Tab</button>` : ''}
      <button class="btb__done" id="btb-done">Done ✓</button>
    `;

    this.topbarEl.querySelectorAll('.btb__preset[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => this._applyPreset(btn.dataset.preset));
    });

    this.topbarEl.querySelector('#btb-done')?.addEventListener('click', () => this.onDone());

    this.topbarEl.querySelector('#btb-new-tab')?.addEventListener('click', async () => {
      const suggested = suggestedTabs[0];
      if (suggested) {
        await this.layout.addTab(suggested.title, suggested.components);
        this.render();
      }
    });
  }

  _renderLeft() {
    if (!this.leftEl) return;
    const { active, available, removed } = groupBuilderSections(
      this.catalog,
      this.layout.list(),
      this.layout.listRecentlyRemoved()
    );

    this.leftEl.innerHTML = `
      <div class="bl__section-title">Active</div>
      ${active.length
        ? active.map(item => this._row(item, 'remove')).join('')
        : '<div class="builder__empty">Empty tab</div>'}

      <div class="bl__section-title" style="margin-top:8px">Add</div>
      ${available.length
        ? available.map(item => this._row(item, 'add')).join('')
        : '<div class="builder__empty">All added</div>'}

      ${removed.length ? `
        <div class="bl__section-title" style="margin-top:8px">Recently Removed</div>
        ${removed.map(item => this._row(item, 'restore')).join('')}
      ` : ''}
    `;

    this.leftEl.querySelectorAll('.bl__btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id     = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'remove') {
          this.layout.remove(id);
        } else {
          this.layout.restore(id).then(() => this.render());
        }
      });
    });
  }

  _row(item, action) {
    const icon   = action === 'remove'  ? '−' : action === 'restore' ? '↩' : '＋';
    const modCls = `bl__btn--${action === 'remove' ? 'remove' : action === 'restore' ? 'restore' : 'add'}`;
    const nameCls = action === 'remove' ? 'bl__name--active' : '';
    return `
      <div class="bl__row">
        <span class="bl__name ${nameCls}" title="${item.title}">${item.title}</span>
        <button class="bl__btn ${modCls}" data-id="${item.id}" data-action="${action}" title="${action} ${item.title}">${icon}</button>
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
