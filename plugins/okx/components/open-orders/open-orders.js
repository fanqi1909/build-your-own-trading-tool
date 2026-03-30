import { Component } from '/core/component.js';

export default class OpenOrdersComponent extends Component {
  static id = 'open-orders';

  async init() {
    this._injectStyles();
    this.el.innerHTML = `
      <div class="oo-card">
        <div class="oo-card__header">
          <div class="oo-card__title">
            Open Orders
            <span class="oo-card__badge" id="oo-badge"></span>
          </div>
          <button class="oo-card__cancel-all" id="oo-cancel-all">Cancel All</button>
        </div>
        <div class="oo-card__body" id="oo-body">
          <div class="oo-card__empty">No open orders</div>
        </div>
      </div>
    `;

    this._orders = [];

    this.el.querySelector('#oo-cancel-all').addEventListener('click', () => {
      this._orders.forEach(o => this.send('cancelOrder', { inst: o.instId, ordId: o.ordId }));
    });

    this.on('openOrders', (msg) => this.update(msg));
  }

  update({ data }) {
    this._orders = data || [];
    const badge = this.el.querySelector('#oo-badge');
    if (badge) badge.textContent = this._orders.length ? `(${this._orders.length})` : '';

    const body = this.el.querySelector('#oo-body');
    if (!body) return;

    if (!this._orders.length) {
      body.innerHTML = '<div class="oo-card__empty">No open orders</div>';
      return;
    }

    body.innerHTML = this._orders.map(o => {
      const sideColor = o.side === 'buy' ? 'var(--green, #26a69a)' : 'var(--red, #ef5350)';
      const typeLabel = o.ordType === 'post_only' ? 'Post-only' : (o.ordType || '—');
      const fillPct   = o.sz > 0 ? Math.round((parseFloat(o.fillSz) || 0) / parseFloat(o.sz) * 100) : 0;
      const px        = parseFloat(o.px) || 0;
      const esc       = s => String(s).replace(/'/g, "\\'");
      return `
        <div class="oo-row" id="oo-row-${o.ordId}">
          <div class="oo-row__main">
            <span class="oo-row__side" style="color:${sideColor}">${o.side === 'buy' ? 'Buy' : 'Sell'}</span>
            <span class="oo-row__inst">${(o.instId || '').replace('-SWAP', '')}</span>
            <span class="oo-row__sz">${o.sz}ctrt</span>
            <span class="oo-row__px" style="color:#00e5ff">@${px.toLocaleString('en-US', { minimumFractionDigits: 1 })}</span>
            <span class="oo-row__type">${typeLabel}</span>
            ${fillPct > 0 ? `<span class="oo-row__fill">${fillPct}% filled</span>` : ''}
            <div class="oo-row__btns">
              <button class="oo-row__btn oo-row__btn--amend" data-action="amend"
                data-inst="${esc(o.instId)}" data-ordid="${esc(o.ordId)}"
                data-px="${px}" data-sz="${o.sz}">Amend</button>
              <button class="oo-row__btn oo-row__btn--cancel" data-action="cancel"
                data-inst="${esc(o.instId)}" data-ordid="${esc(o.ordId)}">Cancel</button>
            </div>
          </div>
          <div class="oo-row__amend-form" id="oo-amend-${o.ordId}" style="display:none">
            <span class="oo-form-label">Price</span>
            <input class="oo-form-input" type="number" step="0.1" value="${px}"
              id="oo-amend-px-${o.ordId}" style="width:90px">
            <span class="oo-form-label">Qty</span>
            <input class="oo-form-input" type="number" min="1" value="${o.sz}"
              id="oo-amend-sz-${o.ordId}" style="width:60px">
            <button class="oo-row__btn oo-row__btn--confirm"
              data-action="amend-confirm"
              data-inst="${esc(o.instId)}" data-ordid="${esc(o.ordId)}"
              data-side="${esc(o.side)}" data-ordtype="${esc(o.ordType)}">Confirm</button>
            <button class="oo-row__btn" data-action="amend-close" data-ordid="${esc(o.ordId)}">Cancel</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach listeners
    body.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => this._handleBtnClick(btn));
    });
  }

  _handleBtnClick(btn) {
    const { action, inst, ordid, px, sz, side, ordtype } = btn.dataset;
    if (action === 'cancel') {
      this.send('cancelOrder', { inst, ordId: ordid });
    } else if (action === 'amend') {
      const form = this.el.querySelector(`#oo-amend-${ordid}`);
      if (form) form.style.display = form.style.display === 'none' ? 'flex' : 'none';
    } else if (action === 'amend-close') {
      const form = this.el.querySelector(`#oo-amend-${ordid}`);
      if (form) form.style.display = 'none';
    } else if (action === 'amend-confirm') {
      const newPx = parseFloat(this.el.querySelector(`#oo-amend-px-${ordid}`)?.value) || undefined;
      const newSz = parseFloat(this.el.querySelector(`#oo-amend-sz-${ordid}`)?.value) || undefined;
      this.send('amendOrder', { inst, ordId: ordid, newPx, newSz, side, ordType: ordtype });
      const form = this.el.querySelector(`#oo-amend-${ordid}`);
      if (form) form.style.display = 'none';
    }
  }

  _injectStyles() {
    const id = 'oo-card-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .oo-card {
        background: var(--bg-card, #0c1220);
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        border-radius: var(--radius, 6px);
        overflow: hidden;
        font-family: var(--font-mono, 'SF Mono', monospace);
      }
      .oo-card__header {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; align-items: center; justify-content: space-between;
      }
      .oo-card__title  { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text, #e2e8f0); display: flex; align-items: center; gap: 6px; }
      .oo-card__badge  { font-size: 11px; color: #00e5ff; }
      .oo-card__cancel-all {
        padding: 2px 8px; border-radius: 4px;
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        background: transparent; color: var(--text-muted, #64748b);
        font-size: 10px; cursor: pointer;
        font-family: var(--font-mono, monospace);
      }
      .oo-card__cancel-all:hover { color: var(--red, #ef5350); border-color: var(--red, #ef5350); }
      .oo-card__empty { padding: 16px; text-align: center; font-size: 12px; color: var(--text-muted, #64748b); }
      .oo-row { border-bottom: 1px solid var(--border, rgba(255,255,255,0.07)); }
      .oo-row:last-child { border-bottom: none; }
      .oo-row__main {
        display: flex; align-items: center; gap: 8px;
        padding: 7px 14px; font-size: 11px; flex-wrap: wrap;
      }
      .oo-row__side   { font-weight: 700; min-width: 26px; }
      .oo-row__inst   { color: var(--text, #e2e8f0); }
      .oo-row__sz     { color: var(--text-muted, #64748b); }
      .oo-row__px     {}
      .oo-row__type   { color: var(--text-muted, #64748b); font-size: 10px; }
      .oo-row__fill   { color: #f59e0b; font-size: 10px; }
      .oo-row__btns   { margin-left: auto; display: flex; gap: 4px; }
      .oo-row__btn {
        padding: 2px 8px; border-radius: 4px;
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        background: transparent; font-size: 10px; cursor: pointer;
        font-family: var(--font-mono, monospace); color: var(--text-muted, #64748b);
        transition: .15s;
      }
      .oo-row__btn--amend:hover  { color: #00e5ff; border-color: #00e5ff; }
      .oo-row__btn--cancel:hover { color: var(--red, #ef5350); border-color: var(--red, #ef5350); }
      .oo-row__btn--confirm { background: #00e5ff; color: #050810; border-color: #00e5ff; }
      .oo-row__amend-form {
        padding: 6px 14px; background: rgba(255,255,255,0.02);
        gap: 6px; align-items: center; font-size: 11px; flex-wrap: wrap;
      }
      .oo-form-label { color: var(--text-muted, #64748b); }
      .oo-form-input {
        padding: 3px 5px; border-radius: 4px;
        background: var(--bg, #050810); border: 1px solid var(--border, rgba(255,255,255,0.07));
        color: var(--text, #e2e8f0); font-size: 11px;
        font-family: var(--font-mono, monospace); outline: none;
      }
      .oo-form-input:focus { border-color: rgba(0,229,255,.4); }
    `;
    document.head.appendChild(s);
  }
}
