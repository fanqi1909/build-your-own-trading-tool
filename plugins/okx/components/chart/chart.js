import { Component } from '/core/component.js';

const LW_CDN = '/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      // already loading or loaded — wait for LightweightCharts global
      const check = setInterval(() => {
        if (window.LightweightCharts) { clearInterval(check); resolve(); }
      }, 50);
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default class ChartComponent extends Component {
  static id = 'chart';

  async init() {
    this._injectStyles();
    this._currentBar  = '15m';
    this._currentInst = 'BTC-USDT';
    this._chart       = null;
    this._series      = null;

    this.el.innerHTML = `
      <div class="chart-card">
        <div class="chart-card__header">
          <div class="chart-card__title">BTC-USDT Candles</div>
          <div class="chart-card__bar-select" id="chart-bar-select">
            <button class="chart-card__bar-btn" data-bar="3m">3m</button>
            <button class="chart-card__bar-btn chart-card__bar-btn--active" data-bar="15m">15m</button>
            <button class="chart-card__bar-btn" data-bar="1H">1H</button>
            <button class="chart-card__bar-btn" data-bar="4H">4H</button>
            <button class="chart-card__bar-btn" data-bar="1D">1D</button>
          </div>
        </div>
        <div class="chart-card__body" id="chart-body"></div>
        <div class="chart-card__footer">
          <span id="chart-range">—</span>
          <span id="chart-bars">—</span>
        </div>
      </div>
    `;

    // Bar button click handlers
    this.el.querySelector('#chart-bar-select').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bar]');
      if (!btn) return;
      const bar = btn.dataset.bar;
      this._setActiveBar(bar);
      this.send('candles', { inst: this._currentInst, bar });
    });

    // Load lightweight-charts then create chart
    try {
      await loadScript(LW_CDN);
      this._createChart();
    } catch (err) {
      this.el.querySelector('#chart-body').textContent = 'Failed to load chart library';
    }

    this.on('candles', (msg) => this.update(msg));
  }

  _createChart() {
    const body = this.el.querySelector('#chart-body');
    if (!body || !window.LightweightCharts) return;

    this._chart = LightweightCharts.createChart(body, {
      layout: {
        background:  { color: '#0c1220' },
        textColor:   '#64748b',
      },
      grid: {
        vertLines:   { color: 'rgba(255,255,255,0.04)' },
        horzLines:   { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.07)',
      },
      timeScale: {
        borderColor:     'rgba(255,255,255,0.07)',
        timeVisible:     true,
        secondsVisible:  false,
      },
      width:  body.clientWidth,
      height: 460,
    });

    this._series = this._chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor:          '#22c55e',
      downColor:        '#f43f5e',
      borderUpColor:    '#22c55e',
      borderDownColor:  '#f43f5e',
      wickUpColor:      '#22c55e',
      wickDownColor:    '#f43f5e',
    });

    // Resize observer
    this._resizeObs = new ResizeObserver(() => {
      if (this._chart) this._chart.applyOptions({ width: body.clientWidth });
    });
    this._resizeObs.observe(body);
  }

  update({ data, inst, bar }) {
    if (!data || !data.length || !this._series) return;

    if (inst) this._currentInst = inst;
    if (bar)  this._setActiveBar(bar);

    const sorted = [...data].sort((a, b) => a.ts - b.ts);

    // lightweight-charts expects time in seconds (UTC) for candlestick
    const lwData = sorted.map(c => ({
      time:  Math.floor(c.ts / 1000),
      open:  c.o,
      high:  c.h,
      low:   c.l,
      close: c.c,
    }));

    try {
      this._series.setData(lwData);
      this._chart.timeScale().fitContent();
    } catch (e) {
      // ignore stale data errors
    }

    const oldest = new Date(sorted[0].ts).toLocaleDateString('en-US');
    const newest = new Date(sorted[sorted.length - 1].ts).toLocaleDateString('en-US');
    const rangeEl = this.el.querySelector('#chart-range');
    const barsEl  = this.el.querySelector('#chart-bars');
    if (rangeEl) rangeEl.textContent = oldest + ' → ' + newest;
    if (barsEl)  barsEl.textContent  = sorted.length + ' candles';
  }

  _setActiveBar(bar) {
    this._currentBar = bar;
    this.el.querySelectorAll('.chart-card__bar-btn').forEach(b => {
      b.classList.toggle('chart-card__bar-btn--active', b.dataset.bar === bar);
    });
  }

  destroy() {
    if (this._resizeObs)  this._resizeObs.disconnect();
    if (this._chart)      this._chart.remove();
    super.destroy();
  }

  _injectStyles() {
    const id = 'chart-card-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .chart-card {
        background: var(--bg-card, #0c1220);
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        border-radius: var(--radius, 6px);
        overflow: hidden;
        display: flex; flex-direction: column;
      }
      .chart-card__header {
        padding: 14px 20px;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        flex-wrap: wrap;
      }
      .chart-card__title {
        font-size: 13px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.5px; color: var(--text, #e2e8f0);
      }
      .chart-card__bar-select { display: flex; gap: 4px; }
      .chart-card__bar-btn {
        padding: 3px 10px; font-size: 10px;
        font-family: var(--font-mono, 'SF Mono', monospace);
        background: none; border: 1px solid var(--border, rgba(255,255,255,0.07));
        border-radius: 5px; color: var(--text-muted, #64748b);
        cursor: pointer; transition: .15s;
      }
      .chart-card__bar-btn:hover { border-color: rgba(0,229,255,0.3); color: #00e5ff; }
      .chart-card__bar-btn--active {
        border-color: #00e5ff; color: #00e5ff; background: rgba(0,229,255,0.08);
      }
      .chart-card__body { flex: 1; min-height: 460px; }
      .chart-card__footer {
        padding: 10px 20px;
        display: flex; justify-content: space-between;
        font-size: 10px; color: var(--text-muted, #64748b);
        border-top: 1px solid var(--border, rgba(255,255,255,0.07));
      }
    `;
    document.head.appendChild(s);
  }
}
