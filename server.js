'use strict';
/**
 * server.js — Entry point
 * Creates the engine, loads the OKX plugin, starts listening.
 * All domain logic lives in plugins/okx/.
 */
const path = require('path');
const { Engine } = require('./core/engine');

const engine = new Engine({
  port:      parseInt(process.env.PORT) || 3000,
  pluginDir: path.join(__dirname, 'plugins/okx'),
  staticDir: path.join(__dirname, 'public'),
});

engine.start().catch(err => {
  console.error('[engine] failed to start:', err);
  process.exit(1);
});
