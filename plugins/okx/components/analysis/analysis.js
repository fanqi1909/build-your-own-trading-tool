import { Component } from '/core/component.js';

export default class AnalysisComponent extends Component {
  static id = 'analysis';
  static inputs = ['instrument'];

  async init() {
    this._injectStyles();
    this._history     = [];
    this._viewingIdx  = null;  // null = latest

    this.el.innerHTML = `
      <div class="analysis-card">
        <div class="analysis-card__header">
          <div class="analysis-card__title">Technical Analysis</div>
          <div class="analysis-card__controls">
            <span class="analysis-card__interval">Every 10min</span>
            <span class="analysis-card__time" id="an-time">—</span>
          </div>
        </div>

        <!-- Signals bar -->
        <div class="analysis-card__signals" id="an-signals" style="display:none">
          <span class="an-signal an-signal--bull" id="an-bull">— Bull</span>
          <span class="an-signal an-signal--bear" id="an-bear">— Bear</span>
          <span class="an-signal an-signal--atr"  id="an-atr">ATR —</span>
        </div>

        <pre class="analysis-card__output" id="an-output">Waiting for analysis...</pre>

        <!-- History chips -->
        <div class="analysis-card__history" id="an-chips"></div>
      </div>
    `;

    this.on('analysis',        (msg) => this._onAnalysis(msg));
    this.on('analysisHistory', (msg) => this._onHistory(msg));

    const ctx = this.getContext();
    this._instrument = ctx.instrument || 'BTC-USDT-SWAP';
  }

  onInputChange(key, value) {
    if (key === 'instrument') {
      this._instrument = value;
      this._history    = [];
      this._viewingIdx = null;
      this.el.querySelector('#an-output').textContent = 'Waiting for analysis…';
      this.el.querySelector('#an-chips').innerHTML    = '';
      this.el.querySelector('#an-signals').style.display = 'none';
      this.send('triggerAnalysis', { inst: this._instrument });
    }
  }

  _onAnalysis({ ts, inst, bar, raw, bull, bear, atr }) {
    const wasLatest = this._viewingIdx === null || this._viewingIdx === this._history.length - 1;
    const existing  = this._history.findIndex(e => e.ts === ts);
    if (existing >= 0) {
      this._history[existing] = { ...this._history[existing], raw, bull, bear, atr };
    } else {
      this._history.push({ ts, raw, bull, bear, atr });
      if (this._history.length > 50) this._history = this._history.slice(-50);
    }
    if (wasLatest) {
      this._viewingIdx = null;
      this._showEntry(this._history.length - 1);
    } else {
      this._renderChips();
    }
  }

  _onHistory({ data }) {
    this._history    = data || [];
    this._viewingIdx = null;
    if (this._history.length) this._showEntry(this._history.length - 1);
    this._renderChips();
  }

  _showEntry(idx) {
    const e = this._history[idx];
    if (!e) return;
    this._viewingIdx = idx;

    const outputEl = this.el.querySelector('#an-output');
    if (outputEl) outputEl.textContent = e.raw || '(no output)';

    const dt      = new Date(e.ts);
    const isLatest = idx === this._history.length - 1;
    const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const timeEl  = this.el.querySelector('#an-time');
    if (timeEl) timeEl.textContent = (isLatest ? '' : '◀ ') + timeStr
      + (e.atr ? `  ATR ${e.atr.toFixed(0)}` : '');

    // Signals
    const signalsEl = this.el.querySelector('#an-signals');
    const bullEl    = this.el.querySelector('#an-bull');
    const bearEl    = this.el.querySelector('#an-bear');
    const atrEl     = this.el.querySelector('#an-atr');
    if (e.bull != null || e.bear != null) {
      if (signalsEl) signalsEl.style.display = '';
      if (bullEl)    bullEl.textContent = `${e.bull ?? '—'} Bull`;
      if (bearEl)    bearEl.textContent = `${e.bear ?? '—'} Bear`;
      if (atrEl)     atrEl.textContent  = e.atr ? `ATR ${e.atr.toFixed(0)}` : 'ATR —';
    }

    this._renderChips();
  }

  _renderChips() {
    const bar = this.el.querySelector('#an-chips');
    if (!bar) return;

    const entries = [...this._history].reverse();
    bar.innerHTML = entries.map((e, di) => {
      const actualIdx = this._history.length - 1 - di;
      const isLatest  = actualIdx === this._history.length - 1;
      const isActive  = this._viewingIdx === actualIdx
        || (this._viewingIdx === null && isLatest);
      const dt    = new Date(e.ts);
      const time  = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const color = (e.bull > e.bear) ? 'var(--green, #26a69a)'
        : (e.bull < e.bear) ? 'var(--red, #ef5350)' : 'var(--text-muted, #64748b)';
      const label = (isLatest ? 'Latest ' : '') + `${e.bull ?? '—'}Bull${e.bear ?? '—'}Bear ${time}`;
      return `<span class="an-chip${isActive ? ' an-chip--active' : ''}"
        style="color:${color}"
        data-idx="${actualIdx}"
        title="${dt.toLocaleString('en-US')}">${label}</span>`;
    }).join('');

    bar.querySelectorAll('.an-chip').forEach(chip => {
      chip.addEventListener('click', () => this._showEntry(parseInt(chip.dataset.idx)));
    });
  }

  _injectStyles() {
    const id = 'analysis-card-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .analysis-card {
        background: var(--bg-card, #0c1220);
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        border-radius: var(--radius, 6px);
        overflow: hidden;
        font-family: var(--font-mono, 'SF Mono', monospace);
      }
      .analysis-card__header {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
      }
      .analysis-card__title    { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text, #e2e8f0); }
      .analysis-card__controls { display: flex; align-items: center; gap: 10px; }
      .analysis-card__interval { font-size: 10px; color: var(--text-muted, #64748b); }
      .analysis-card__time     { font-size: 11px; color: var(--text-muted, #64748b); }
      .analysis-card__signals  {
        display: flex; gap: 12px; padding: 8px 16px;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
        font-size: 11px;
      }
      .an-signal         { padding: 2px 8px; border-radius: 4px; font-weight: 600; }
      .an-signal--bull   { color: var(--green, #26a69a); background: rgba(38,166,154,.1); }
      .an-signal--bear   { color: var(--red, #ef5350);   background: rgba(239,83,80,.1); }
      .an-signal--atr    { color: #00e5ff;               background: rgba(0,229,255,.07); }
      .analysis-card__output {
        font-size: 10px; line-height: 1.55; color: var(--text, #e2e8f0);
        padding: 14px 16px; overflow-x: auto; margin: 0;
        white-space: pre; background: rgba(0,0,0,0.2);
        max-height: 320px; overflow-y: auto;
      }
      .analysis-card__history {
        padding: 8px 14px; border-top: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; flex-wrap: wrap; gap: 5px; min-height: 32px;
      }
      .an-chip {
        font-size: 9px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        font-family: var(--font-mono, monospace); white-space: nowrap; transition: all .15s;
      }
      .an-chip:hover  { border-color: rgba(0,229,255,.3); }
      .an-chip--active { border-color: #00e5ff; background: rgba(0,229,255,.08); }
    `;
    document.head.appendChild(s);
  }
}
