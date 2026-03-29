'use strict';
/**
 * lib/chat.js — AI Chat Session
 *
 * Uses Claude Code CLI as a persistent conversational backend.
 * Supports multi-turn conversation via --session-id / --resume.
 * Claude can read and modify project files via --allowedTools.
 *
 * Reference: https://fanqi1909.github.io/ai-capriccio/docs/cli-as-api.html
 */

const { spawn }  = require('child_process');
const readline   = require('readline');
const path       = require('path');
const { randomUUID } = require('crypto');

const PROJECT_ROOT = path.join(__dirname, '..');

const SYSTEM_PROMPT = `You are an AI assistant helping the user build and modify their personal trading dashboard.

Project root: ${PROJECT_ROOT}
Key files:
  - server.js          — Express + WebSocket server, data refresh loops, order actions
  - public/index.html  — Frontend UI (~3000 lines, HTML/CSS/vanilla JS)
  - lib/ai.js          — Claude analysis prompts (technical analysis, postmortem)
  - lib/store.js       — DuckDB candle DB + JSON persistence
  - adapters/okx-cli.js — OKX exchange adapter (wraps okx CLI commands)

What you can help with:
  - Add new panels, charts, or data displays to the dashboard
  - Remove or hide existing features
  - Modify trading logic or display formatting
  - Explain how any part of the code works
  - Fix bugs

Guidelines:
  - Always read the relevant file(s) before editing
  - Make minimal, targeted changes
  - After editing, briefly explain what you changed and why
  - If you edit server.js, the server auto-restarts (node --watch is running). Tell the user to refresh the browser.
  - If you edit public/index.html only, no restart needed — just tell the user to refresh.`;

class ChatSession {
  constructor() {
    this.sessionId = randomUUID();
    this.isFirst   = true;
  }

  reset() {
    this.sessionId = randomUUID();
    this.isFirst   = true;
  }

  /**
   * Send a message and stream back events.
   * Calls onChunk(text) for each text chunk.
   * Returns the final result string.
   */
  async send(message, onChunk) {
    const args = [
      '--model', 'claude-sonnet-4-6',
      '-p', message,
      '--output-format', 'stream-json',
      '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash',
      '--max-turns', '10',
      '--dangerously-skip-permissions',
    ];

    if (this.isFirst) {
      args.push('--session-id',    this.sessionId);
      args.push('--system-prompt', SYSTEM_PROMPT);
      this.isFirst = false;
    } else {
      args.push('--resume', this.sessionId);
    }

    // Remove CLAUDECODE to avoid nested-session conflicts
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn('claude', args, {
      cwd:   PROJECT_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin.end();

    const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });

    let finalResult = '';

    for await (const line of rl) {
      if (!line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }

      if (evt.type === 'assistant') {
        for (const block of evt.message?.content ?? []) {
          if (block.type === 'text' && block.text) {
            onChunk(block.text);
          }
        }
      } else if (evt.type === 'result') {
        finalResult = evt.result ?? '';
      }
    }

    await new Promise((resolve, reject) => {
      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`claude exited with code ${code}`));
        } else {
          resolve();
        }
      });
      proc.on('error', reject);
    });

    return finalResult;
  }
}

module.exports = { ChatSession };
