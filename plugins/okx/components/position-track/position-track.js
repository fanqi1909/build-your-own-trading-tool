import { Component } from '/core/component.js';

const PAGE_SIZE = 5;

export default class PositionTrackComponent extends Component {
  static id = 'position-track';

  async init() {
    this._injectStyles();
    this._history    = [];
    this._pageIdx    = 0;
    this._expandedIdx = null;

    this.el.innerHTML = `
      <div class="pt-card">
        <div class="pt-card__header">
          <div class="pt-card__title">Position Tracking</div>
          <span class="pt-card__time" id="pt-time">—</span>
        </div>

        <!-- Latest content -->
        <div class="pt-card__body" id="pt-body">No position to evaluate</div>

        <!-- History list (last 5) -->
        <div class="pt-card__list" id="pt-list"></div>

        <!-- Pagination -->
        <div class="pt-card__pager" id="pt-pager" style="display:none">
          <button class="pt-pager-btn" id="pt-prev">&#8249;</button>
          <span class="pt-pager-info" id="pt-page-info"></span>
          <button class="pt-pager-btn" id="pt-next">&#8250;</button>
        </div>
      </div>
    `;

    this.el.querySelector('#pt-prev').addEventListener('click', () => this._changePage(-1));
    this.el.querySelector('#pt-next').addEventListener('click', () => this._changePage(1));

    this.on('positionTrack',        (msg) => this._onTrack(msg));
    this.on('positionTrackHistory', (msg) => this._onHistory(msg));
  }

  _onTrack({ ts, text, mode }) {
    if (!this._history.find(e => e.ts === ts)) {
      this._history.push({ ts, text, mode });
    }
    this._showLatest();
    this._renderList();
  }

  _onHistory({ data }) {
    this._history  = data || [];
    this._pageIdx  = 0;
    if (this._history.length) this._showEntry(this._history.length - 1);
    this._renderList();
  }

  _showLatest() {
    if (this._history.length) this._showEntry(this._history.length - 1);
  }

  _showEntry(idx) {
    const e = this._history[idx];
    if (!e) return;

    const bodyEl = this.el.querySelector('#pt-body');
    const timeEl = this.el.querySelector('#pt-time');
    if (timeEl) timeEl.textContent = new Date(e.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    if (bodyEl && e.text) {
      const colored = e.text
        .replace(/(Action[：:]?)/gi,      '<span style="color:var(--text-muted,#64748b)">$1</span>')
        .replace(/(Close|Reduce)/gi,      '<span style="color:var(--red,#ef5350);font-weight:700">$1</span>')
        .replace(/(Hold)/gi,              '<span style="color:var(--green,#26a69a);font-weight:700">$1</span>')
        .replace(/(Add)/gi,               '<span style="color:#00e5ff;font-weight:700">$1</span>')
        .replace(/(Reason[：:]?|Confidence[：:]?)/gi, '<span style="color:var(--text-muted,#64748b)">$1</span>')
        .replace(/\n/g, '<br>');
      bodyEl.innerHTML = colored;
    }
  }

  _renderList() {
    const listEl  = this.el.querySelector('#pt-list');
    const pagerEl = this.el.querySelector('#pt-pager');
    const pageInfo = this.el.querySelector('#pt-page-info');
    if (!listEl || !this._history.length) {
      if (listEl) listEl.innerHTML = '';
      return;
    }

    const total      = this._history.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    this._pageIdx    = Math.max(0, Math.min(this._pageIdx, totalPages - 1));

    const reversed  = [...this._history].reverse();
    const pageItems = reversed.slice(this._pageIdx * PAGE_SIZE, (this._pageIdx + 1) * PAGE_SIZE);

    listEl.innerHTML = pageItems.map(e => {
      const actualIdx = this._history.indexOf(e);
      const expanded  = this._expandedIdx === actualIdx;
      const time      = new Date(e.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit' });
      const op        = e.text.match(/Action[：:]\s*(\S+)/)?.[1] || '—';
      const reason    = (e.text.match(/Reason[：:]\s*(.+)/)?.[1] || '').slice(0, 30);
      const conf      = e.text.match(/Confidence[：:]\s*(\S+)/)?.[1] || '';
      const opColor   = /Close|Reduce/.test(op) ? 'var(--red,#ef5350)'
        : /Add/.test(op) ? '#00e5ff'
        : /Hold/.test(op) ? 'var(--green,#26a69a)'
        : 'var(--text-muted,#64748b)';
      const safeText  = (e.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      return `<div class="pt-row" data-idx="${actualIdx}">
        <div class="pt-row__summary">
          <span class="pt-row__op" style="color:${opColor}">${op}</span>
          <span class="pt-row__reason">${reason}</span>
          <span class="pt-row__conf">${conf}</span>
          <span class="pt-row__time">${time}</span>
          <span class="pt-row__arrow">${expanded ? '▲' : '▼'}</span>
        </div>
        ${expanded ? `<pre class="pt-row__detail">${safeText}</pre>` : ''}
      </div>`;
    }).join('');

    // Attach expand listeners
    listEl.querySelectorAll('.pt-row').forEach(row => {
      row.querySelector('.pt-row__summary').addEventListener('click', () => {
        const idx = parseInt(row.dataset.idx);
        this._expandedIdx = this._expandedIdx === idx ? null : idx;
        this._renderList();
        if (this._expandedIdx !== null) this._showEntry(idx);
      });
    });

    // Pagination
    if (pagerEl) pagerEl.style.display = totalPages > 1 ? 'flex' : 'none';
    if (pageInfo) pageInfo.textContent  = `${this._pageIdx + 1} / ${totalPages}`;
  }

  _changePage(dir) {
    const total      = this._history.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    this._pageIdx    = Math.max(0, Math.min(this._pageIdx + dir, totalPages - 1));
    this._renderList();
  }

  _injectStyles() {
    const id = 'pt-card-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .pt-card {
        background: var(--bg-card, #0c1220);
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        border-radius: var(--radius, 6px);
        overflow: hidden;
        font-family: var(--font-mono, 'SF Mono', monospace);
      }
      .pt-card__header {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; align-items: center; justify-content: space-between;
      }
      .pt-card__title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text, #e2e8f0); }
      .pt-card__time  { font-size: 10px; color: var(--text-muted, #64748b); }
      .pt-card__body  { padding: 12px 16px; font-size: 12px; line-height: 1.8; color: var(--text-muted, #64748b); }
      .pt-card__list  {}
      .pt-row {
        border-top: 1px solid var(--border, rgba(255,255,255,0.07));
      }
      .pt-row__summary {
        padding: 7px 14px; cursor: pointer;
        display: flex; align-items: center; gap: 8px; user-select: none;
      }
      .pt-row__summary:hover { background: rgba(255,255,255,.02); }
      .pt-row__op     { font-weight: 700; font-size: 11px; min-width: 36px; }
      .pt-row__reason { flex: 1; font-size: 10px; color: var(--text-muted, #64748b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pt-row__conf   { font-size: 10px; color: var(--text-muted, #64748b); white-space: nowrap; }
      .pt-row__time   { font-size: 10px; color: var(--text-muted, #64748b); white-space: nowrap; }
      .pt-row__arrow  { font-size: 10px; color: var(--text-muted, #64748b); }
      .pt-row__detail {
        margin: 0; padding: 8px 14px 12px;
        font-size: 10px; line-height: 1.6; color: var(--text, #e2e8f0);
        white-space: pre-wrap; word-break: break-word;
        background: rgba(0,0,0,.2); user-select: text; cursor: text;
      }
      .pt-card__pager {
        padding: 6px 14px; border-top: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; align-items: center; gap: 8px;
      }
      .pt-pager-btn {
        padding: 2px 10px; border-radius: 5px;
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        background: transparent; color: var(--text-muted, #64748b);
        font-size: 13px; cursor: pointer; font-family: var(--font-mono, monospace);
      }
      .pt-pager-btn:hover { color: var(--text, #e2e8f0); }
      .pt-pager-info { font-size: 10px; color: var(--text-muted, #64748b); }
    `;
    document.head.appendChild(s);
  }
}
