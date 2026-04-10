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

const SPAN_LABEL = { 1: '1/3', 2: '2/3', 3: 'full' };

export class BuilderPanel {
  constructor(topbarEl, leftEl, layout, catalog, onDone) {
    this.topbarEl        = topbarEl;
    this.leftEl          = leftEl;
    this.layout          = layout;
    this.catalog         = catalog;
    this.onDone          = onDone;
    this._stackTargetColId = null; // colId to stack into when user picks from "Add"
  }

  async init() {
    this.render();
  }

  setCatalog(catalog) {
    this.catalog = catalog;
    this.render();
  }

  /** Called by app.js when user clicks "＋ stack" on a slot. */
  setStackTarget(colId) {
    this._stackTargetColId = colId;
    this._renderLeft();
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

    const rows       = this.layout.getRows();
    const activeIds  = new Set(this.layout.list());
    const removed    = this.layout.listRecentlyRemoved();
    const available  = this.catalog.filter(c => !activeIds.has(c.id) && !removed.includes(c.id));
    const stackColId = this._stackTargetColId;

    // Layout section — one group per row, one sub-group per col/slot
    const rowsHtml = rows.length ? rows.map((row, ri) => `
      <div class="bl__row-group">
        <div class="bl__row-label">Row ${ri + 1}</div>
        ${row.cols.map(col => `
          <div class="bl__slot-group">
            <div class="bl__slot-header">
              <span class="bl__size-tag">${SPAN_LABEL[col.span] || col.span}</span>
            </div>
            ${col.panels.map(panel => {
              const cat = this.catalog.find(c => c.id === panel.id);
              return `
                <div class="bl__row bl__row--active">
                  <div class="bl__meta">
                    <span class="bl__name">${cat?.title || panel.id}</span>
                  </div>
                  <button class="bl__btn bl__btn--remove" data-id="${panel.id}" data-action="remove" title="remove">−</button>
                </div>`;
            }).join('')}
            <button class="bl__btn bl__btn--stack ${stackColId === col.id ? 'is-active' : ''}"
                    data-col-id="${col.id}" data-action="stack-target"
                    title="Stack a component into this slot">＋ stack</button>
          </div>
        `).join('')}
      </div>
    `).join('') : '<div class="builder__empty">Empty tab</div>';

    // Add section — if stacking, show stack-into hint
    const addTitle = stackColId
      ? `<div class="bl__section-title" style="margin-top:10px">
           Stack into slot <span class="bl__size-tag">${SPAN_LABEL[this._findColSpan(stackColId)] || '?'}</span>
           <button class="bl__btn bl__btn--cancel-stack" data-action="cancel-stack" style="margin-left:6px">✕</button>
         </div>`
      : `<div class="bl__section-title" style="margin-top:10px">Add</div>`;

    const addHtml = available.length
      ? available.map(item => this._row(item, stackColId ? 'stack' : 'add', stackColId)).join('')
      : '<div class="builder__empty">All added</div>';

    const removedHtml = removed.length ? `
      <div class="bl__section-title" style="margin-top:10px">Recently Removed</div>
      ${removed.map(id => {
        const cat = this.catalog.find(c => c.id === id);
        return cat ? this._row(cat, 'restore') : '';
      }).join('')}
    ` : '';

    this.leftEl.innerHTML = `
      <div class="bl__section-title">Layout</div>
      ${rowsHtml}
      ${addTitle}
      ${addHtml}
      ${removedHtml}
    `;

    // Wire up buttons
    this.leftEl.querySelectorAll('.bl__btn[data-action]').forEach(btn => {
      const action = btn.dataset.action;
      const id     = btn.dataset.id;
      const colId  = btn.dataset.colId;

      btn.addEventListener('click', async () => {
        if (action === 'remove') {
          this.layout.remove(id);
          if (this._stackTargetColId === /* the col that had this panel */ null) {
            // nothing
          }
          this.render();
        } else if (action === 'restore') {
          await this.layout.restore(id);
          this.render();
        } else if (action === 'add') {
          await this.layout.restore(id);
          this.render();
        } else if (action === 'stack') {
          if (stackColId) {
            await this.layout.stackInto(id, stackColId);
            this._stackTargetColId = null;
          } else {
            await this.layout.restore(id);
          }
          this.render();
        } else if (action === 'stack-target') {
          this._stackTargetColId = this._stackTargetColId === colId ? null : colId;
          this._renderLeft();
        } else if (action === 'cancel-stack') {
          this._stackTargetColId = null;
          this._renderLeft();
        }
      });
    });
  }

  _findColSpan(colId) {
    for (const row of this.layout.getRows()) {
      const col = row.cols.find(c => c.id === colId);
      if (col) return col.span;
    }
    return 1;
  }

  _row(item, action, colId) {
    const icon   = action === 'remove' ? '−' : action === 'restore' ? '↩' : '＋';
    const modCls = `bl__btn--${action === 'remove' ? 'remove' : action === 'restore' ? 'restore' : action === 'stack' ? 'add' : 'add'}`;
    const active = action === 'remove';
    const desc   = item.description ? `<span class="bl__desc">${item.description}</span>` : '';
    const colAttr = colId ? ` data-col-id="${colId}"` : '';
    return `
      <div class="bl__row${active ? ' bl__row--active' : ''}">
        <div class="bl__meta">
          <span class="bl__name">${item.title}</span>
          ${desc}
        </div>
        <button class="bl__btn ${modCls}" data-id="${item.id}" data-action="${action}"${colAttr}
                title="${action} ${item.title}">${icon}</button>
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
    this._stackTargetColId = null;
    this.render();
  }
}
