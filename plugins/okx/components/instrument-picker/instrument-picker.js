import { Component } from '/core/component.js';

const GROUPS = {
  'Major':   ['BTC', 'ETH'],
  'Layer 1': ['SOL', 'AVAX', 'ADA', 'DOT', 'ATOM', 'NEAR', 'ARB', 'OP', 'SUI', 'APT', 'INJ', 'SEI'],
  'DeFi':    ['UNI', 'AAVE', 'CRV', 'MKR', 'LDO', 'COMP', 'SNX', 'GMX', 'DYDX'],
  'Meme':    ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'DOGS'],
};

function getGroup(baseCcy) {
  for (const [group, bases] of Object.entries(GROUPS)) {
    if (bases.includes(baseCcy)) return group;
  }
  return 'Others';
}

export default class InstrumentPickerComponent extends Component {
  static id = 'instrument-picker';
  static inputs  = ['instrument', 'watchlist'];
  static outputs = ['instrument', 'watchlist'];
  static defaultConfig = {
    favorites: ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'],
  };

  async init() {
    this._injectStyles();
    this._instruments = [];   // full list from server
    this._prices      = {};   // instId → { last, chg }
    this._query       = '';

    const ctx = this.getContext();
    this._activeInst  = ctx.instrument || 'BTC-USDT-SWAP';
    this._watchlist   = Array.isArray(ctx.watchlist) ? [...ctx.watchlist] : [];

    this.el.innerHTML = `
      <div class="ip">
        <div class="ip__header">
          <span class="ip__title">Instruments</span>
          <span class="ip__count" id="ip-count"></span>
        </div>
        <div class="ip__search-wrap">
          <input class="ip__search" id="ip-search" placeholder="Search…" autocomplete="off">
        </div>
        <div class="ip__list" id="ip-list">
          <div class="ip__loading">Loading instruments…</div>
        </div>
      </div>
    `;

    this.el.querySelector('#ip-search').addEventListener('input', (e) => {
      this._query = e.target.value.trim().toUpperCase();
      this._render();
    });

    this.on('instrumentList', ({ instruments }) => {
      this._instruments = instruments || [];
      this._render();
      const countEl = this.el.querySelector('#ip-count');
      if (countEl) countEl.textContent = this._instruments.length + ' pairs';
      // Pre-fetch tickers for favorites
      for (const instId of this.getConfig().favorites) {
        this.send('fetchTicker', { inst: instId.replace('-SWAP', '') });
      }
    });

    this.on('ticker', ({ data }) => {
      if (!data?.instId) return;
      const id  = data.instId.includes('-SWAP') ? data.instId : `${data.instId}-SWAP`;
      const px  = parseFloat(data.last);
      const op  = parseFloat(data.open24h);
      this._prices[id] = { last: px, chg: op ? ((px - op) / op) * 100 : 0 };
      this._updateRow(id);
    });

    this.onContextChange(({ context, changedKeys }) => {
      if (changedKeys?.includes('instrument')) {
        const prev = this._activeInst;
        this._activeInst = context.instrument || this._activeInst;
        if (prev !== this._activeInst) {
          this._updateActiveRow(prev, this._activeInst);
        }
      }
      if (changedKeys?.includes('watchlist')) {
        this._watchlist = Array.isArray(context.watchlist) ? [...context.watchlist] : [];
        this._render();
      }
    });

    this.send('fetchInstruments');
  }

  _render() {
    const list = this.el.querySelector('#ip-list');
    if (!list) return;

    const query = this._query;
    const favSet = new Set(this.getConfig().favorites);
    const wlSet  = new Set(this._watchlist);

    // Filter
    const filtered = query
      ? this._instruments.filter(i => i.instId.includes(query) || i.baseCcy?.includes(query))
      : this._instruments;

    if (!filtered.length) {
      list.innerHTML = `<div class="ip__empty">No results for "${this._query}"</div>`;
      return;
    }

    // Group
    const groups = {};
    if (!query) {
      // Favorites section first
      const favs = filtered.filter(i => favSet.has(i.instId));
      if (favs.length) groups['★ Favorites'] = favs;
    }

    for (const inst of filtered) {
      const g = getGroup(inst.baseCcy);
      if (!groups[g]) groups[g] = [];
      groups[g].push(inst);
    }

    const html = Object.entries(groups).map(([group, items]) => `
      <div class="ip__group-label">${group}</div>
      ${items.map(inst => this._rowHtml(inst, wlSet)).join('')}
    `).join('');

    list.innerHTML = html;
    this._bindRowEvents();
  }

  _rowHtml(inst, wlSet) {
    const isActive  = inst.instId === this._activeInst;
    const inWl      = wlSet.has(inst.instId);
    const price     = this._prices[inst.instId];
    const priceStr  = price ? '$' + price.last.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—';
    const chgStr    = price ? (price.chg >= 0 ? '+' : '') + price.chg.toFixed(2) + '%' : '';
    const chgCls    = price ? (price.chg >= 0 ? 'ip__chg--up' : 'ip__chg--down') : '';
    const display   = inst.instId.replace('-USDT-SWAP', '').replace('-SWAP', '');

    return `
      <div class="ip__row${isActive ? ' ip__row--active' : ''}" data-inst="${inst.instId}">
        <span class="ip__dot${isActive ? ' ip__dot--on' : ''}"></span>
        <span class="ip__name">${display}</span>
        <span class="ip__price">${priceStr}</span>
        <span class="ip__chg ${chgCls}">${chgStr}</span>
        <button class="ip__star${inWl ? ' ip__star--on' : ''}" data-star="${inst.instId}" title="${inWl ? 'Remove from watchlist' : 'Add to watchlist'}">
          ${inWl ? '★' : '☆'}
        </button>
      </div>
    `;
  }

  _bindRowEvents() {
    const list = this.el.querySelector('#ip-list');
    if (!list) return;

    list.querySelectorAll('.ip__row[data-inst]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.ip__star')) return;
        const instId = row.dataset.inst;
        this.setContext({ instrument: instId });
        this.send('fetchTicker', { inst: instId.replace('-SWAP', '') });
      });
    });

    list.querySelectorAll('.ip__star[data-star]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const instId = btn.dataset.star;
        const wl = [...this._watchlist];
        const idx = wl.indexOf(instId);
        if (idx >= 0) wl.splice(idx, 1);
        else wl.push(instId);

        const favs = [...this.getConfig().favorites];
        const fi = favs.indexOf(instId);
        if (fi >= 0) favs.splice(fi, 1);
        else favs.push(instId);

        this.updateConfig({ favorites: favs });
        this.setContext({ watchlist: wl });
        // fetch ticker for newly added
        if (idx < 0) this.send('fetchTicker', { inst: instId.replace('-SWAP', '') });
      });
    });
  }

  _updateRow(instId) {
    const row = this.el.querySelector(`.ip__row[data-inst="${instId}"]`);
    if (!row) return;
    const price = this._prices[instId];
    if (!price) return;
    const priceEl = row.querySelector('.ip__price');
    const chgEl   = row.querySelector('.ip__chg');
    if (priceEl) priceEl.textContent = '$' + price.last.toLocaleString('en-US', { maximumFractionDigits: 4 });
    if (chgEl) {
      chgEl.textContent = (price.chg >= 0 ? '+' : '') + price.chg.toFixed(2) + '%';
      chgEl.className = 'ip__chg ' + (price.chg >= 0 ? 'ip__chg--up' : 'ip__chg--down');
    }
  }

  _updateActiveRow(prevId, nextId) {
    const prev = this.el.querySelector(`.ip__row[data-inst="${prevId}"]`);
    const next = this.el.querySelector(`.ip__row[data-inst="${nextId}"]`);
    if (prev) { prev.classList.remove('ip__row--active'); prev.querySelector('.ip__dot')?.classList.remove('ip__dot--on'); }
    if (next) { next.classList.add('ip__row--active');    next.querySelector('.ip__dot')?.classList.add('ip__dot--on'); }
  }

  _injectStyles() {
    const id = 'ip-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .ip { display: flex; flex-direction: column; height: 100%; min-height: 300px; font-family: var(--font-mono, 'SF Mono', monospace); }
      .ip__header { display: flex; align-items: center; justify-content: space-between; padding: 0 0 10px; }
      .ip__title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted, #64748b); }
      .ip__count { font-size: 10px; color: var(--text-dim, #334155); }
      .ip__search-wrap { margin-bottom: 10px; }
      .ip__search { width: 100%; box-sizing: border-box; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border, rgba(255,255,255,0.07)); background: rgba(255,255,255,0.04); color: var(--text, #e2e8f0); font-size: 12px; font-family: inherit; outline: none; }
      .ip__search:focus { border-color: rgba(0,229,255,0.4); }
      .ip__list { flex: 1; overflow-y: auto; }
      .ip__group-label { font-size: 10px; color: var(--text-dim, #334155); text-transform: uppercase; letter-spacing: 0.08em; padding: 8px 0 4px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.07)); margin-bottom: 2px; }
      .ip__row { display: flex; align-items: center; gap: 6px; padding: 5px 4px; border-radius: 5px; cursor: pointer; transition: background 0.1s; }
      .ip__row:hover { background: rgba(255,255,255,0.04); }
      .ip__row--active { background: rgba(0,229,255,0.07); }
      .ip__dot { width: 5px; height: 5px; border-radius: 50%; background: transparent; flex-shrink: 0; transition: background 0.2s; }
      .ip__dot--on { background: #00e5ff; }
      .ip__name { flex: 1; font-size: 12px; font-weight: 600; color: var(--text, #e2e8f0); }
      .ip__price { font-size: 11px; color: var(--text-muted, #64748b); text-align: right; min-width: 70px; }
      .ip__chg { font-size: 10px; min-width: 48px; text-align: right; }
      .ip__chg--up   { color: #26a69a; }
      .ip__chg--down { color: #ef5350; }
      .ip__star { background: none; border: none; color: var(--text-dim, #334155); cursor: pointer; font-size: 12px; padding: 0 2px; line-height: 1; flex-shrink: 0; transition: color 0.15s; }
      .ip__star:hover, .ip__star--on { color: #f59e0b; }
      .ip__loading, .ip__empty { font-size: 12px; color: var(--text-dim, #334155); padding: 12px 0; }
    `;
    document.head.appendChild(s);
  }
}
