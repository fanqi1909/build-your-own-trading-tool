import { Component } from '/core/component.js';

const COIN_STYLE = {
  BTC:  { bg: 'rgba(247,147,26,.15)',  color: '#f7931a', label: '₿' },
  ETH:  { bg: 'rgba(98,126,234,.15)',  color: '#627eea', label: 'Ξ' },
  OKB:  { bg: 'rgba(0,100,255,.15)',   color: '#4d90fe', label: 'OK' },
  USDT: { bg: 'rgba(38,161,123,.15)',  color: '#26a17b', label: '$' },
  USDC: { bg: 'rgba(38,161,123,.15)',  color: '#26a17b', label: '$' },
};
const COIN_FALLBACK = { bg: 'rgba(100,116,139,.15)', color: '#94a3b8', label: '?' };

export default class BalanceComponent extends Component {
  static id = 'balance';

  async init() {
    this._injectStyles();
    this.el.innerHTML = `
      <div class="balance">
        <div class="balance__header">
          <div class="balance__title">Portfolio</div>
        </div>
        <div class="balance__total">
          <div class="balance__total-label">Total Equity</div>
          <div class="balance__total-value" id="balance-total">—</div>
          <div class="balance__total-mode" id="balance-mode">— Mode</div>
        </div>
        <div class="balance__donut-wrap">
          <canvas class="balance__donut" id="balance-donut" width="130" height="130"></canvas>
          <div class="balance__legend" id="balance-legend"></div>
        </div>
        <div class="balance__list" id="balance-list">
          <div class="balance__empty">No balance data</div>
        </div>
      </div>
    `;

    this.on('snapshot', (msg) => this.update(msg));
  }

  update({ data, mode }) {
    if (!data) return;
    const balances = data.balance || [];

    const totalUsd = balances.reduce((s, b) => s + (parseFloat(b.eqUsd) || 0), 0);

    const totalEl = this.el.querySelector('#balance-total');
    if (totalEl) totalEl.textContent = '$' + totalUsd.toLocaleString('en-US', { maximumFractionDigits: 0 });

    const modeEl = this.el.querySelector('#balance-mode');
    if (modeEl) modeEl.textContent = mode === 'live' ? 'Live Mode' : 'Demo Mode';

    if (!balances.length) {
      const listEl = this.el.querySelector('#balance-list');
      if (listEl) listEl.innerHTML = '<div class="balance__empty">No balance data</div>';
      return;
    }

    const sorted = [...balances].sort((a, b) => (parseFloat(b.eqUsd) || 0) - (parseFloat(a.eqUsd) || 0));
    const COLORS  = ['#f7931a', '#627eea', '#4d90fe', '#26a17b', '#a3e635', '#f59e0b'];

    // Holdings list
    const listEl = this.el.querySelector('#balance-list');
    if (listEl) {
      listEl.innerHTML = sorted.map(b => {
        const s   = COIN_STYLE[b.ccy] || COIN_FALLBACK;
        const eq  = parseFloat(b.eq)    || 0;
        const eqUsd = parseFloat(b.eqUsd) || 0;
        const avail = parseFloat(b.availBal) || 0;
        const pct = totalUsd > 0 ? (eqUsd / totalUsd * 100) : 0;
        return `
          <div class="balance__row">
            <div class="balance__row-left">
              <div class="balance__coin-badge" style="background:${s.bg};color:${s.color}">${s.label}</div>
              <div>
                <div class="balance__coin-name">${b.ccy}</div>
                <div class="balance__coin-amt">${eq.toFixed(4)} · avail ${avail.toFixed(4)}</div>
              </div>
            </div>
            <div class="balance__row-right">
              <div class="balance__usd">$${eqUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
              <div class="balance__pct">${pct.toFixed(1)}%</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Legend
    const legendEl = this.el.querySelector('#balance-legend');
    if (legendEl) {
      legendEl.innerHTML = sorted.map((b, i) => {
        const eqUsd = parseFloat(b.eqUsd) || 0;
        const pct = totalUsd > 0 ? (eqUsd / totalUsd * 100) : 0;
        return `<div class="balance__leg-item">
          <div class="balance__leg-dot" style="background:${COLORS[i % COLORS.length]}"></div>
          ${b.ccy} ${pct.toFixed(1)}%
        </div>`;
      }).join('');
    }

    // Donut
    this._drawDonut(sorted.map((b, i) => ({
      pct:   totalUsd > 0 ? (parseFloat(b.eqUsd) || 0) / totalUsd : 0,
      color: COLORS[i % COLORS.length],
    })), totalUsd);
  }

  _drawDonut(slices, totalUsd) {
    const c = this.el.querySelector('#balance-donut');
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.width = 130 * dpr; c.height = 130 * dpr;
    ctx.scale(dpr, dpr);
    const cx = 65, cy = 65, r = 50, lw = 13;
    let start = -Math.PI / 2;
    slices.forEach(s => {
      const end = start + s.pct * 2 * Math.PI;
      ctx.beginPath(); ctx.arc(cx, cy, r, start, end);
      ctx.strokeStyle = s.color; ctx.lineWidth = lw; ctx.stroke();
      start = end + 0.012;
    });
    ctx.fillStyle = 'rgba(226,232,240,0.9)';
    ctx.font = 'bold 14px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('$' + Math.round(totalUsd / 1000) + 'K', cx, cy - 6);
    ctx.font = '10px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(100,116,139,0.8)';
    ctx.fillText('portfolio', cx, cy + 10);
  }

  _injectStyles() {
    const id = 'balance-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .balance {
        background: var(--bg-card, #0c1220);
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        border-radius: var(--radius, 6px);
        overflow: hidden;
        font-family: var(--font-mono, 'SF Mono', monospace);
      }
      .balance__header {
        padding: 14px 18px;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
      }
      .balance__title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text, #e2e8f0); }
      .balance__total {
        padding: 20px 18px; text-align: center;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
      }
      .balance__total-label { font-size: 10px; color: var(--text-muted, #64748b); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
      .balance__total-value { font-size: 30px; font-weight: 800; letter-spacing: -1px; color: #00e5ff; }
      .balance__total-mode  { font-size: 10px; color: var(--text-muted, #64748b); margin-top: 4px; }
      .balance__donut-wrap  { padding: 16px; display: flex; flex-direction: column; align-items: center; }
      .balance__donut       { width: 130px; height: 130px; }
      .balance__legend      { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 12px; }
      .balance__leg-item    { display: flex; align-items: center; gap: 5px; font-size: 10px; color: var(--text-muted, #64748b); }
      .balance__leg-dot     { width: 7px; height: 7px; border-radius: 50%; }
      .balance__list        {}
      .balance__empty       { padding: 20px; text-align: center; font-size: 12px; color: var(--text-muted, #64748b); }
      .balance__row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 18px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
        transition: background .15s;
      }
      .balance__row:last-child { border-bottom: none; }
      .balance__row:hover { background: rgba(255,255,255,0.02); }
      .balance__row-left  { display: flex; align-items: center; gap: 10px; }
      .balance__coin-badge {
        width: 32px; height: 32px; border-radius: 9px;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 700;
      }
      .balance__coin-name { font-size: 13px; font-weight: 700; color: var(--text, #e2e8f0); }
      .balance__coin-amt  { font-size: 10px; color: var(--text-muted, #64748b); margin-top: 1px; }
      .balance__row-right { text-align: right; }
      .balance__usd       { font-size: 13px; font-weight: 700; color: var(--text, #e2e8f0); }
      .balance__pct       { font-size: 10px; color: var(--text-muted, #64748b); margin-top: 1px; }
    `;
    document.head.appendChild(s);
  }
}
