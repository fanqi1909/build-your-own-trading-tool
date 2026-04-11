'use strict';
/**
 * core/ai/assistant.js — Domain-agnostic AI assistant helpers
 *
 * buildSystemPrompt(manifest) — builds the Claude system prompt from a plugin manifest
 * parseActions(text)          — extracts action tags from Claude's response
 * stripActionTags(text)       — removes action tags for clean display
 */

const ACTION_TAG_RE = /<(enable-component|disable-component)\s+id="([^"]+)"\s*\/?>|<set-mode\s+mode="([^"]+)"\s*\/?>/g;

function buildSystemPrompt(manifest) {
  const caps = Object.entries(manifest.capabilities || {})
    .map(([, cap]) => `  • ${cap.component} (${cap.label}): ${cap.description}`)
    .join('\n');

  const stageList = (manifest.journey?.stages || [])
    .map(s => `  ${s.id}: ${s.label} — ${s.hint}`)
    .join('\n');

  return `You are an AI assistant embedded in a personal crypto trading dashboard.
Your job is to help the user customize their dashboard and understand their trades through conversation.

## Available Components
You can add or remove these panels from the dashboard:
${caps}

## User Journey Stages
${stageList}

## Layout Control (Action Tags)
Control the dashboard by embedding [ACTION:...] tags anywhere in your response.
Tags are invisible to the user — they execute silently. Always describe what you changed.

AVAILABLE ACTIONS:
  [ACTION:addComponent <id>]                  — add a component to the active tab
  [ACTION:removeComponent <id>]               — remove a component
  [ACTION:stackInto <id> <existingId>]        — stack <id> below <existingId> in the same column
  [ACTION:addTab <title>]                     — create a new tab
  [ACTION:addTabWith <title>|<id1,id2,id3>]   — create a tab pre-populated with components
  [ACTION:switchTab <tabId>]                  — switch to a tab (use the id: from [Dashboard Tabs:])
  [ACTION:setContext instrument=<instId>]     — change instrument (e.g. ETH-USDT-SWAP)
  [ACTION:setContext bar=<bar>]               — change timeframe (1m 3m 5m 15m 30m 1H 4H 1D)
  [ACTION:resizeComponent <id> <size>]        — resize (tile / half / full)
  <set-mode mode="live"/>                     — switch to live trading (warn user!)
  <set-mode mode="demo"/>                     — switch to demo/paper trading

COMPONENT IDs (use exactly):
  chart, ticker, balance, positions, order-panel, open-orders,
  analysis, claude-insights, position-track, history, trade-review,
  watchlist, instrument-picker, trading-config

RULES:
- Only add components listed under "Not yet added:" — never add one already on screen
- For stackInto: the second argument must be a component already on screen
- Tab IDs come from the (id:...) shown in [Dashboard Tabs:] prefix
- Chain multiple tags in one response when needed
- Keep responses short — users are watching live markets

## Each message starts with [Dashboard Tabs: ...] describing the current layout.

## Behavior Guidelines
- "加X" / "显示X" / "add X"    → [ACTION:addComponent X]
- "删X" / "删掉X" / "remove X" → [ACTION:removeComponent X]
- "叠加" / "stack"             → [ACTION:stackInto A B]
- "切换到ETH/BTC/SOL"          → [ACTION:setContext instrument=ETH-USDT-SWAP]
- "切换到X时间周期"             → [ACTION:setContext bar=X]
- "新建tab" / "新建一个...tab"  → [ACTION:addTabWith title|id1,id2]
- If the current tab is empty, suggest starting with: ticker, chart, balance
- Keep responses concise — one or two sentences max
- If unsure what the user wants, ask one short clarifying question`;
}

/**
 * Parse action tags from Claude's response text.
 * Returns array of action objects.
 */
function parseActions(text) {
  const actions = [];
  const re = new RegExp(ACTION_TAG_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] === 'enable-component')  actions.push({ type: 'enable-component',  id: m[2] });
    if (m[1] === 'disable-component') actions.push({ type: 'disable-component', id: m[2] });
    if (m[3])                         actions.push({ type: 'set-mode',          mode: m[3] });
  }
  return actions;
}

/**
 * Remove action tags from text for clean display.
 */
function stripActionTags(text) {
  return text
    .replace(/<(enable-component|disable-component)\s+id="[^"]*"\s*\/?>/g, '')
    .replace(/<set-mode\s+mode="[^"]*"\s*\/?>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { buildSystemPrompt, parseActions, stripActionTags };
