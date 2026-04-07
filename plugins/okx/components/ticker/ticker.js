import { Component } from '/core/component.js';

export default class TickerComponent extends Component {
  static id = 'ticker';
  static inputs = ['instrument'];
  static outputs = ['instrument'];
  static defaultConfig = {
    symbols: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'],
    preset: 'majors',
  };

  async init() {
    this._injectStyles();
    this._prevPrice = null;
    const ctx = this.getContext();
    this._instrument = ctx.instrument || this.getConfig().symbols?.[0] || 'BTC-USDT-SWAP';

    this.el.innerHTML = `
      <div class="ticker">
        <div class="ticker__header">
          <div class="ticker__inst-wrap">
            <select class="ticker__select" id="ticker-select">
              ${this.getConfig().symbols.map(symbol => `<option value="${symbol}" ${symbol === this._instrument ? 'selected' : ''}>${this._formatInst(symbol)}</option>`).join('')}
            </select>
            <span class="ticker__mode-badge ticker__mode-badge--demo" id="ticker-mode">DEMO</span>
          </div>
          <span class="ticker__label">Last Price</span>
        </div>
        <div class="ticker__price" id="ticker-price">—</div>
        <div class="ticker__meta">
          <span class="ticker__change" id="ticker-change">—</span>
          <span class="ticker__hl">
            H <span id="ticker-high" class="ticker__hl-val">—</span>
            &nbsp;L <span id="ticker-low" class="ticker__hl-val">—</span>
          </span>
        </div>
        <div class="ticker__vol">
          <span class="ticker__vol-label">24h Vol</span>
          <span id="ticker-vol" class="ticker__vol-val">—</span>
        </div>
      </div>
    `;

    this.el.querySelector('#ticker-select')?.addEventListener('change', (e) => {
      this._instrument = e.target.value;
      this.setContext({ instrument: this._instrument });
      this.send('fetchTicker', { inst: this._instrument.replace('-SWAP', '') });
    });

    this.on('ticker', (msg) => this.update(msg));
    this.onContextChange(({ context, changedKeys }) => {
      if (!changedKeys?.includes('instrument')) return;
      this._instrument = context.instrument || this._instrument;
      const select = this.el.querySelector('#ticker-select');
      if (select) select.value = this._instrument;
      this.send('fetchTicker', { inst: this._instrument.replace('-SWAP', '') });
    });

    this.send('fetchTicker', { inst: this._instrument.replace('-SWAP', '') });
  }

  _formatInst(inst) {
    return (inst || '').replace('-SWAP', '');
  }

  update({ data, mode }) {
    if (!data) return;
    const inst = data.instId?.includes('-SWAP') ? data.instId : `${data.instId || ''}-SWAP`;
    if (inst && inst !== this._instrument) return;

    const price = parseFloat(data.last);
    const open  = parseFloat(data.open24h);
    const high  = parseFloat(data.high24h);
    const low   = parseFloat(data.low24h);
    const vol   = parseFloat(data.vol24h);
    const chg   = ((price - open) / open) * 100;

    const priceEl = this.el.querySelector('#ticker-price');
    if (priceEl) {
      priceEl.textContent = '$' + price.toLocaleString('en-US', { minimumFractionDigits: 1 });
      if (this._prevPrice !== null) {
        const cls = price >= this._prevPrice ? 'ticker__price--flash-up' : 'ticker__price--flash-down';
        priceEl.classList.add(cls);
        setTimeout(() => priceEl.classList.remove(cls), 500);
      }
    }
    this._prevPrice = price;

    const changeEl = this.el.querySelector('#ticker-change');
    if (changeEl) {
      changeEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
      changeEl.className = 'ticker__change ' + (chg >= 0 ? 'ticker__change--up' : 'ticker__change--down');
    }

    const highEl = this.el.querySelector('#ticker-high');
    const lowEl  = this.el.querySelector('#ticker-low');
    const volEl  = this.el.querySelector('#ticker-vol');
    if (highEl) highEl.textContent = '$' + high.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (lowEl)  lowEl.textContent  = '$' + low.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (volEl)  volEl.textContent  = vol >= 1000 ? (vol / 1000).toFixed(1) + 'K BTC' : vol.toFixed(0) + ' BTC';

    const modeEl = this.el.querySelector('#ticker-mode');
    if (modeEl) {
      modeEl.textContent = mode === 'live' ? 'LIVE' : 'DEMO';
      modeEl.className = 'ticker__mode-badge ' + (mode === 'live' ? 'ticker__mode-badge--live' : 'ticker__mode-badge--demo');
    }
  }

  _injectStyles() {
    const id = 'ticker-styles';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      .ticker { background: linear-gradient(135deg, rgba(0,229,255,0.06) 0%, transparent 100%); border: 1px solid rgba(0,229,255,0.18); border-radius: var(--radius, 6px); padding: 20px 24px; font-family: var(--font-mono, 'SF Mono', monospace); }
      .ticker__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
      .ticker__inst-wrap { display: flex; align-items: center; gap: 8px; }
      .ticker__select { font-size: 13px; font-weight: 700; color: var(--text, #e2e8f0); letter-spacing: 0.5px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 4px 8px; }
      .ticker__mode-badge { font-size: 10px; padding: 2px 7px; border-radius: 4px; font-weight: 700; letter-spacing: 1px; }
      .ticker__mode-badge--demo { background: rgba(245,158,11,0.12); color: #f59e0b; border: 1px solid rgba(245,158,11,0.25); }
      .ticker__mode-badge--live { background: rgba(239,83,80,0.12); color: var(--red, #ef5350); border: 1px solid rgba(239,83,80,0.25); }
      .ticker__label { font-size: 10px; color: var(--text-muted, #64748b); text-transform: uppercase; letter-spacing: 1px; }
      .ticker__price { font-size: 44px; font-weight: 800; letter-spacing: -2px; color: #00e5ff; text-shadow: 0 0 30px rgba(0,229,255,0.25); transition: color 0.3s; line-height: 1.1; margin-bottom: 10px; }
      .ticker__price--flash-up { color: #86efac !important; }
      .ticker__price--flash-down { color: #fca5a5 !important; }
      .ticker__meta { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; font-size: 12px; }
      .ticker__change { padding: 3px 10px; border-radius: 6px; font-weight: 700; font-size: 12px; }
      .ticker__change--up { background: rgba(38,166,154,0.15); color: var(--green, #26a69a); border: 1px solid rgba(38,166,154,0.25); }
      .ticker__change--down { background: rgba(239,83,80,0.15); color: var(--red, #ef5350); border: 1px solid rgba(239,83,80,0.25); }
      .ticker__hl { font-size: 11px; color: var(--text-muted, #64748b); }
      .ticker__hl-val { color: var(--text, #e2e8f0); }
      .ticker__vol { display: flex; gap: 8px; font-size: 11px; margin-top: 4px; }
      .ticker__vol-label { color: var(--text-muted, #64748b); }
      .ticker__vol-val { color: var(--text, #e2e8f0); }
    `;
    document.head.appendChild(style);
  }
}
