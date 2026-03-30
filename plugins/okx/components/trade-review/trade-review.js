import { Component } from '/core/component.js';

/**
 * trade-review — Standalone panel showing the latest trade review + Claude analysis.
 * Triggered when any other component (e.g. history) sends a tradeReview action.
 * Also shows tradeReviewClaude results.
 */
export default class TradeReviewComponent extends Component {
  static id = 'trade-review';

  async init() {
    this._injectStyles();
    this._ordId = null;
    this._bar   = '15m';

    this.el.innerHTML = `
      <div class="treview">
        <div class="treview__header">
          <span class="treview__title">Trade Review</span>
          <div class="treview__bars" id="${this.el.id}-bars">
            ${['15m','1H','4H','1D'].map(b =>
              `<button class="treview__bar-btn${b==='15m'?' treview__bar-btn--active':''}" data-bar="${b}">${b}</button>`
            ).join('')}
          </div>
        </div>
        <div id="${this.el.id}-body" class="treview__body">
          <div class="treview__placeholder">Click <em>Review</em> on any order in the History panel to start.</div>
        </div>
      </div>
    `;

    // Bar selector
    this.el.querySelectorAll('.treview__bar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._bar = btn.dataset.bar;
        this.el.querySelectorAll('.treview__bar-btn').forEach(b =>
          b.classList.toggle('treview__bar-btn--active', b === btn)
        );
        if (this._ordId) this.send('tradeReview', { ordId: this._ordId, bar: this._bar });
      });
    });

    this.on('tradeReviewData',           (msg) => this._onData(msg));
    this.on('tradeReviewClaude',         (msg) => this._onClaude(msg));
    this.on('tradeReviewClaudeThinking', (msg) => this._onThinking(msg));
    this.on('tradeReviewClaudeError',    (msg) => this._onClaudeError(msg));
    this.on('tradeReviewError',          (msg) => this._onError(msg));
  }

  _onData(msg) {
    this._ordId = msg.ordId;
    const o       = msg.order;
    const pnlVal  = o.pnl + o.fee;
    const pnlColor = pnlVal > 0 ? 'var(--green)' : pnlVal < 0 ? 'var(--red)' : 'var(--text-muted)';
    const pnlStr  = (pnlVal > 0 ? '+' : '') + '$' + pnlVal.toFixed(2);
    const isOpen  = !o.reduceOnly;
    const dir     = o.side === 'buy' ? 'Long' : 'Short';
    const typeLabel = isOpen ? `Open·${dir}` : (o.side === 'sell' ? 'Close Long' : 'Close Short');
    const dt = new Date(o.fillTime || o.cTime);
    const timeStr = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;

    const body = this.el.querySelector(`#${this.el.id}-body`);
    body.innerHTML = `
      <div class="treview__subtitle">${o.instId.replace('-SWAP','')} · ${typeLabel} · ${timeStr}</div>
      <div class="treview__meta">
        <div class="treview__meta-item"><span class="treview__meta-label">Fill Price</span><span class="treview__meta-val">$${o.avgPx.toLocaleString('en-US',{minimumFractionDigits:1})}</span></div>
        <div class="treview__meta-item"><span class="treview__meta-label">Qty</span><span class="treview__meta-val">${o.fillSz} ctrt</span></div>
        <div class="treview__meta-item"><span class="treview__meta-label">Leverage</span><span class="treview__meta-val">${o.lever}×</span></div>
        <div class="treview__meta-item"><span class="treview__meta-label">PnL (fee incl.)</span><span class="treview__meta-val" style="color:${pnlColor};font-weight:700">${pnlStr}</span></div>
        <div class="treview__meta-item"><span class="treview__meta-label">Fee</span><span class="treview__meta-val" style="color:var(--text-muted)">${o.fee.toFixed(3)}</span></div>
      </div>
      ${msg.analysisRaw ? `
        <div class="treview__section-label">Entry Technical Analysis
          <span style="color:var(--text-muted);font-size:10px;margin-left:6px" id="${this.el.id}-ats"></span>
        </div>
        <pre class="treview__pre">${msg.analysisRaw}</pre>
      ` : ''}
      <div class="treview__section-label" style="margin-top:14px">
        Claude Review
        <span id="${this.el.id}-claude-status" style="color:var(--text-muted);font-size:10px;margin-left:6px"></span>
      </div>
      <div id="${this.el.id}-claude-body" class="treview__claude-body">
        Click "Ask Claude Review" to start analysis…
      </div>
      <div style="text-align:right;margin-top:10px">
        <button class="treview__ask-btn" id="${this.el.id}-ask-btn">Ask Claude Review</button>
      </div>
    `;

    if (msg.analysisTs) {
      const d2 = new Date(msg.analysisTs);
      const atsEl = this.el.querySelector(`#${this.el.id}-ats`);
      if (atsEl) atsEl.textContent = `(${d2.getMonth()+1}/${d2.getDate()} ${String(d2.getHours()).padStart(2,'0')}:${String(d2.getMinutes()).padStart(2,'0')})`;
    }

    this.el.querySelector(`#${this.el.id}-ask-btn`).addEventListener('click', () => {
      this.send('tradeReviewClaude', { ordId: this._ordId, bar: this._bar });
    });
  }

  _onThinking({ ordId }) {
    if (ordId !== this._ordId) return;
    const status = this.el.querySelector(`#${this.el.id}-claude-status`);
    const body   = this.el.querySelector(`#${this.el.id}-claude-body`);
    const btn    = this.el.querySelector(`#${this.el.id}-ask-btn`);
    if (status) status.textContent = 'Thinking…';
    if (body)   body.textContent = '…';
    if (btn)    btn.disabled = true;
  }

  _onClaude({ ordId, response }) {
    if (ordId !== this._ordId) return;
    const body   = this.el.querySelector(`#${this.el.id}-claude-body`);
    const status = this.el.querySelector(`#${this.el.id}-claude-status`);
    const btn    = this.el.querySelector(`#${this.el.id}-ask-btn`);
    if (body) {
      body.style.color = 'var(--text)';
      body.innerHTML = response.replace(/\[([^\]]+)\]/g,
        '<span style="color:var(--blue);font-weight:700">[$1]</span>');
    }
    if (status) status.textContent = 'Done';
    if (btn)    btn.disabled = false;
  }

  _onClaudeError({ ordId, error }) {
    if (ordId !== this._ordId) return;
    const body = this.el.querySelector(`#${this.el.id}-claude-body`);
    const btn  = this.el.querySelector(`#${this.el.id}-ask-btn`);
    if (body) { body.style.color = 'var(--red)'; body.textContent = 'Error: ' + error; }
    if (btn)  btn.disabled = false;
  }

  _onError({ ordId, error }) {
    if (ordId !== this._ordId) return;
    const body = this.el.querySelector(`#${this.el.id}-body`);
    if (body) body.innerHTML = `<div style="color:var(--red);font-size:12px;padding:12px">Error: ${error}</div>`;
  }

  _injectStyles() {
    const id = 'treview-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .treview { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
      .treview__header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
      .treview__title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--text); }
      .treview__bars  { display: flex; gap: 4px; }
      .treview__bar-btn { padding: 3px 9px; border-radius: 5px; border: 1px solid var(--border); background: transparent; color: var(--text-muted); font-size: 11px; cursor: pointer; transition: all .15s; }
      .treview__bar-btn--active { background: rgba(33,150,243,0.15); border-color: var(--blue); color: var(--blue); }
      .treview__body { padding: 14px 16px; }
      .treview__placeholder { font-size: 12px; color: var(--text-muted); padding: 20px 0; text-align: center; }
      .treview__subtitle { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 12px; }
      .treview__meta { display: flex; flex-wrap: wrap; gap: 12px 20px; margin-bottom: 14px; }
      .treview__meta-item { display: flex; flex-direction: column; gap: 2px; }
      .treview__meta-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
      .treview__meta-val { font-size: 13px; font-weight: 600; color: var(--text); }
      .treview__section-label { font-size: 11px; font-weight: 700; color: var(--text); margin-bottom: 6px; }
      .treview__pre { font-size: 11px; line-height: 1.5; white-space: pre-wrap; color: var(--text-muted); background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 4px; padding: 10px; max-height: 160px; overflow-y: auto; margin: 0; }
      .treview__claude-body { font-size: 12px; line-height: 1.6; white-space: pre-wrap; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 4px; padding: 10px; color: var(--text-muted); min-height: 40px; }
      .treview__ask-btn { padding: 7px 20px; border-radius: 6px; border: 1px solid var(--blue); background: rgba(33,150,243,0.1); color: var(--blue); font-size: 12px; font-weight: 700; cursor: pointer; }
      .treview__ask-btn:disabled { opacity: 0.5; cursor: default; }
    `;
    document.head.appendChild(s);
  }
}
