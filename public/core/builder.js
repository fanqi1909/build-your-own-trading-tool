/**
 * public/core/builder.js — Dashboard builder side panel
 */
import { groupBuilderSections, getSuggestedTabs } from './suggestions.js';

const PRESETS = [
  { id: 'watch',   icon: '👁', label: 'Watch Market',  desc: 'Price ticker + candlestick chart', components: ['ticker', 'chart'] },
  { id: 'analyze', icon: '📊', label: 'Analyze',       desc: 'Chart + indicators + AI assessment', components: ['ticker', 'chart', 'analysis', 'claude-insights'] },
  { id: 'trade',   icon: '⚡', label: 'Trade',         desc: 'Trading setup with orders and positions', components: ['ticker', 'chart', 'order-panel', 'positions', 'open-orders'] },
  { id: 'full',    icon: '🔲', label: 'Full Dashboard',desc: 'Everything enabled', components: ['ticker', 'balance', 'chart', 'analysis', 'order-panel', 'positions', 'open-orders', 'position-track', 'claude-insights', 'history', 'trade-review'] },
];

export class BuilderPanel {
  constructor(panelEl, layout, catalog, onDone) {
    this.el      = panelEl;
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
    if (!this.el) return;

    const activeTab = this.layout.getActiveTab();
    const suggestedTabs = getSuggestedTabs(this.layout.listTabs());
    const { recommended, available, removed } = groupBuilderSections(
      this.catalog,
      this.layout.list(),
      this.layout.listRecentlyRemoved()
    );

    this.el.innerHTML = `
      <div class="builder__header">
        <div>
          <div class="builder__title">Build Your Dashboard</div>
          <div class="builder__section-title">Editing tab: ${activeTab.title}</div>
        </div>
        <button class="builder__done" id="builder-done">Done</button>
      </div>

      <div class="builder__section">
        <div class="builder__section-title">AI Suggested Tabs</div>
        <div class="builder__presets">
          ${suggestedTabs.map(tab => `
            <div class="builder__preset builder__preset--tab" data-suggested-tab="${tab.id}">
              <div class="builder__preset-icon">${tab.icon}</div>
              <div class="builder__preset-label">${tab.title}</div>
              <div class="builder__preset-desc">${tab.reason}</div>
              <button class="builder__component-action builder__component-action--add" data-create-tab="${tab.id}">Create Tab</button>
            </div>
          `).join('') || '<div class="builder__empty">You already have the main tab structure.</div>'}
        </div>
      </div>

      <div class="builder__section">
        <div class="builder__section-title">Recommended Presets</div>
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
        <div class="builder__section-title">AI Suggests For This Tab</div>
        <div class="builder__components builder__components--recommended">
          ${recommended.map(item => this._card(item, 'add')).join('') || '<div class="builder__empty">This tab already includes the top recommendations.</div>'}
        </div>
      </div>

      <div class="builder__section">
        <div class="builder__section-title">Available Components</div>
        <div class="builder__components">
          ${available.map(item => this._card(item, 'add')).join('') || '<div class="builder__empty">No more components available.</div>'}
        </div>
      </div>

      <div class="builder__section">
        <div class="builder__section-title">Recently Removed</div>
        <div class="builder__components">
          ${removed.map(item => this._card(item, 'restore')).join('') || '<div class="builder__empty">Nothing removed recently.</div>'}
        </div>
      </div>
    `;

    this.el.querySelector('#builder-done')?.addEventListener('click', () => this.onDone());
    this.el.querySelectorAll('.builder__preset[data-preset]').forEach(el => el.addEventListener('click', () => this._applyPreset(el.dataset.preset)));
    this.el.querySelectorAll('[data-create-tab]').forEach(el => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const suggested = suggestedTabs.find(tab => tab.id === el.dataset.createTab);
      if (!suggested) return;
      await this.layout.addTab(suggested.title, suggested.components);
      this.render();
    }));
    this.el.querySelectorAll('.builder__component-action[data-component]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.dataset.component;
        const action = el.dataset.action;
        if (action === 'add' || action === 'restore') this.layout.restore(id).then(() => this.render());
      });
    });
  }

  _card(item, action) {
    const label = action === 'restore' ? 'Restore' : 'Add';
    return `
      <div class="builder__component" data-component="${item.id}">
        <div class="builder__component-icon">${item.icon}</div>
        <div class="builder__component-info">
          <div class="builder__component-label">${item.title}</div>
          <div class="builder__component-desc">${item.description}</div>
        </div>
        <button class="builder__component-action builder__component-action--${action}" data-component="${item.id}" data-action="${action}">${label}</button>
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
