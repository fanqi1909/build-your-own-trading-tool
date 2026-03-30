'use strict';
/**
 * tests/phase4.test.js — Phase 4 AI Assistant Core automated checks
 *
 * Checks:
 *   4.1 System prompt includes all capabilities from manifest
 *   4.2 System prompt includes enabledIds context label
 *   4.3 Action tag parsing works for enable/disable/set-mode
 */

const assert = require('assert');
const path   = require('path');

const { buildSystemPrompt, parseActions, stripActionTags } =
  require('../core/ai/assistant');
const manifest = require('../plugins/okx/manifest.json');

// ── 4.1 System prompt includes all 11 capabilities ───────────────────────────

{
  const prompt = buildSystemPrompt(manifest);
  const caps   = Object.values(manifest.capabilities);

  let pass = true;
  for (const cap of caps) {
    if (!prompt.includes(cap.component)) {
      console.error(`[4.1] FAIL — component "${cap.component}" not found in system prompt`);
      pass = false;
    }
  }
  if (pass) {
    console.log(`[4.1] PASS — system prompt includes all ${caps.length} capability components`);
  }
}

// ── 4.2 System prompt includes journey stage hints ────────────────────────────

{
  const prompt = buildSystemPrompt(manifest);
  const stages = manifest.journey?.stages || [];

  let pass = true;
  for (const stage of stages) {
    if (!prompt.includes(stage.id)) {
      console.error(`[4.2] FAIL — stage "${stage.id}" not found in system prompt`);
      pass = false;
    }
  }
  // Also confirm the layout context placeholder is mentioned
  if (!prompt.includes('[Layout:')) {
    console.error('[4.2] FAIL — [Layout: ...] context placeholder missing from system prompt');
    pass = false;
  }
  if (pass) {
    console.log(`[4.2] PASS — system prompt includes all ${stages.length} journey stages and layout context hint`);
  }
}

// ── 4.3 Action tag parsing ────────────────────────────────────────────────────

{
  const tests = [
    {
      label: 'enable-component self-closing',
      input: 'Sure! <enable-component id="chart"/> Added the chart.',
      expected: [{ type: 'enable-component', id: 'chart' }],
    },
    {
      label: 'disable-component',
      input: '<disable-component id="analysis"/> Removed analysis.',
      expected: [{ type: 'disable-component', id: 'analysis' }],
    },
    {
      label: 'set-mode',
      input: 'Switching now. <set-mode mode="live"/> Be careful!',
      expected: [{ type: 'set-mode', mode: 'live' }],
    },
    {
      label: 'multiple tags in one response',
      input: '<enable-component id="ticker"/>\n<enable-component id="chart"/>\n<disable-component id="balance"/>',
      expected: [
        { type: 'enable-component',  id: 'ticker' },
        { type: 'enable-component',  id: 'chart' },
        { type: 'disable-component', id: 'balance' },
      ],
    },
    {
      label: 'no tags → empty array',
      input: 'Hello! How can I help you today?',
      expected: [],
    },
    {
      label: 'stripActionTags removes tags from display text',
      input: 'Adding chart now. <enable-component id="chart"/> Enjoy!',
      stripExpected: 'Adding chart now.  Enjoy!',
    },
  ];

  let allPass = true;
  for (const t of tests) {
    if (t.stripExpected !== undefined) {
      const result = stripActionTags(t.input);
      if (result !== t.stripExpected) {
        console.error(`[4.3] FAIL strip "${t.label}": got "${result}", want "${t.stripExpected}"`);
        allPass = false;
      }
      continue;
    }

    const result = parseActions(t.input);
    try {
      assert.deepStrictEqual(result, t.expected);
    } catch {
      console.error(`[4.3] FAIL "${t.label}":`, JSON.stringify(result), '!==', JSON.stringify(t.expected));
      allPass = false;
    }
  }

  if (allPass) {
    console.log(`[4.3] PASS — action tag parsing and stripping correct for all ${tests.length} cases`);
  }
}
