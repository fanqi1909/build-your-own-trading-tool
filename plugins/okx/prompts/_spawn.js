'use strict';
// Extracted from lib/ai.js — Claude spawn helper

const { spawn } = require('child_process');

async function spawnClaude(prompt, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('error', reject);
    const timer = setTimeout(() => { proc.kill(); reject(new Error('claude timeout')); }, timeoutMs);
    proc.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`));
    });
    proc.stdin.write(prompt, 'utf8');
    proc.stdin.end();
  });
}

module.exports = { spawnClaude };
