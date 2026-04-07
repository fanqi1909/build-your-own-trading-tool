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
Available actions (use sparingly, only when directly helpful):
  [ACTION:addComponent <id>]        — add a component (ticker, chart, balance, positions, order-panel, open-orders, analysis, claude-insights, position-track, history, trade-review)
  [ACTION:removeComponent <id>]     — remove a component
  [ACTION:setContext instrument=<instId>] — switch the active instrument (e.g. ETH-USDT-SWAP)
  [ACTION:setContext bar=<bar>]     — switch the chart timeframe (1m, 3m, 5m, 15m, 30m, 1H, 4H, 1D)
  [ACTION:addTab <title>]           — create a new dashboard tab

Action tags are invisible to the user — they are executed silently. Only use them when the user explicitly asks you to change the dashboard, or when a change would clearly help them.
`.trim();
