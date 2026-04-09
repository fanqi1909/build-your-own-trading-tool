'use strict';
/**
 * plugins/okx/chat.js — Claude AI chat session
 *
 * Uses @anthropic-ai/sdk directly (replaces claude CLI subprocess).
 * Requires ANTHROPIC_API_KEY env var.
 *
 * Keeps the same public interface as before:
 *   const session = new ChatSession(systemPrompt);
 *   const result  = await session.send(message, onChunk);
 *   session.reset();
 */

const Anthropic = require('@anthropic-ai/sdk');
const path      = require('path');
const fs        = require('fs');

const DEFAULT_SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'prompts/system.md'), 'utf8'
);

const MODEL = 'claude-sonnet-4-6';

class ChatSession {
  constructor(systemPrompt) {
    this._system   = systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this._messages = []; // conversation history: { role, content }[]
    this._client   = new Anthropic.default();
  }

  reset() {
    this._messages = [];
  }

  /**
   * Send a message and stream back text chunks.
   * @param {string}   message  - user message
   * @param {Function} onChunk  - called with each text chunk as it arrives
   * @returns {Promise<string>} - full assistant response
   */
  async send(message, onChunk) {
    this._messages.push({ role: 'user', content: message });

    let fullText = '';

    const stream = await this._client.messages.stream({
      model:      MODEL,
      max_tokens: 4096,
      system:     this._system,
      messages:   this._messages,
    });

    for await (const chunk of stream) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta?.type === 'text_delta' &&
        chunk.delta.text
      ) {
        fullText += chunk.delta.text;
        onChunk(chunk.delta.text);
      }
    }

    this._messages.push({ role: 'assistant', content: fullText });
    return fullText;
  }
}

module.exports = { ChatSession };
