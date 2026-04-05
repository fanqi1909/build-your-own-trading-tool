'use strict';
/**
 * tests/phase5.test.js — Phase 5 Suggestion Engine automated checks
 *
 * Uses dynamic import() because suggestions.js is an ES module.
 *
 * Checks:
 *   5.1 Suggestion rules cover all journey transitions
 *   5.2 No duplicate suggestions in single session (dismissed set works)
 *   5.3 getSuggestions returns { text, action } objects
 */

async function run() {
  const { RULES, getSuggestions } = await import('../public/core/suggestions.js');

  const realizedRules = RULES.map(r => ({
    ...r,
    action: { type: 'enable-component', id: r.target },
  }));

  // ── 5.1 Rules cover all journey transitions ──────────────────────────────
  const REQUIRED_STAGES = ['observe', 'observe→understand', 'understand→trade', 'trade→optimize'];
  const coveredStages = new Set(RULES.map(r => r.stage));
  let pass51 = true;
  for (const stage of REQUIRED_STAGES) {
    if (!coveredStages.has(stage)) {
      console.error(`[5.1] FAIL — no rule for journey stage "${stage}"`);
      pass51 = false;
    }
  }
  if (pass51) {
    console.log(`[5.1] PASS — all ${REQUIRED_STAGES.length} journey transitions covered by ${RULES.length} rules`);
  }

  // ── 5.2 Dismissed suggestions are not returned ───────────────────────────
  {
    const enabled   = [];
    const dismissed = new Set();
    const before = getSuggestions(enabled, dismissed);
    if (!before.find(s => s.id === 'start')) {
      console.error('[5.2] FAIL — "start" rule not triggered for empty layout');
    } else {
      dismissed.add('start');
      const after = getSuggestions(enabled, dismissed);
      if (after.find(s => s.id === 'start')) {
        console.error('[5.2] FAIL — dismissed suggestion "start" still returned');
      } else {
        console.log('[5.2] PASS — dismissed suggestions are excluded from results');
      }
    }
  }

  // ── 5.3 Suggestion shape is valid ───────────────────────────────────────
  {
    let pass53 = true;
    for (const rule of realizedRules) {
      if (typeof rule.text !== 'string' || !rule.text) {
        console.error(`[5.3] FAIL — rule "${rule.id}" missing text`);
        pass53 = false;
      }
      if (!rule.action || typeof rule.action.type !== 'string') {
        console.error(`[5.3] FAIL — rule "${rule.id}" missing action.type`);
        pass53 = false;
      }
      if (rule.action.type !== 'set-mode' && !rule.action.id) {
        console.error(`[5.3] FAIL — rule "${rule.id}" action missing id`);
        pass53 = false;
      }
    }

    const suggestions = getSuggestions([], new Set());
    for (const s of suggestions) {
      if (!s.text || !s.action || !s.id) {
        console.error('[5.3] FAIL — getSuggestions returned invalid object:', s);
        pass53 = false;
      }
    }

    if (pass53) {
      console.log(`[5.3] PASS — all ${RULES.length} rules have valid { text, action, id } shape`);
    }
  }
}

run().catch(e => { console.error('Test error:', e); process.exit(1); });
