import { Component } from '/core/component.js';

export default class PositionsComponent extends Component {
  static id = 'positions';

  async init() {
    this._injectStyles();
    this._positions  = [];
    this._algoOrders = [];

    this.el.innerHTML = `
      <div class="pos-card">
        <div class="pos-card__header">
          <div class="pos-card__title">Current Positions</div>
          <span class="pos-card__updated" id="pos-updated">—</span>
        </div>
        <div class="pos-card__body" id="pos-body">
          <div class="pos-card__empty">Loading...</div>
        </div>
      </div>
    `;

    this.on('snapshot',   (msg) => this._onSnapshot(msg));
    this.on('algoOrders', (msg) => this._onAlgoOrders(msg));
  }

  _onSnapshot({ data }) {
    if (!data) return;
    this._positions = data.positions || [];
    const el = this.el.querySelector('#pos-updated');
    if (el) el.textContent = 'Just updated';
    this._render();
  }

  _onAlgoOrders({ data }) {
    this._algoOrders = data || [];
    this._render();
  }

  _render() {
    const body = this.el.querySelector('#pos-body');
    if (!body) return;

    if (!this._positions.length) {
      body.innerHTML = '<div class="pos-card__empty">No positions</div>';
      return;
    }

    body.innerHTML = this._positions.map(p => {
      const posNum  = parseFloat(p.pos);
      const isLong  = posNum > 0;
      const upl     = parseFloat(p.upl) || 0;
      const uplRatio = parseFloat(p.uplRatio) || 0;
      const avgPx   = parseFloat(p.avgPx) || 0;
      const markPx  = parseFloat(p.markPx) || 0;
      const lever   = p.lever || '—';
      const mgnMode = p.mgnMode || '—';
      const mgnRatio = parseFloat(p.mgnRatio);

      const uplColor = upl >= 0 ? 'var(--green, #26a69a)' : 'var(--red, #ef5350)';
      const uplStr   = (upl >= 0 ? '+' : '') + '$' + Math.abs(upl).toFixed(2);
      const pctStr   = (uplRatio >= 0 ? '+' : '') + (uplRatio * 100).toFixed(2) + '%';

      const algo   = this._algoOrders.find(a => a.instId === p.instId);
      const slPx   = algo?.slTriggerPx ? parseFloat(algo.slTriggerPx) : null;
      const tpPx   = algo?.tpTriggerPx ? parseFloat(algo.tpTriggerPx) : null;
      const slStr  = slPx ? '$' + slPx.toLocaleString('en-US', { minimumFractionDigits: 1 }) : '—';
      const tpStr  = tpPx ? '$' + tpPx.toLocaleString('en-US', { minimumFractionDigits: 1 }) : '—';

      const mgnRatioStr = !isNaN(mgnRatio) ? (mgnRatio * 100).toFixed(1) + '%' : '—';
      const liqPxStr    = p.liqPx && parseFloat(p.liqPx) > 0
        ? '$' + parseFloat(p.liqPx).toLocaleString('en-US', { minimumFractionDigits: 1 })
        : '—';

      const esc = s => String(s).replace(/'/g, "\\'");

      return `
        <div class="pos-item">
          <div class="pos-item__top">
            <div class="pos-item__inst-col">
              <div class="pos-item__inst">${p.instId.replace('-SWAP', '')}</div>
              <span class="pos-item__badge pos-item__badge--${isLong ? 'long' : 'short'}">${isLong ? 'LONG' : 'SHORT'}</span>
            </div>
            <div class="pos-item__meta">
              <div class="pos-item__detail">${Math.abs(posNum)}ctrt · ${lever}×</div>
              <div class="pos-item__detail">Ent $${avgPx.toLocaleString('en-US', { minimumFractionDigits: 1 })}</div>
              <div class="pos-item__detail">Mk $${markPx.toLocaleString('en-US', { minimumFractionDigits: 1 })}</div>
              <div class="pos-item__detail">Mgn ${mgnMode} · Ratio ${mgnRatioStr}</div>
              ${liqPxStr !== '—' ? `<div class="pos-item__detail pos-item__detail--warn">Liq ${liqPxStr}</div>` : ''}
            </div>
            <div class="pos-item__pnl" style="color:${uplColor}">
              <div class="pos-item__pnl-val">${uplStr}</div>
              <div class="pos-item__pnl-pct">${pctStr}</div>
            </div>
            <div class="pos-item__actions">
              <button class="pos-item__btn pos-item__btn--close"
                data-action="close" data-inst="${esc(p.instId)}">Close</button>
            </div>
          </div>
          <div class="pos-item__bottom">
            <span>SL <span style="color:var(--red,#ef5350)">${slStr}</span></span>
            <span style="opacity:.4">·</span>
            <span>TP <span style="color:var(--green,#26a69a)">${tpStr}</span></span>
          </div>
        </div>
      `;
    }).join('');

    // Attach event listeners
    body.querySelectorAll('[data-action="close"]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.send('closePosition', { inst: btn.dataset.inst });
      });
    });
  }

  _injectStyles() {
    const id = 'pos-card-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .pos-card {
        background: var(--bg-card, #0c1220);
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        border-radius: var(--radius, 6px);
        overflow: hidden;
        font-family: var(--font-mono, 'SF Mono', monospace);
      }
      .pos-card__header {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; align-items: center; justify-content: space-between;
      }
      .pos-card__title   { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text, #e2e8f0); }
      .pos-card__updated { font-size: 11px; color: var(--text-muted, #64748b); }
      .pos-card__empty   { padding: 20px; text-align: center; font-size: 12px; color: var(--text-muted, #64748b); }
      .pos-item {
        padding: 10px 16px;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
      }
      .pos-item:last-child { border-bottom: none; }
      .pos-item__top {
        display: flex; align-items: flex-start; gap: 8px;
      }
      .pos-item__inst-col { display: flex; flex-direction: column; gap: 4px; min-width: 60px; }
      .pos-item__inst     { font-size: 13px; font-weight: 700; color: var(--text, #e2e8f0); white-space: nowrap; }
      .pos-item__badge {
        font-size: 10px; padding: 2px 7px; border-radius: 4px;
        text-transform: uppercase; letter-spacing: 1px; font-weight: 700; white-space: nowrap;
        width: fit-content;
      }
      .pos-item__badge--long  { background: rgba(38,166,154,.12); color: var(--green,#26a69a); border: 1px solid rgba(38,166,154,.2); }
      .pos-item__badge--short { background: rgba(239,83,80,.12);  color: var(--red,#ef5350);   border: 1px solid rgba(239,83,80,.2); }
      .pos-item__meta   { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .pos-item__detail { font-size: 10px; color: var(--text-muted, #64748b); white-space: nowrap; }
      .pos-item__detail--warn { color: var(--red, #ef5350); }
      .pos-item__pnl     { text-align: right; white-space: nowrap; min-width: 70px; }
      .pos-item__pnl-val { font-size: 13px; font-weight: 700; }
      .pos-item__pnl-pct { font-size: 10px; color: var(--text-muted, #64748b); margin-top: 1px; }
      .pos-item__actions { display: flex; flex-direction: column; gap: 4px; align-self: center; }
      .pos-item__btn {
        padding: 3px 8px; border-radius: 5px; font-size: 10px;
        cursor: pointer; white-space: nowrap; font-family: var(--font-mono, monospace);
        transition: .15s;
      }
      .pos-item__btn--close {
        border: 1px solid var(--red, #ef5350);
        background: rgba(239,83,80,.08); color: var(--red, #ef5350);
      }
      .pos-item__btn--close:hover { background: rgba(239,83,80,.18); }
      .pos-item__bottom {
        display: flex; align-items: center; gap: 8px;
        padding: 4px 0 2px; font-size: 10px;
        color: var(--text-muted, #64748b);
      }
    `;
    document.head.appendChild(s);
  }
}
