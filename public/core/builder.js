/**
 * public/core/builder.js — Dashboard builder panel
 *
 * Fetches the plugin manifest from /api/manifest, renders:
 *  - Preset layout templates
 *  - Per-component toggle grid
 *
 * All layout mutations go through the LayoutManager API.
 */

const PRESETS = [
  {
    id:         'watch',
    icon:       '👁',
    label:      'Watch Market',
    desc:       'Price ticker + candlestick chart',
    components: ['ticker', 'chart'],
  },
  {
    id:         'analyze',
    icon:       '📊',
    label:      'Analyze',
    desc:       'Chart + technical indicators + AI assessment',
    components: ['ticker', 'chart', 'analysis', 'claude-insights'],
  },
  {
    id:         'trade',
    icon:       '⚡',
    label:      'Trade',
    desc:       'Full trading setup with orders and positions',
    components: ['ticker', 'chart', 'order-panel', 'positions', 'open-orders'],
  },
  {
    id:         'full',
    icon:       '🔲',
    label:      'Full Dashboard',
    desc:       'All panels enabled',
    components: ['ticker', 'balance', 'chart', 'analysis', 'order-panel',
                 'positions', 'open-orders', 'position-track', 'claude-insights',
                 'history', 'trade-review'],
  },
];

export class BuilderPanel {
  /**
   * @param {HTMLElement}   overlayEl — #builder-overlay
   * @param {LayoutManager} layout
   * @param {Function}      onDone    — called when user clicks Done
   */
  constructor(overlayEl, layout, onDone) {
    this.el      = overlayEl;
    this.layout  = layout;
    this.onDone  = onDone;
    this._caps   = [];   // capabilities array from manifest
  }

  async init() {
    try {
      const res       = await fetch('/api/manifest');
      const manifest  = await res.json();
      this._caps      = Object.values(manifest.capabilities || {});
    } catch (e) {
      console.error('[builder] failed to load manifest:', e);
    }
    this._render();
  }

  show() {
    this.el.hidden = false;
    this._syncToggles();
  }

  hide() {
    this.el.hidden = true;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _render() {
    const panel = this.el.querySelector('#builder-panel');
    if (!panel) return;

    panel.innerHTML = `
      <div class="builder__header">
        <div class="builder__title">Build Your Dashboard</div>
        <button class="builder__done" id="builder-done">Done →</button>
      </div>

      <div class="builder__section">
        <div class="builder__section-title">Start from a template</div>
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
        <div class="builder__section-title">Components</div>
        <div class="builder__components" id="builder-components">
          ${this._caps.map(cap => `
            <div class="builder__component" data-component="${cap.component}">
              <div class="builder__component-check">✓</div>
              <div class="builder__component-info">
                <div class="builder__component-label">${cap.label}</div>
                <div class="builder__component-desc">${cap.description}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Done button
    panel.querySelector('#builder-done')
      .addEventListener('click', () => this.onDone());

    // Preset cards
    panel.querySelectorAll('.builder__preset').forEach(el => {
      el.addEventListener('click', () => this._applyPreset(el.dataset.preset));
    });

    // Component toggles
    panel.querySelectorAll('.builder__component').forEach(el => {
      el.addEventListener('click', () => this._toggleComponent(el.dataset.component, el));
    });

    this._syncToggles();
  }

  _syncToggles() {
    const panel = this.el.querySelector('#builder-components');
    if (!panel) return;
    panel.querySelectorAll('.builder__component').forEach(el => {
      const active = this.layout.has(el.dataset.component);
      el.classList.toggle('is-active', active);
    });
  }

  async _toggleComponent(componentId, el) {
    if (this.layout.has(componentId)) {
      this.layout.remove(componentId);
      el.classList.remove('is-active');
    } else {
      await this.layout.add(componentId);
      el.classList.add('is-active');
    }
  }

  async _applyPreset(presetId) {
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    // Remove components not in preset
    for (const id of this.layout.list()) {
      if (!preset.components.includes(id)) this.layout.remove(id);
    }
    // Add components in preset
    for (const id of preset.components) {
      if (!this.layout.has(id)) await this.layout.add(id);
    }

    this._syncToggles();
  }
}
