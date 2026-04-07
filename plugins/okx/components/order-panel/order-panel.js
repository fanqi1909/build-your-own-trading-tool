import { Component } from '/core/component.js';

export default class OrderPanelComponent extends Component {
  static id = 'order-panel';
  static inputs = ['instrument'];

  async init() {
    this._injectStyles();
    this._side = 'buy';
    this._ordType = 'limit';
    this._lastPrice = null;
    this._instrument = this.getContext().instrument || 'BTC-USDT-SWAP';

    this.el.innerHTML = `
      <div class="op-card">
        <div class="op-card__header">
          <div class="op-card__title">Quick Order</div>
          <span class="op-card__auto-tag" id="op-auto-tag"></span>
        </div>
        <div class="op-card__body">
          <div class="op-field-row">
            <label class="op-label">Inst</label>
            <div class="op-inst" id="op-inst">${this._formatInst(this._instrument)}</div>
          </div>
          <div class="op-row">
            <button class="op-side-btn op-side-btn--active-buy" id="op-side-buy" data-side="buy">Long</button>
            <button class="op-side-btn" id="op-side-sell" data-side="sell">Short</button>
            <button class="op-type-btn op-type-btn--active" data-type="limit">Limit</button>
            <button class="op-type-btn" data-type="market">Market</button>
            <button class="op-type-btn" data-type="post_only">Post</button>
          </div>
          <div class="op-field-row" id="op-px-row">
            <label class="op-label">Price</label>
            <input class="op-input" id="op-px" type="number" step="0.1" placeholder="Limit price">
            <button class="op-util-btn" id="op-latest-px">Latest</button>
          </div>
          <div class="op-field-row">
            <label class="op-label">Qty</label>
            <input class="op-input op-input--lg" id="op-sz" type="number" min="1" value="1">
            <span class="op-unit">ctrt</span>
          </div>
          <div class="op-field-row">
            <label class="op-label">Lever</label>
            <div class="op-lever-btns">
              <button class="op-util-btn" data-lever="3">3x</button>
              <button class="op-util-btn" data-lever="5">5x</button>
              <button class="op-util-btn" data-lever="10">10x</button>
              <button class="op-util-btn" data-lever="20">20x</button>
            </div>
            <input class="op-input op-input--lg" id="op-lever" type="number" min="1" max="125" value="10">
          </div>
          <div class="op-row op-row--sltp">
            <div class="op-sltp-field">
              <label class="op-label op-label--red">SL</label>
              <input class="op-input" id="op-sl" type="number" step="0.1" placeholder="optional">
            </div>
            <div class="op-sltp-field">
              <label class="op-label op-label--green">TP</label>
              <input class="op-input" id="op-tp" type="number" step="0.1" placeholder="optional">
            </div>
          </div>
          <button class="op-submit op-submit--buy" id="op-submit">Confirm Long</button>
          <div class="op-result" id="op-result" style="display:none"></div>
        </div>
        <div class="op-stream" id="op-stream" style="display:none"></div>
      </div>
    `;

    this._bindEvents();
    this.on('ticker', (msg) => this._onTicker(msg));
    this.on('orderStream', (msg) => this._onOrderStream(msg));
    this.on('orderResult', (msg) => this._onOrderResult(msg));
    this.onContextChange(({ context, changedKeys }) => {
      if (!changedKeys?.includes('instrument')) return;
      this._instrument = context.instrument || this._instrument;
      const instEl = this.el.querySelector('#op-inst');
      if (instEl) instEl.textContent = this._formatInst(this._instrument);
    });
  }

  _formatInst(inst) {
    return (inst || '').replace('-SWAP', '');
  }

  _bindEvents() {
    this.el.querySelectorAll('[data-side]').forEach(btn => btn.addEventListener('click', () => this._setSide(btn.dataset.side)));
    this.el.querySelectorAll('[data-type]').forEach(btn => btn.addEventListener('click', () => this._setType(btn.dataset.type)));
    this.el.querySelectorAll('[data-lever]').forEach(btn => {
      btn.addEventListener('click', () => {
        const leverEl = this.el.querySelector('#op-lever');
        if (leverEl) leverEl.value = btn.dataset.lever;
      });
    });
    this.el.querySelector('#op-latest-px')?.addEventListener('click', () => {
      if (this._lastPrice) {
        const pxEl = this.el.querySelector('#op-px');
        if (pxEl) pxEl.value = this._lastPrice.toFixed(1);
      }
    });
    this.el.querySelector('#op-submit')?.addEventListener('click', () => this._submit());
  }

  _setSide(side) {
    this._side = side;
    const buyBtn = this.el.querySelector('#op-side-buy');
    const sellBtn = this.el.querySelector('#op-side-sell');
    const submit = this.el.querySelector('#op-submit');
    if (buyBtn) buyBtn.className = 'op-side-btn' + (side === 'buy' ? ' op-side-btn--active-buy' : '');
    if (sellBtn) sellBtn.className = 'op-side-btn' + (side === 'sell' ? ' op-side-btn--active-sell' : '');
    if (submit) {
      submit.className = 'op-submit ' + (side === 'buy' ? 'op-submit--buy' : 'op-submit--sell');
      submit.textContent = side === 'buy' ? 'Confirm Long' : 'Confirm Short';
    }
  }

  _setType(type) {
    this._ordType = type;
    this.el.querySelectorAll('[data-type]').forEach(btn => btn.classList.toggle('op-type-btn--active', btn.dataset.type === type));
    const pxRow = this.el.querySelector('#op-px-row');
    if (pxRow) pxRow.style.display = type === 'market' ? 'none' : '';
  }

  _onTicker({ data }) {
    if (data?.last) this._lastPrice = parseFloat(data.last);
  }

  _submit() {
    const sz = parseFloat(this.el.querySelector('#op-sz')?.value);
    const lever = parseInt(this.el.querySelector('#op-lever')?.value) || 10;
    const sl = parseFloat(this.el.querySelector('#op-sl')?.value) || undefined;
    const tp = parseFloat(this.el.querySelector('#op-tp')?.value) || undefined;
    const px = this._ordType !== 'market' ? (parseFloat(this.el.querySelector('#op-px')?.value) || undefined) : undefined;

    if (!sz || sz < 1) return;
    if (this._ordType !== 'market' && !px) return;

    const streamEl = this.el.querySelector('#op-stream');
    if (streamEl) { streamEl.style.display = ''; streamEl.textContent = 'Ordering...'; }

    const submitBtn = this.el.querySelector('#op-submit');
    if (submitBtn) submitBtn.disabled = true;

    this.send('placeOrder', {
      inst: this._instrument,
      side: this._side,
      sz,
      ordType: this._ordType,
      px,
      lever,
      sl,
      tp,
    });
  }

  _onOrderStream({ chunk }) {
    const streamEl = this.el.querySelector('#op-stream');
    if (!streamEl) return;
    streamEl.style.display = '';
    if (!streamEl.dataset.streaming) {
      streamEl.textContent = '';
      streamEl.style.color = 'var(--text-muted, #64748b)';
      streamEl.dataset.streaming = '1';
    }
    streamEl.textContent += chunk;
    streamEl.scrollTop = streamEl.scrollHeight;
  }

  _onOrderResult({ success, error }) {
    const streamEl = this.el.querySelector('#op-stream');
    if (streamEl) delete streamEl.dataset.streaming;
    const submitBtn = this.el.querySelector('#op-submit');
    if (submitBtn) submitBtn.disabled = false;

    if (streamEl) {
      if (success) {
        streamEl.style.color = 'var(--green, #26a69a)';
        streamEl.textContent += '\n✓ Done';
      } else {
        streamEl.style.color = 'var(--red, #ef5350)';
        streamEl.textContent = '✗ ' + error;
      }
    }
  }

  _injectStyles() {
    const id = 'op-card-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .op-card { background: var(--bg-card, #0c1220); border: 1px solid var(--border, rgba(255,255,255,0.07)); border-radius: var(--radius, 6px); overflow: hidden; font-family: var(--font-mono, 'SF Mono', monospace); }
      .op-card__header { padding: 12px 14px; border-bottom: 1px solid var(--border, rgba(255,255,255,0.07)); display: flex; align-items: center; justify-content: space-between; }
      .op-card__title { font-size: 11px; color: var(--text-muted, #64748b); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
      .op-card__auto-tag { font-size: 10px; color: #00e5ff; }
      .op-card__body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
      .op-row { display: flex; gap: 6px; }
      .op-row--sltp { gap: 8px; }
      .op-field-row { display: flex; align-items: center; gap: 6px; }
      .op-label { font-size: 11px; color: var(--text-muted, #64748b); min-width: 38px; }
      .op-inst { flex: 1; font-size: 12px; font-weight: 700; color: var(--text, #e2e8f0); }
      .op-label--red { color: var(--red, #ef5350); }
      .op-label--green { color: var(--green, #26a69a); }
      .op-input { flex: 1; padding: 4px 6px; border-radius: 4px; font-size: 12px; background: rgba(255,255,255,.05); border: 1px solid var(--border, rgba(255,255,255,0.07)); color: var(--text, #e2e8f0); font-family: var(--font-mono, monospace); outline: none; }
      .op-input--lg { font-size: 15px; font-weight: 600; padding: 5px 8px; }
      .op-input:focus { border-color: rgba(0,229,255,.4); }
      .op-unit { font-size: 12px; color: var(--text-muted, #64748b); }
      .op-side-btn { flex: 1; padding: 5px; border-radius: 4px; font-size: 12px; cursor: pointer; background: rgba(255,255,255,.05); color: var(--text-muted, #64748b); border: 1px solid var(--border, rgba(255,255,255,0.07)); font-family: var(--font-mono, monospace); transition: .15s; }
      .op-side-btn--active-buy { background: var(--green, #26a69a); color: #fff; border-color: var(--green, #26a69a); }
      .op-side-btn--active-sell { background: var(--red, #ef5350); color: #fff; border-color: var(--red, #ef5350); }
      .op-type-btn { flex: 1; padding: 4px; border-radius: 4px; font-size: 11px; cursor: pointer; background: rgba(255,255,255,.05); color: var(--text-muted, #64748b); border: 1px solid var(--border, rgba(255,255,255,0.07)); font-family: var(--font-mono, monospace); transition: .15s; }
      .op-type-btn--active { border-color: #00e5ff; color: #00e5ff; background: rgba(0,229,255,.08); }
      .op-util-btn { padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border, rgba(255,255,255,0.07)); background: rgba(255,255,255,.05); color: var(--text-muted, #64748b); font-size: 11px; cursor: pointer; font-family: var(--font-mono, monospace); }
      .op-lever-btns { display: flex; gap: 4px; }
      .op-sltp-field { flex: 1; display: flex; align-items: center; gap: 6px; }
      .op-submit { margin-top: 4px; padding: 8px 10px; border-radius: 6px; border: none; font-weight: 700; font-size: 12px; cursor: pointer; font-family: var(--font-mono, monospace); }
      .op-submit--buy { background: var(--green, #26a69a); color: #fff; }
      .op-submit--sell { background: var(--red, #ef5350); color: #fff; }
      .op-submit:disabled { opacity: .5; cursor: default; }
      .op-stream { padding: 12px 14px; border-top: 1px solid var(--border, rgba(255,255,255,0.07)); font-size: 11px; white-space: pre-wrap; max-height: 140px; overflow-y: auto; }
    `;
    document.head.appendChild(s);
  }
}
