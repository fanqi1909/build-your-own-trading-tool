'use strict';
/**
 * core/engine.js — Plugin loader + lifecycle manager
 *
 * Responsibilities:
 *  - Load a plugin manifest from a directory
 *  - Serve static files (public/ + plugin components)
 *  - Start the WebSocket server
 *  - Expose a context object (ctx) to plugin action handlers
 *  - Manage graceful shutdown
 */
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const express = require('express');

const { ServerBus }     = require('./bus');
const { WsServer }      = require('./ws');
const { TimerRegistry } = require('./timers');
const { createAuth }    = require('./auth');

class Engine {
  /**
   * @param {object} opts
   * @param {number} opts.port
   * @param {string} opts.pluginDir  — absolute path to plugin directory (e.g. plugins/okx)
   * @param {string} opts.staticDir  — absolute path to public directory
   */
  constructor({ port = 3000, pluginDir, staticDir, dataDir }) {
    this.port      = port;
    this.pluginDir = pluginDir;
    this.staticDir = staticDir;
    // dataDir defaults to {project_root}/data (two levels up from plugins/okx)
    this._dataDir  = dataDir || path.join(pluginDir, '..', '..', 'data');

    this.bus     = new ServerBus();
    this.timers  = new TimerRegistry();
    this.manifest = null;
    this.ws       = null;
    this._app     = null;
    this._server  = null;
    this._mode    = 'demo';
  }

  getMode() { return this._mode; }
  setMode(mode) { this._mode = mode === 'live' ? 'live' : 'demo'; }

  // ─── Plugin loading ────────────────────────────────────────────────────────

  loadManifest() {
    const manifestPath = path.join(this.pluginDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Plugin manifest not found: ${manifestPath}`);
    }
    this.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const count = Object.keys(this.manifest.capabilities || {}).length;
    console.log(`[engine] loaded plugin "${this.manifest.id}" with ${count} capabilities`);
    return this.manifest;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    this.loadManifest();

    this._app = express();
    this._app.use(express.json());

    // ── Auth (enabled when APP_PASSWORD is set) ──────────────────────────────
    let verifyWs = null;
    if (process.env.APP_PASSWORD) {
      const auth = createAuth(process.env.APP_PASSWORD);
      this._app.post('/api/auth/login',  auth.loginHandler);
      this._app.get('/api/auth/logout',  auth.logoutHandler);
      this._app.use(auth.middleware);
      verifyWs = auth.verifyWs;
      console.log('[engine] auth enabled');
    }

    this._app.use(express.static(this.staticDir));

    // Serve plugin client-side components at /plugins/:pluginId/...
    // e.g. /plugins/okx/components/ticker/ticker.js
    this._app.use('/plugins', express.static(path.dirname(this.pluginDir)));

    // Serve node_modules for client-side libraries (e.g. lightweight-charts)
    this._app.use('/node_modules', express.static(path.join(this.pluginDir, '..', '..', 'node_modules')));

    // Expose plugin manifest to client-side builder
    this._app.get('/api/manifest', (req, res) => res.json(this.manifest));

    this._server = http.createServer(this._app);
    this.ws = new WsServer(this._server, this.bus, { verifyClient: verifyWs });

    // Build shared context object passed to the plugin
    this._ctx = {
      manifest: this.manifest,
      getMode:  () => this.getMode(),
      setMode:  (m) => this.setMode(m),
      bus:      this.bus,
      ws:       this.ws,
      timers:   this.timers,
      refresh:  {},
      cache:    {
        ticker:           null,
        balance:          null,
        positions:        null,
        history:          null,
        candles:          null,
        openOrders:       [],
        algoOrders:       [],
        posMode:          'net',
        lastSlowUpdate:   0,
        lastCandleUpdate: 0,
      },
      dataDir: this._dataDir,
      onStop: [],
    };

    // Load the plugin (initializes stores, registers actions + timers, calls onReady)
    const pluginEntry = require(path.join(this.pluginDir, 'index.js'));
    await pluginEntry.register(this._ctx);

    await new Promise((resolve, reject) => {
      this._server.once('error', reject);
      this._server.listen(this.port, () => {
        console.log(`[engine] listening on http://localhost:${this.port}`);
        resolve();
      });
    });

    process.on('SIGTERM', () => this.stop('SIGTERM'));
    process.on('SIGINT',  () => this.stop('SIGINT'));
  }

  async stop(signal = 'manual') {
    console.log(`\n[engine] ${signal} — stopping...`);
    this.timers.stopAll();
    if (this.ws) await this.ws.close();
    // closeAllConnections() (Node 18.2+) force-closes keep-alive HTTP connections
    if (typeof this._server.closeAllConnections === 'function') {
      this._server.closeAllConnections();
    }
    await new Promise(resolve => this._server.close(resolve));
    if (this._ctx?.onStop) {
      await Promise.all(this._ctx.onStop.map(fn => fn()));
    }
    console.log('[engine] stopped');
    process.exit(0);
  }
}

module.exports = { Engine };
