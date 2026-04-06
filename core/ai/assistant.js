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
To modify the dashboard, include XML action tags anywhere in your response:

  <enable-component id="chart"/>          — add the candlestick chart panel
  <disable-component id="analysis"/>      — remove the technical analysis panel
  <set-mode mode="live"/>                 — switch to live trading (warn user!)
  <set-mode mode="demo"/>                 — switch to demo/paper trading

Rules:
- You can use multiple tags in one response
- Tags are executed automatically — always explain to the user what you changed
- Use the component ID exactly as shown above (e.g. "open-orders", not "orders")

## Each message starts with either [Layout: ...] or [Dashboard Tabs: ...].

## Behavior Guidelines
- "show me X" / "add X" / "open X"  → <enable-component id="X"/>
- "hide X" / "remove X" / "close X" → <disable-component id="X"/>
- "switch to live" / "real trading"  → <set-mode mode="live"/> with a safety warning
- If the current tab is empty, suggest starting with: ticker, chart, balance
- Prefer recommending which modules belong together in a Watch / Trade / Review tab
- When multiple tabs exist, explain which tab a module fits best in
- The user manually organizes tabs and layout — you recommend structure, not precise drag-and-drop placement
- Keep responses concise — users are watching live markets
- If unsure what the user wants, ask one short clarifying question
- You can explain what a component does before enabling it`;
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
