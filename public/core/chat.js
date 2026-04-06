/**
 * public/core/chat.js — Chat panel UI
 *
 * Renders into #chat-panel, handles streaming AI responses,
 * and executes layout actions returned by the assistant.
 */

const ACTION_TAG_RE = /<(enable-component|disable-component)\s+id="[^"]*"\s*\/?>|<set-mode\s+mode="[^"]*"\s*\/?>/g;

export class ChatPanel {
  constructor(containerEl, bus) {
    this.el  = containerEl;
    this.bus = bus;
    this._streaming    = false;
    this._streamEl     = null;
    this._streamBuffer = '';
  }

  init() {
    this._suggestionEl = null;
    this._injectStyles();
    this.el.innerHTML = `
      <div class="chat">
        <div class="chat__header">
          <div class="chat__header-title">
            <span class="chat__header-icon">✦</span>
            AI Assistant
          </div>
          <button class="chat__reset-btn" id="chat-reset-btn" title="Reset session">↺</button>
        </div>
        <div class="chat__messages" id="chat-messages"></div>
        <div class="chat__input-area">
          <textarea class="chat__input" id="chat-input" placeholder="Ask anything… (Enter to send)" rows="2"></textarea>
          <button class="chat__send-btn" id="chat-send-btn">Send</button>
        </div>
      </div>
    `;

    const input = this.el.querySelector('#chat-input');
    const sendBtn = this.el.querySelector('#chat-send-btn');
    const resetBtn = this.el.querySelector('#chat-reset-btn');

    sendBtn.addEventListener('click', () => this._send());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
    });
    resetBtn.addEventListener('click', () => {
      this.bus.emit('ws:send', { action: 'chatReset' });
    });

    this.bus.on('chatThinking',    ()          => this._onThinking());
    this.bus.on('chatChunk',       ({ text })  => this._onChunk(text));
    this.bus.on('chatDone',        ()          => this._onDone());
    this.bus.on('chatError',       ({ error }) => this._onError(error));
    this.bus.on('chatAction',      (msg)       => this._onAction(msg));
    this.bus.on('chatReset',       ()          => this._onReset());
    this.bus.on('suggestion:show', (s)         => this._onSuggestion(s));

    this._addMessage('assistant', 'Hello! I can help you customize your dashboard.\n\nTry: "Show me the chart" or "What can I do?"');
  }

  _send() {
    const input = this.el.querySelector('#chat-input');
    const message = input.value.trim();
    if (!message || this._streaming) return;
    input.value = '';
    input.style.height = '';

    this._addMessage('user', message);

    const layout = window.app?.layout;
    const snapshot = layout?.snapshot?.() || { activeTabId: null, tabs: [] };
    const dashboardContext = {
      activeTabId: snapshot.activeTabId,
      tabs: (snapshot.tabs || []).map(tab => ({
        id: tab.id,
        title: tab.title,
        enabledIds: tab.active,
      })),
    };

    this.bus.emit('ws:send', { action: 'chat', message, dashboardContext });
  }

  _onThinking() {
    this._streaming = true;
    this._streamBuffer = '';
    this._streamEl = this._addMessage('assistant', '…', true);
    this.el.querySelector('#chat-send-btn').disabled = true;
  }

  _onChunk(text) {
    if (!this._streamEl) return;
    this._streamBuffer += text;
    const clean = this._stripTags(this._streamBuffer);
    const textEl = this._streamEl.querySelector('.chat__msg-text');
    if (textEl) textEl.textContent = clean || '…';
    const msgs = this.el.querySelector('#chat-messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  _onDone() {
    this._streaming = false;
    if (this._streamEl) {
      this._streamEl.classList.remove('chat__msg--streaming');
      const textEl = this._streamEl.querySelector('.chat__msg-text');
      if (textEl) textEl.textContent = this._stripTags(this._streamBuffer);
    }
    this._streamEl = null;
    this._streamBuffer = '';
    this.el.querySelector('#chat-send-btn').disabled = false;
  }

  _onError(error) {
    this._streaming = false;
    this._streamEl = null;
    this._addMessage('error', 'Error: ' + error);
    this.el.querySelector('#chat-send-btn').disabled = false;
  }

  _onAction({ type, id, mode }) {
    if (type === 'enable-component' && id) {
      window.app?.layout?.add(id);
    } else if (type === 'disable-component' && id) {
      window.app?.layout?.remove(id);
    } else if (type === 'set-mode' && mode) {
      this.bus.emit('ws:send', { action: 'setMode', mode });
    }
  }

  _onReset() {
    const msgs = this.el.querySelector('#chat-messages');
    if (msgs) msgs.innerHTML = '';
    this._addMessage('assistant', 'Session reset. How can I help?');
  }

  _onSuggestion({ id, text, action, label }) {
    const msgs = this.el.querySelector('#chat-messages');
    if (!msgs) return;

    if (this._suggestionEl) {
      this._suggestionEl.remove();
      this._suggestionEl = null;
    }

    const card = document.createElement('div');
    card.className = 'chat__suggestion';
    card.innerHTML = `
      <div class="chat__suggestion-text">💡 ${text}</div>
      <div class="chat__suggestion-btns">
        <button class="chat__suggestion-accept">${label || 'Enable'}</button>
        <button class="chat__suggestion-dismiss">Dismiss</button>
      </div>
    `;

    card.querySelector('.chat__suggestion-accept').addEventListener('click', () => {
      card.remove();
      this._suggestionEl = null;
      this.bus.emit('suggestion:dismiss', { id });
      this._onAction(action);
    });

    card.querySelector('.chat__suggestion-dismiss').addEventListener('click', () => {
      card.remove();
      this._suggestionEl = null;
      this.bus.emit('suggestion:dismiss', { id });
    });

    msgs.appendChild(card);
    msgs.scrollTop = msgs.scrollHeight;
    this._suggestionEl = card;
  }

  _stripTags(text) {
    return text.replace(ACTION_TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  _addMessage(role, text, streaming = false) {
    const msgs = this.el.querySelector('#chat-messages');
    if (!msgs) return null;
    const div = document.createElement('div');
    div.className = `chat__msg chat__msg--${role}${streaming ? ' chat__msg--streaming' : ''}`;
    const span = document.createElement('span');
    span.className = 'chat__msg-text';
    span.textContent = text;
    div.appendChild(span);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  _injectStyles() {
    const id = 'chat-styles';
    if (document.getElementById(id)) return;
    const s = document.createElement('style');
    s.id = id;
    s.textContent = `
      .chat { display: flex; flex-direction: column; height: 100%; }
      .chat__header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
      .chat__header-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--blue, #2196f3); }
      .chat__header-icon { font-size: 16px; }
      .chat__reset-btn { background: transparent; border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; border-radius: 5px; padding: 3px 9px; font-size: 14px; transition: color .15s, border-color .15s; }
      .chat__reset-btn:hover { color: var(--red); border-color: var(--red); }
      .chat__messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
      .chat__msg { max-width: 92%; padding: 9px 12px; border-radius: 10px; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
      .chat__msg--user { align-self: flex-end; background: rgba(33,150,243,0.15); border: 1px solid rgba(33,150,243,0.25); color: var(--text); }
      .chat__msg--assistant { align-self: flex-start; background: var(--bg-card); border: 1px solid var(--border); color: var(--text); }
      .chat__msg--error { align-self: flex-start; background: rgba(239,83,80,0.1); border: 1px solid rgba(239,83,80,0.25); color: var(--red); }
      .chat__msg--streaming::after { content: '▋'; display: inline-block; margin-left: 2px; animation: chatBlink 1s steps(1) infinite; }
      @keyframes chatBlink { 50% { opacity: 0; } }
      .chat__input-area { padding: 12px; border-top: 1px solid var(--border); display: flex; gap: 8px; flex-shrink: 0; }
      .chat__input { flex: 1; min-height: 42px; max-height: 160px; resize: vertical; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); padding: 10px 12px; font: inherit; line-height: 1.45; }
      .chat__input:focus { outline: none; border-color: var(--blue); }
      .chat__send-btn { align-self: flex-end; background: var(--blue); color: #fff; border: none; border-radius: 8px; padding: 10px 14px; font-size: 12px; font-weight: 700; cursor: pointer; transition: opacity .15s; }
      .chat__send-btn:disabled { opacity: 0.5; cursor: default; }
      .chat__send-btn:not(:disabled):hover { opacity: 0.85; }
      .chat__suggestion { background: rgba(77,158,255,0.07); border: 1px solid rgba(77,158,255,0.2); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; line-height: 1.5; }
      .chat__suggestion-text { color: var(--text); }
      .chat__suggestion-btns { display: flex; gap: 6px; }
      .chat__suggestion-accept { background: var(--blue); color: #fff; border: none; border-radius: 5px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer; transition: opacity .15s; }
      .chat__suggestion-accept:hover { opacity: 0.85; }
      .chat__suggestion-dismiss { background: transparent; border: 1px solid var(--border); color: var(--text-muted); border-radius: 5px; padding: 4px 10px; font-size: 11px; cursor: pointer; transition: border-color .15s, color .15s; }
      .chat__suggestion-dismiss:hover { border-color: var(--text-muted); color: var(--text); }
    `;
    document.head.appendChild(s);
  }
}
