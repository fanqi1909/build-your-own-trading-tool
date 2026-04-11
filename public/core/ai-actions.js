/**
 * public/core/ai-actions.js — AI → Dashboard action bridge
 *
 * The AI can embed structured action tags in its responses to directly
 * control the dashboard without the user having to click:
 *
 *   [ACTION:addComponent chart]
 *   [ACTION:removeComponent balance]
 *   [ACTION:setContext instrument=ETH-USDT-SWAP]
 *   [ACTION:setContext bar=1H]
 *   [ACTION:switchTab tab-1234567890]
 *   [ACTION:addTab Trade]
 *
 * Call `parseAndExecute(text, layout, bus)` on each AI message chunk or full
 * response. Returns the text with action tags stripped (for clean display).
 */

const ACTION_RE = /\[ACTION:(\w+)(?:\s+([^\]]*))?\]/g;

/**
 * Parse action tags from AI text, execute them against layout, return clean text.
 * @param {string} text
 * @param {import('./layout.js').LayoutManager} layout
 * @param {import('./bus.js').EventBus} bus
 * @returns {string} text with action tags removed
 */
export function parseAndExecute(text, layout, bus) {
  const actions = [];
  const clean = text.replace(ACTION_RE, (_, type, argsStr) => {
    actions.push({ type, args: argsStr?.trim() || '' });
    return '';
  });

  for (const { type, args } of actions) {
    try {
      _dispatch(type, args, layout, bus);
    } catch (err) {
      console.warn('[ai-actions] failed to execute', type, args, err.message);
    }
  }

  return clean;
}

function _dispatch(type, args, layout, bus) {
  switch (type) {
    case 'addComponent': {
      const id = args;
      if (id && !layout.has(id)) layout.add(id);
      break;
    }
    case 'removeComponent': {
      const id = args;
      if (id && layout.has(id)) layout.remove(id);
      break;
    }
    case 'setContext': {
      // args format: "key=value"
      const eqIdx = args.indexOf('=');
      if (eqIdx < 0) break;
      const key = args.slice(0, eqIdx).trim();
      const val = args.slice(eqIdx + 1).trim();
      if (key) layout.patchContext({ [key]: val });
      break;
    }
    case 'switchTab': {
      const tabId = args;
      if (tabId) layout.switchTab(tabId);
      break;
    }
    case 'addTab': {
      const title = args || 'New Tab';
      layout.addTab(title);
      break;
    }
    case 'addTabWith': {
      // args format: "Title|id1,id2,id3"
      const pipeIdx = args.indexOf('|');
      if (pipeIdx < 0) { layout.addTab(args || 'New Tab'); break; }
      const title = args.slice(0, pipeIdx).trim();
      const ids   = args.slice(pipeIdx + 1).split(',').map(s => s.trim()).filter(Boolean);
      layout.addTab(title, ids);
      break;
    }
    case 'stackInto': {
      // args format: "componentId targetComponentId"
      const [cId, targetId] = args.split(/\s+/);
      if (!cId || !targetId) break;
      const colId = layout.getColId(targetId);
      if (!colId) { if (!layout.has(cId)) layout.add(cId); break; }
      if (!layout.has(cId)) layout.stackInto(cId, colId);
      break;
    }
    case 'resizeComponent': {
      // args format: "componentId size"  size: tile|half|full
      const [cId, size] = args.split(/\s+/);
      if (cId && size) layout.setItemSize?.(cId, size);
      break;
    }
    default:
      console.warn('[ai-actions] unknown action type:', type);
  }
}

/**
 * Describe available actions for use in AI system prompts.
 * Insert this into the system prompt so the AI knows what it can do.
 */
export const ACTION_PROMPT_HINT = `
You can control the user's trading dashboard by embedding action tags in your response.
Tags are invisible to the user — they execute silently. Always describe what you changed.

AVAILABLE ACTIONS:
  [ACTION:addComponent <id>]                    — add a component to the active tab
  [ACTION:removeComponent <id>]                 — remove a component
  [ACTION:stackInto <id> <existingId>]          — stack <id> below <existingId> in the same column slot
  [ACTION:addTab <title>]                       — create a new tab
  [ACTION:addTabWith <title>|<id1,id2,id3>]     — create a tab pre-populated with components
  [ACTION:switchTab <tabId>]                    — switch to a tab (use the id: from [Dashboard Tabs:])
  [ACTION:setContext instrument=<instId>]       — change instrument (e.g. ETH-USDT-SWAP)
  [ACTION:setContext bar=<bar>]                 — change timeframe (1m 3m 5m 15m 30m 1H 4H 1D)
  [ACTION:resizeComponent <id> <size>]          — resize (tile / half / full)

COMPONENT IDs (use exactly):
  chart, ticker, balance, positions, order-panel, open-orders,
  analysis, claude-insights, position-track, history, trade-review,
  watchlist, instrument-picker, trading-config

RULES:
- Only add components listed under "Not yet added:" — never add one already on screen
- For stackInto: the second argument must be an existing component already on screen
- Tab IDs come from the (id:...) shown in [Dashboard Tabs:] prefix
- You can chain multiple tags in one response
- Keep responses short — users are watching live markets

EXAMPLES:
  User: "帮我加一个K线图"
  → [ACTION:addComponent chart] 已添加K线图。

  User: "把下单面板和仓位叠在一起"
  → [ACTION:stackInto order-panel positions] 好的，下单面板已叠加到仓位下方。

  User: "切换到ETH"
  → [ACTION:setContext instrument=ETH-USDT-SWAP] 已切换到ETH。

  User: "新建一个分析tab，加上技术分析和AI洞察"
  → [ACTION:addTabWith 分析|analysis,claude-insights] 已新建"分析"tab。
`.trim();
