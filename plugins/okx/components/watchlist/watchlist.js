import { Component } from '/core/component.js';

export default class WatchlistComponent extends Component {
  static id = 'watchlist';
  static inputs  = ['instrument', 'watchlist'];
  static outputs = ['instrument'];
  static defaultConfig = {};

  async init() {
    this._injectStyles();
    const ctx = this.getContext();
    this._activeInst = ctx.instrument || 'BTC-USDT-SWAP';
    this._watchlist  = Array.isArray(ctx.watchlist) ? [...ctx.watchlist] : [];
    this._prices     = {};
    this._adding     = false;

    this._renderShell();
    this._renderList();

    // Pre-fetch tickers for all watchlist items
    for (const inst of this._watchlist) {
      this.send('fetchTicker', { inst: inst.replace('-SWAP', '') });
    }

    this.on('ticker', ({ data }) => {
      if (!data?.instId) return;
      const id  = data.instId.includes('-SWAP') ? data.instId : `${data.instId}-SWAP`;
      const px  = parseFloat(data.last);
      const op  = parseFloat(data.open24h);
      this._prices[id] = { last: px, chg: op ? ((px - op) / op) * 100 : 0 };
      this._updateRow(id);
    });

    this.onContextChange(({ context, changedKeys }) => {
      let changed = false;
      if (changedKeys?.includes('instrument')) {
        this._activeInst = context.instrument || this._activeInst;
        changed = true;
      }
      if (changedKeys?.includes('watchlist')) {
        const prev = new Set(this._watchlist);
        this._watchlist = Array.isArray(context.watchlist) ? [...context.watchlist] : [];
        // Fetch tickers for newly added instruments
        for (const inst of this._watchlist) {
          if (!prev.has(inst)) this.send('fetchTicker', { inst: inst.replace('-SWAP', '') });
        }
        changed = true;
      }
      if (changed) this._renderList();
    });
  }

  _renderShell() {
    this.el.innerHTML = `
      <div class="wl">
        <div class="wl__header">
          <span class="wl__title">Watchlist</span>
          <button class="wl__add-btn" id="wl-add-btn" title="Add instrument">＋</button>
        </div>
        <div class="wl__add-row" id="wl-add-row" style="display:none">
          <input class="wl__add-input" id="wl-add-input" placeholder="e.g. ETH-USDT-SWAP" autocomplete="off">
          <button class="wl__add-confirm" id="wl-add-confirm">Add</button>
        </div>
        <div class="wl__list" id="wl-list"></div>
      </div>
    `;

    this.el.querySelector('#wl-add-btn').addEventListener('click', () => {
      const row = this.el.querySelector('#wl-add-row');
      this._adding = !this._adding;
      row.style.display = this._adding ? '' : 'none';
      if (this._adding) this.el.querySelector('#wl-add-input').focus();
    });

    this.el.querySelector('#wl-add-confirm').addEventListener('click', () => this._addInstrument());
    this.el.querySelector('#wl-add-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._addInstrument();
    });
  }

  _addInstrument() {
    const input = this.el.querySelector('#wl-add-input');
    let val = (input?.value || '').trim().toUpperCase();
    if (!val) return;
    if (!val.endsWith('-SWAP')) val += '-USDT-SWAP';
    if (!this._watchlist.includes(val)) {
      const wl = [...this._watchlist, val];
      this.setContext({ watchlist: wl });
      this.send('fetchTicker', { inst: val.replace('-SWAP', '') });
    }
    if (input) input.value = '';
    this._adding = false;
    const row = this.el.querySelector('#wl-add-row');
    if (row) row.style.display = 'none';
  }

  _renderList() {
    const list = this.el.querySelector('#wl-list');
    if (!list) return;

    // All watchlist items (excluding active if already in list — we show it separately at bottom)
    const wlWithoutActive = this._watchlist.filter(i => i !== this._activeInst);
    const showActive = !this._watchlist.includes(this._activeInst);

    const rows = wlWithoutActive.map(inst => this._rowHtml(inst, false)).join('');
    const activeRow = `<div class="wl__divider"></div>${this._rowHtml(this._activeInst, true, false)}`;

    list.innerHTML = rows + (wlWithoutActive.length || !showActive ? '' : '') + activeRow;
    this._bindRowEvents();
  }

  _rowHtml(instId, isActive, canRemove = true) {
    const price   = this._prices[instId];
    const display = instId.replace('-USDT-SWAP', '').replace('-SWAP', '');
    const priceStr = price ? '$' + price.last.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—';
    const chgStr   = price ? (price.chg >= 0 ? '+' : '') + price.chg.toFixed(2) + '%' : '';
    const chgCls   = price ? (price.chg >= 0 ? 'wl__chg--up' : 'wl__chg--down') : '';

    return `
      <div class="wl__row${isActive ? ' wl__row--active' : ''}" data-inst="${instId}">
        <span class="wl__dot${isActive ? ' wl__dot--on' : ''}"></span>
        <span class="wl__name">${display}</span>
        <span class="wl__price">${priceStr}</span>
        <span class="wl__chg ${chgCls}">${chgStr}</span>
        ${canRemove ? `<button class="wl__remove" data-remove="${instId}" title="Remove">×</button>` : '<span class="wl__active-badge">●</span>'}
      </div>
    `;
  }

  _bindRowEvents() {
    const list = this.el.querySelector('#wl-list');
    if (!list) return;

    list.querySelectorAll('.wl__row[data-inst]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.wl__remove')) return;
        const instId = row.dataset.inst;
        if (instId !== this._activeInst) {
          this.setContext({ instrument: instId });
          this.send('fetchTicker', { inst: instId.replace('-SWAP', '') });
        }
      });
    });

    list.querySelectorAll('.wl__remove[data-remove]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const instId = btn.dataset.remove;
        this.setContext({ watchlist: this._watchlist.filter(i => i !== instId) });
      });
    });
  }

  _updateRow(instId) {
    const row = this.el.querySelector(`.wl__row[data-inst="${instId}"]`);
    if (!row) return;
    const price = this._prices[instId];
    if (!price) return;
    const priceEl = row.querySelector('.wl__price');
    const chgEl   = row.querySelector('.wl__chg');
    if (priceEl) priceEl.textContent = '$' + price.last.toLocaleString('en-US', { maximumFractionDigits: 4 });
    if (chgEl) {
      chgEl.textContent = (price.chg >= 0 ? '+' : '') + price.chg.toFixed(2) + '%';
      chgEl.className = 'wl__chg ' + (price.chg >= 0 ? 'wl__chg--up' : 'wl__chg--down');
    }
  }

  _injectStyles() {
    const id = 'wl-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .wl { display: flex; flex-direction: column; height: 100%; font-family: var(--font-mono, 'SF Mono', monospace); }
      .wl__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .wl__title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted, #64748b); }
      .wl__add-btn { background: none; border: 1px solid var(--border, rgba(255,255,255,0.07)); border-radius: 999px; color: var(--text-muted, #64748b); cursor: pointer; font-size: 14px; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; transition: color 0.15s, border-color 0.15s; }
      .wl__add-btn:hover { color: #00e5ff; border-color: #00e5ff; }
      .wl__add-row { display: flex; gap: 6px; margin-bottom: 8px; }
      .wl__add-input { flex: 1; padding: 5px 8px; border-radius: 5px; border: 1px solid rgba(0,229,255,0.3); background: rgba(0,229,255,0.04); color: var(--text, #e2e8f0); font-size: 11px; font-family: inherit; outline: none; }
      .wl__add-confirm { padding: 5px 10px; border-radius: 5px; border: none; background: #00e5ff; color: #0c1220; font-size: 11px; font-weight: 700; cursor: pointer; }
      .wl__list { flex: 1; overflow-y: auto; }
      .wl__divider { border-top: 1px solid var(--border, rgba(255,255,255,0.07)); margin: 6px 0; }
      .wl__row { display: flex; align-items: center; gap: 6px; padding: 6px 4px; border-radius: 5px; cursor: pointer; transition: background 0.1s; }
      .wl__row:hover { background: rgba(255,255,255,0.04); }
      .wl__row--active { background: rgba(0,229,255,0.06); }
      .wl__dot { width: 5px; height: 5px; border-radius: 50%; background: transparent; flex-shrink: 0; }
      .wl__dot--on { background: #00e5ff; }
      .wl__name { flex: 1; font-size: 12px; font-weight: 600; color: var(--text, #e2e8f0); }
      .wl__price { font-size: 11px; color: var(--text-muted, #64748b); min-width: 72px; text-align: right; }
      .wl__chg { font-size: 10px; min-width: 48px; text-align: right; }
      .wl__chg--up   { color: #26a69a; }
      .wl__chg--down { color: #ef5350; }
      .wl__remove { background: none; border: none; color: var(--text-dim, #334155); cursor: pointer; font-size: 14px; padding: 0 2px; line-height: 1; transition: color 0.15s; flex-shrink: 0; }
      .wl__remove:hover { color: #ef5350; }
      .wl__active-badge { font-size: 8px; color: #00e5ff; flex-shrink: 0; width: 16px; text-align: center; }
    `;
    document.head.appendChild(s);
  }
}
