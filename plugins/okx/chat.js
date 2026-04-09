'use strict';
// plugins/okx/chat.js — Claude Code CLI chat session
// Auth: set CLAUDE_CODE_OAUTH_TOKEN env var (sk-ant-oat01-...) — no interactive login needed.

const { spawn }      = require('child_process');
const readline       = require('readline');
const path           = require('path');
const { randomUUID } = require('crypto');
const fs             = require('fs');

const PROJECT_ROOT          = path.join(__dirname, '../..');
const DEFAULT_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts/system.md'), 'utf8');

class ChatSession {
  constructor(systemPrompt) {
    this.sessionId     = randomUUID();
    this.isFirst       = true;
    this._systemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  reset() {
    this.sessionId = randomUUID();
    this.isFirst   = true;
  }

  async send(message, onChunk) {
    const args = [
      '--model', 'claude-sonnet-4-6',
      '-p', message,
      '--output-format', 'stream-json',
      '--verbose',
      '--allowedTools', 'none',
      '--max-turns', '5',
      '--dangerously-skip-permissions',
    ];

    if (this.isFirst) {
      args.push('--session-id',    this.sessionId);
      args.push('--system-prompt', this._systemPrompt);
      this.isFirst = false;
    } else {
      args.push('--resume', this.sessionId);
    }

    const env = { ...process.env };
    delete env.CLAUDECODE; // avoid nested-session conflicts

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
        if (code !== 0 && code !== null) reject(new Error(`claude exited ${code}`));
        else resolve();
      });
      proc.on('error', reject);
    });

    return finalResult;
  }
}

module.exports = { ChatSession };
