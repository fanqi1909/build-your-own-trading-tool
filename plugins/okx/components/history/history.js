import { Component } from '/core/component.js';

export default class HistoryComponent extends Component {
  static id = 'history';
  static inputs = ['instrument'];

  async init() {
    this._injectStyles();
    this.el.innerHTML = `
      <div class="history">
        <div class="history__header">
          <span class="history__title">Order History</span>
          <span class="history__count" id="${this.el.id}-count">—</span>
        </div>
        <div id="${this.el.id}-body">
          <div class="history__empty">Loading...</div>
        </div>
      </div>
    `;
    this.on('snapshot', ({ data }) => {
      if (data?.history !== undefined) this._render(data.history);
    });
    // Listen for review response to show inline
    this.on('tradeReviewData',           (msg) => this._onReviewData(msg));
    this.on('tradeReviewClaude',         (msg) => this._onReviewClaude(msg));
    this.on('tradeReviewClaudeThinking', (msg) => this._onReviewThinking(msg));
    this.on('tradeReviewClaudeError',    (msg) => this._onReviewClaudeError(msg));
    this.on('tradeReviewError',          (msg) => this._onReviewError(msg));
    this._activeOrdId = null;

    const ctx = this.getContext();
    this._instrument = ctx.instrument || null;
  }

  onInputChange(key, value) {
    if (key === 'instrument') {
      this._instrument = value;
      this.send('history', { inst: this._instrument });
    }
  }

  _render(history) {
    const body  = this.el.querySelector(`#${this.el.id}-body`);
    const count = this.el.querySelector(`#${this.el.id}-count`);
    if (!history?.length) {
      body.innerHTML = '<div class="history__empty">No order history</div>';
      if (count) count.textContent = '0 orders';
      return;
    }
    if (count) count.textContent = history.length + ' orders';

    const rows = history.map(o => {
      const isClose   = o.reduceOnly;
      const sideLabel = isClose
        ? (o.side === 'sell' ? 'Close Long' : 'Close Short')
        : (o.side === 'buy'  ? 'Open Long'  : 'Open Short');
      const sideClass = isClose ? 'history__side--close' : 'history__side--open';
      const pnlVal    = o.pnl + o.fee;
      const pnlClass  = pnlVal > 0 ? 'history__pnl--pos' : pnlVal < 0 ? 'history__pnl--neg' : 'history__pnl--zero';
      const pnlStr    = pnlVal === 0 ? '—' : (pnlVal > 0 ? '+' : '') + '$' + pnlVal.toFixed(2);
      const dt        = new Date(o.fillTime || o.cTime);
      const timeStr   = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
      const px        = o.avgPx ? '$' + o.avgPx.toLocaleString('en-US', { minimumFractionDigits: 1 }) : '—';
      const reviewBtn = o.state === 'filled'
        ? `<button class="history__review-btn" data-ordid="${o.ordId}">Review</button>`
        : '';
      return `<tr data-ordid="${o.ordId}">
        <td class="history__td history__td--time">${timeStr}</td>
        <td class="history__td">${o.instId.replace('-SWAP','')}</td>
        <td class="history__td"><span class="history__side ${sideClass}">${sideLabel}</span></td>
        <td class="history__td">${o.fillSz}</td>
        <td class="history__td history__td--muted">${px}</td>
        <td class="history__td history__td--muted">${o.lever}×</td>
        <td class="history__td ${pnlClass}">${pnlStr}</td>
        <td class="history__td history__td--fee">${o.fee.toFixed(3)}</td>
        <td class="history__td">${reviewBtn}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div style="overflow-x:auto">
        <table class="history__table">
          <thead><tr>
            <th class="history__th">Time</th>
            <th class="history__th">Contract</th>
            <th class="history__th">Side</th>
            <th class="history__th">Qty</th>
            <th class="history__th">Avg Px</th>
            <th class="history__th">Lever</th>
            <th class="history__th">PnL</th>
            <th class="history__th">Fee</th>
            <th class="history__th"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div id="${this.el.id}-review" class="history__review" style="display:none"></div>
    `;

    body.querySelectorAll('.history__review-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ordId = btn.dataset.ordid;
        this._openReview(ordId);
      });
    });
  }

  _openReview(ordId) {
    this._activeOrdId = ordId;
    const panel = this.el.querySelector(`#${this.el.id}-review`);
    if (panel) {
      panel.style.display = 'block';
      panel.innerHTML = `<div class="history__review-loading">Loading trade data…</div>`;
    }
    this.send('tradeReview', { ordId, bar: '15m' });
  }

  _onReviewData(msg) {
    if (msg.ordId !== this._activeOrdId) return;
    const o       = msg.order;
    const pnlVal  = o.pnl + o.fee;
    const pnlColor = pnlVal > 0 ? 'var(--green)' : pnlVal < 0 ? 'var(--red)' : 'var(--text-muted)';
    const pnlStr  = (pnlVal > 0 ? '+' : '') + '$' + pnlVal.toFixed(2);
    const isOpen  = !o.reduceOnly;
    const dir     = o.side === 'buy' ? 'Long' : 'Short';
    const typeLabel = isOpen ? `Open·${dir}` : (o.side === 'sell' ? 'Close Long' : 'Close Short');

    const panel = this.el.querySelector(`#${this.el.id}-review`);
    if (!panel) return;
    panel.innerHTML = `
      <div class="history__review-header">
        <span class="history__review-title">${o.instId.replace('-SWAP','')} · ${typeLabel}</span>
        <button class="history__review-close">✕</button>
      </div>
      <div class="history__review-meta">
        <span>Fill <strong>$${o.avgPx.toLocaleString('en-US',{minimumFractionDigits:1})}</strong></span>
        <span>${o.fillSz} ctrt · ${o.lever}×</span>
        <span style="color:${pnlColor};font-weight:700">${pnlStr}</span>
      </div>
      ${msg.analysisRaw ? `<pre class="history__review-pre">${msg.analysisRaw}</pre>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">
        <span id="${this.el.id}-review-status" style="font-size:11px;color:var(--text-muted)"></span>
        <button class="history__ask-btn" id="${this.el.id}-ask-btn">Ask Claude Review</button>
      </div>
      <div id="${this.el.id}-claude-body" class="history__claude-body" style="display:none"></div>
    `;
    panel.querySelector('.history__review-close').addEventListener('click', () => {
      panel.style.display = 'none';
      this._activeOrdId = null;
    });
    panel.querySelector(`#${this.el.id}-ask-btn`).addEventListener('click', () => {
      this.send('tradeReviewClaude', { ordId: msg.ordId, bar: msg.bar || '15m' });
    });
  }

  _onReviewThinking({ ordId }) {
    if (ordId !== this._activeOrdId) return;
    const status = this.el.querySelector(`#${this.el.id}-review-status`);
    const body   = this.el.querySelector(`#${this.el.id}-claude-body`);
    const btn    = this.el.querySelector(`#${this.el.id}-ask-btn`);
    if (status) status.textContent = 'Claude is thinking…';
    if (body)   { body.style.display = 'block'; body.textContent = '…'; body.style.color = 'var(--text-muted)'; }
    if (btn)    btn.disabled = true;
  }

  _onReviewClaude({ ordId, response }) {
    if (ordId !== this._activeOrdId) return;
    const body   = this.el.querySelector(`#${this.el.id}-claude-body`);
    const status = this.el.querySelector(`#${this.el.id}-review-status`);
    const btn    = this.el.querySelector(`#${this.el.id}-ask-btn`);
    if (body) {
      body.style.display = 'block';
      body.style.color = 'var(--text)';
      body.innerHTML = response.replace(/\[([^\]]+)\]/g,
        '<span style="color:var(--blue);font-weight:700">[$1]</span>');
    }
    if (status) status.textContent = 'Analysis complete';
    if (btn)    btn.disabled = false;
  }

  _onReviewClaudeError({ ordId, error }) {
    if (ordId !== this._activeOrdId) return;
    const body = this.el.querySelector(`#${this.el.id}-claude-body`);
    const btn  = this.el.querySelector(`#${this.el.id}-ask-btn`);
    if (body) { body.style.display = 'block'; body.style.color = 'var(--red)'; body.textContent = 'Error: ' + error; }
    if (btn)  btn.disabled = false;
  }

  _onReviewError({ ordId, error }) {
    if (ordId !== this._activeOrdId) return;
    const panel = this.el.querySelector(`#${this.el.id}-review`);
    if (panel) panel.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px">Error: ${error}</div>`;
  }

  _injectStyles() {
    const id = 'history-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .history { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
      .history__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
      .history__title  { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text); }
      .history__count  { font-size: 11px; color: var(--text-muted); }
      .history__table  { width: 100%; border-collapse: collapse; font-size: 12px; }
      .history__th     { padding: 7px 10px; text-align: left; font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); white-space: nowrap; }
      .history__td     { padding: 7px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); white-space: nowrap; color: var(--text); }
      .history__td--time { color: var(--text-muted); font-size: 11px; }
      .history__td--muted { color: var(--text-muted); }
      .history__td--fee { color: var(--text-muted); font-size: 11px; }
      .history__side { padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; }
      .history__side--open  { background: rgba(38,166,154,0.12); color: var(--green); }
      .history__side--close { background: rgba(239,83,80,0.12); color: var(--red); }
      .history__pnl--pos  { color: var(--green); font-weight: 700; }
      .history__pnl--neg  { color: var(--red); font-weight: 700; }
      .history__pnl--zero { color: var(--text-muted); }
      .history__empty { padding: 28px; text-align: center; font-size: 12px; color: var(--text-muted); }
      .history__review-btn { padding: 2px 8px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--blue); font-size: 10px; cursor: pointer; transition: border-color .15s, color .15s; }
      .history__review-btn:hover { border-color: var(--blue); }
      .history__review { border-top: 1px solid var(--border); padding: 14px 16px; }
      .history__review-loading { font-size: 12px; color: var(--text-muted); }
      .history__review-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .history__review-title { font-size: 13px; font-weight: 700; color: var(--text); }
      .history__review-close { background: transparent; border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; border-radius: 4px; padding: 2px 7px; font-size: 11px; }
      .history__review-meta { display: flex; gap: 16px; font-size: 12px; color: var(--text-muted); margin-bottom: 10px; }
      .history__review-pre { font-size: 11px; line-height: 1.5; white-space: pre-wrap; color: var(--text-muted); background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 4px; padding: 10px; max-height: 160px; overflow-y: auto; margin: 0; }
      .history__ask-btn { padding: 6px 16px; border-radius: 6px; border: 1px solid var(--blue); background: rgba(33,150,243,0.1); color: var(--blue); font-size: 11px; font-weight: 700; cursor: pointer; }
      .history__ask-btn:disabled { opacity: 0.5; cursor: default; }
      .history__claude-body { margin-top: 10px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 4px; padding: 10px; }
    `;
    document.head.appendChild(s);
  }
}
