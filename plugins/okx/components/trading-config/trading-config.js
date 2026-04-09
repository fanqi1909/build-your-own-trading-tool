import { Component } from '/core/component.js';

const LEVER_PRESETS = [3, 5, 10, 20, 50];

export default class TradingConfigComponent extends Component {
  static id = 'trading-config';
  static inputs  = ['instrument', 'leverage'];
  static outputs = ['leverage'];
  static defaultConfig = {};

  async init() {
    this._injectStyles();
    const ctx = this.getContext();
    this._instrument = ctx.instrument || 'BTC-USDT-SWAP';
    this._leverage   = ctx.leverage   ?? 10;
    this._meta       = null;
    this._mode       = null; // filled by mode event

    this.el.innerHTML = `
      <div class="tc">
        <div class="tc__header">
          <span class="tc__title">Trading Config</span>
        </div>

        <div class="tc__section">
          <div class="tc__label">Mode</div>
          <div class="tc__mode-row">
            <button class="tc__mode-btn" data-mode="demo" id="tc-demo">Demo</button>
            <button class="tc__mode-btn" data-mode="live" id="tc-live">Live</button>
          </div>
        </div>

        <div class="tc__section">
          <div class="tc__label">Default Leverage</div>
          <div class="tc__lever-row">
            ${LEVER_PRESETS.map(l => `<button class="tc__lever-btn" data-lever="${l}">${l}×</button>`).join('')}
            <input class="tc__lever-input" id="tc-lever" type="number" min="1" max="125" value="${this._leverage}">
          </div>
        </div>

        <div class="tc__section tc__spec" id="tc-spec">
          <div class="tc__label" id="tc-spec-inst">${this._formatInst(this._instrument)}</div>
          <div class="tc__spec-body" id="tc-spec-body">
            <span class="tc__spec-loading">Loading spec…</span>
          </div>
        </div>
      </div>
    `;

    // Leverage presets
    this.el.querySelectorAll('.tc__lever-btn[data-lever]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = parseInt(btn.dataset.lever);
        this._setLeverage(v);
      });
    });

    const leverInput = this.el.querySelector('#tc-lever');
    leverInput?.addEventListener('change', () => {
      const v = parseInt(leverInput.value);
      if (v >= 1) this._setLeverage(v);
    });

    // Mode buttons
    this.el.querySelectorAll('.tc__mode-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.send('setMode', { mode: btn.dataset.mode });
      });
    });

    this.on('mode', ({ mode }) => {
      this._mode = mode;
      this._syncModeUI();
    });

    this.on('instrumentMeta', ({ inst, meta }) => {
      if (inst !== this._instrument) return;
      this._meta = meta;
      this._renderSpec();
    });

    this.onContextChange(({ context, changedKeys }) => {
      if (changedKeys?.includes('instrument')) {
        this._instrument = context.instrument || this._instrument;
        this._meta = null;
        const instLabel = this.el.querySelector('#tc-spec-inst');
        if (instLabel) instLabel.textContent = this._formatInst(this._instrument);
        const body = this.el.querySelector('#tc-spec-body');
        if (body) body.innerHTML = '<span class="tc__spec-loading">Loading spec…</span>';
        this.send('fetchInstrumentMeta', { inst: this._instrument });
      }
      if (changedKeys?.includes('leverage')) {
        this._leverage = context.leverage ?? this._leverage;
        this._syncLeverUI();
      }
    });

    // Initial fetch
    this.send('fetchInstrumentMeta', { inst: this._instrument });
    this._syncLeverUI();
  }

  _setLeverage(v) {
    this._leverage = v;
    this.setContext({ leverage: v });
    this._syncLeverUI();
  }

  _syncLeverUI() {
    const input = this.el.querySelector('#tc-lever');
    if (input) input.value = this._leverage;
    this.el.querySelectorAll('.tc__lever-btn[data-lever]').forEach(btn => {
      btn.classList.toggle('tc__lever-btn--active', parseInt(btn.dataset.lever) === this._leverage);
    });
  }

  _syncModeUI() {
    this.el.querySelectorAll('.tc__mode-btn[data-mode]').forEach(btn => {
      btn.classList.toggle('tc__mode-btn--active', btn.dataset.mode === this._mode);
    });
  }

  _renderSpec() {
    const body = this.el.querySelector('#tc-spec-body');
    if (!body) return;
    if (!this._meta) {
      body.innerHTML = '<span class="tc__spec-loading">No spec available</span>';
      return;
    }
    const m = this._meta;
    const maxLever = parseInt(m.maxLever) || 125;
    body.innerHTML = `
      <div class="tc__spec-row"><span class="tc__spec-key">Contract</span><span class="tc__spec-val">${m.ctVal} ${m.baseCcy}</span></div>
      <div class="tc__spec-row"><span class="tc__spec-key">Min size</span><span class="tc__spec-val">${m.minSz} ct</span></div>
      <div class="tc__spec-row"><span class="tc__spec-key">Lot size</span><span class="tc__spec-val">${m.lotSz} ct</span></div>
      <div class="tc__spec-row"><span class="tc__spec-key">Tick size</span><span class="tc__spec-val">${m.tickSz}</span></div>
      <div class="tc__spec-row"><span class="tc__spec-key">Max lever</span><span class="tc__spec-val">${maxLever}×</span></div>
    `;
    // Clamp leverage to max
    if (this._leverage > maxLever) this._setLeverage(maxLever);
    const leverInput = this.el.querySelector('#tc-lever');
    if (leverInput) leverInput.max = maxLever;
  }

  _formatInst(inst) {
    return (inst || '').replace('-USDT-SWAP', '/USDT').replace('-SWAP', '');
  }

  _injectStyles() {
    const id = 'tc-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .tc { font-family: var(--font-mono, 'SF Mono', monospace); display: flex; flex-direction: column; gap: 14px; }
      .tc__header { display: flex; align-items: center; justify-content: space-between; }
      .tc__title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted, #64748b); }
      .tc__section { display: flex; flex-direction: column; gap: 8px; }
      .tc__label { font-size: 10px; color: var(--text-dim, #334155); text-transform: uppercase; letter-spacing: 0.06em; }
      .tc__mode-row { display: flex; gap: 6px; }
      .tc__mode-btn { flex: 1; padding: 5px; border-radius: 5px; border: 1px solid var(--border, rgba(255,255,255,0.07)); background: rgba(255,255,255,0.04); color: var(--text-muted, #64748b); font-size: 11px; font-family: inherit; cursor: pointer; transition: all 0.15s; }
      .tc__mode-btn--active[data-mode="demo"] { border-color: #f59e0b; color: #f59e0b; background: rgba(245,158,11,0.08); }
      .tc__mode-btn--active[data-mode="live"]  { border-color: #ef5350; color: #ef5350; background: rgba(239,83,80,0.08); }
      .tc__lever-row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
      .tc__lever-btn { padding: 4px 8px; border-radius: 5px; border: 1px solid var(--border, rgba(255,255,255,0.07)); background: rgba(255,255,255,0.04); color: var(--text-muted, #64748b); font-size: 11px; font-family: inherit; cursor: pointer; transition: all 0.15s; }
      .tc__lever-btn--active { border-color: #00e5ff; color: #00e5ff; background: rgba(0,229,255,0.08); }
      .tc__lever-input { width: 46px; padding: 4px 6px; border-radius: 5px; border: 1px solid var(--border, rgba(255,255,255,0.07)); background: rgba(255,255,255,0.04); color: var(--text, #e2e8f0); font-size: 11px; font-family: inherit; text-align: center; outline: none; }
      .tc__lever-input:focus { border-color: rgba(0,229,255,0.4); }
      .tc__spec { border-top: 1px solid var(--border, rgba(255,255,255,0.07)); padding-top: 12px; }
      .tc__spec-loading { font-size: 11px; color: var(--text-dim, #334155); }
      .tc__spec-body { display: flex; flex-direction: column; gap: 4px; }
      .tc__spec-row { display: flex; justify-content: space-between; font-size: 11px; }
      .tc__spec-key { color: var(--text-dim, #334155); }
      .tc__spec-val { color: var(--text-muted, #64748b); font-weight: 600; }
    `;
    document.head.appendChild(s);
  }
}
