import { Component } from '/core/component.js';

export default class ClaudeInsightsComponent extends Component {
  static id = 'claude-insights';

  async init() {
    this._injectStyles();

    this.el.innerHTML = `
      <div class="claude-card">
        <div class="claude-card__header">
          <div class="claude-card__title">Claude Insights</div>
          <div class="claude-card__meta">
            <span class="claude-card__auto-tag" id="ci-auto-tag"></span>
            <span class="claude-card__time" id="ci-time">—</span>
          </div>
        </div>

        <div class="claude-card__body" id="ci-body">
          <div class="claude-card__placeholder">
            Waiting for analysis... Click "Ask Claude" to get insights.
          </div>
        </div>

        <div class="claude-card__footer">
          <button class="claude-card__ask-btn" id="ci-ask-btn">Ask Claude</button>
        </div>
      </div>
    `;

    this.el.querySelector('#ci-ask-btn').addEventListener('click', () => {
      this.send('askClaude', {});
      this._setThinking();
    });

    this.on('claudeResponse', (msg) => this._onResponse(msg));
    this.on('claudeThinking', ()    => this._setThinking());
    this.on('claudeError',    (msg) => this._onError(msg));
  }

  _setThinking() {
    const body = this.el.querySelector('#ci-body');
    if (body) {
      body.innerHTML = `
        <div class="claude-card__thinking">
          <div class="claude-card__think-dot"></div>
          Claude thinking...
        </div>
      `;
    }
  }

  _onResponse({ response, auto, ts }) {
    const body    = this.el.querySelector('#ci-body');
    const autoTag = this.el.querySelector('#ci-auto-tag');
    const timeEl  = this.el.querySelector('#ci-time');

    if (autoTag) autoTag.textContent = auto ? 'Auto' : '';
    if (timeEl && ts) {
      timeEl.textContent = new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    if (body && response) {
      // Highlight [Section] headers and key action words
      const html = response
        .replace(/\[(.+?)\]/g, '<strong style="color:#00e5ff">[$1]</strong>')
        .replace(/(Close|close position)/gi, '<span style="color:var(--red,#ef5350)">$1</span>')
        .replace(/(Hold|keep holding)/gi,    '<span style="color:var(--green,#26a69a)">$1</span>')
        .replace(/(Open Long)/gi,            '<span style="color:var(--green,#26a69a)">$1</span>')
        .replace(/(Open Short)/gi,           '<span style="color:var(--red,#ef5350)">$1</span>');
      body.innerHTML = `<div class="claude-card__text">${html}</div>`;
    }
  }

  _onError({ error }) {
    const body = this.el.querySelector('#ci-body');
    if (body) {
      body.innerHTML = `<div class="claude-card__error">Error: ${error}</div>`;
    }
  }

  _injectStyles() {
    const id = 'claude-card-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .claude-card {
        background: var(--bg-card, #0c1220);
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        border-radius: var(--radius, 6px);
        overflow: hidden;
        font-family: var(--font-mono, 'SF Mono', monospace);
        display: flex; flex-direction: column;
      }
      .claude-card__header {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
      }
      .claude-card__title    { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text, #e2e8f0); }
      .claude-card__meta     { display: flex; align-items: center; gap: 8px; }
      .claude-card__auto-tag { font-size: 10px; color: var(--text-muted, #64748b); }
      .claude-card__time     { font-size: 11px; color: var(--text-muted, #64748b); }
      .claude-card__body     { padding: 14px 16px; flex: 1; }
      .claude-card__text     { font-size: 12px; line-height: 1.8; color: var(--text, #e2e8f0); white-space: pre-wrap; }
      .claude-card__placeholder { font-size: 11px; color: var(--text-muted, #64748b); }
      .claude-card__error    { font-size: 12px; color: var(--red, #ef5350); }
      .claude-card__thinking {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: var(--text-muted, #64748b);
      }
      .claude-card__think-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #00e5ff;
        animation: ci-pulse 1s infinite;
      }
      @keyframes ci-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: .4; transform: scale(.7); }
      }
      .claude-card__footer {
        padding: 10px 14px;
        border-top: 1px solid var(--border, rgba(255,255,255,0.07));
        display: flex; gap: 8px; flex-wrap: wrap;
      }
      .claude-card__ask-btn {
        padding: 5px 14px; font-size: 11px; border-radius: 7px; cursor: pointer;
        border: 1px solid var(--border, rgba(255,255,255,0.07));
        background: none; color: var(--text, #e2e8f0);
        font-family: var(--font-mono, monospace); transition: all .15s;
      }
      .claude-card__ask-btn:hover { border-color: rgba(0,229,255,.4); color: #00e5ff; }
    `;
    document.head.appendChild(s);
  }
}
