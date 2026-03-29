# Build Your Own Trade

[English](README.md) | [中文](README.zh-CN.md)

> **⚠️ For educational purposes only. Not financial advice. Use at your own risk.**

Build your own trading system on OKX — order execution, position tracking, technical analysis, AI-powered signals, and post-trade review, all in your browser.

![Build Your Own Trade](docs/screenshot.png)

## What You'll Build

A single-page web dashboard that connects to your OKX account and provides:

- **Live price ticker** — BTC-USDT updates every 5 seconds
- **K-line charts** — Canvas-rendered candlestick charts with action markers
- **Position tracking** — Real-time P&L, leverage, liquidation price
- **Technical analysis** — RSI, MACD, Bollinger Bands via Python script
- **AI insights** — Claude-powered market assessment and position advice
- **Order management** — Place, cancel, and amend orders from the dashboard

## Prerequisites

- OKX API credentials (create at [OKX](https://www.okx.com), demo mode recommended)
- Docker & Docker Compose **or** Node.js >= 18 + Python 3

## Quick Start (Docker)

```bash
# 1. Install OKX Trade CLI and configure credentials (one-time setup)
npm install -g @okx_ai/okx-trade-cli
okx config init    # interactive wizard, creates ~/.okx/config.toml

# 2. Start
docker compose up

# Open http://localhost:3000
```

Your `~/.okx/config.toml` is mounted read-only into the container — no need to duplicate credentials. Edit any source file locally — changes are **volume-mounted** and picked up automatically (Node.js `--watch` mode).

## Local Development (without Docker)

```bash
# Prerequisites: Node.js 20 (recommended), Python 3, OKX Trade CLI
# Note: Node 25+ may fail to compile duckdb native module. Use Docker or Node 20.
npm install -g @okx_ai/okx-trade-cli
okx config init

npm install
npm run dev        # starts with --watch for auto-reload
# Open http://localhost:3000
```

The dashboard starts in **demo mode** by default — safe for experimentation with paper trading.

## Architecture

```
Browser (index.html)
    │  WebSocket
    ▼
server.js  ──── adapters/okx-cli.js ──── okx CLI ──── OKX API
    │
    ├── lib/store.js   (DuckDB + JSON persistence)
    ├── lib/ai.js      (Claude CLI integration)
    └── analyze.py     (Technical indicators)
```

### Refresh Schedule

| Data | Interval | Source |
|------|----------|--------|
| Price ticker | 5s | `market ticker` |
| Balance & positions | 60s | `account balance` + `swap positions` |
| Open orders | 10s | `swap orders` |
| K-lines + analysis | 10min | `market candles` → `analyze.py` → Claude |
| Position tracking | 3min | Claude assessment |

### Data Storage

| Type | Engine | File |
|------|--------|------|
| K-line candles | DuckDB | `data/candles.duckdb` |
| Order history | JSON | `data/orders-{mode}.json` |
| Position tracking | JSON | `data/postrack-{mode}.json` |
| Analysis history | JSON | `data/analysis-{mode}.json` |

## File Structure

```
trade-dashboard/
├── server.js               # Entry point — Express + WebSocket + timers
├── analyze.py              # Technical analysis (reads candles, outputs indicators)
├── adapters/
│   ├── base.js             # AdapterError + type definitions (JSDoc)
│   ├── okx-cli.js          # CLI adapter (default) — shells out to `okx` command
│   └── okx-rest.js         # REST adapter (placeholder for future)
├── lib/
│   ├── store.js            # Data layer — orders, positions, candles (DuckDB)
│   └── ai.js               # AI layer — Claude spawn helper + prompt building
├── public/
│   └── index.html          # Single-file frontend (~2000 lines, vanilla JS + Canvas)
└── tests/
    ├── adapters.test.js
    ├── store.test.js
    ├── ai.test.js
    └── server.test.js      # Integration test (requires running server)
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `EXCHANGE_ADAPTER` | `okx-cli` | Adapter to use (`okx-cli` or `okx-rest`) |
| `ANALYZE_PY` | `./analyze.py` | Path to technical analysis script |
| `PORT` | `3000` | Server port (hardcoded, edit `server.js` to change) |

## Testing

```bash
# Unit tests (no external dependencies)
npm test

# Integration tests (requires okx CLI + port 3000 available)
npm run test:integration
```

## Demo / Live Mode

Switch between demo and live mode from the dashboard UI. Data is stored separately per mode — no cross-contamination.

## How to Extend

### Add a new exchange adapter

Create `adapters/my-exchange.js` exporting the same interface as `okx-cli.js` (`fetchTicker`, `fetchBalance`, `fetchPositions`, etc.), then set:

```bash
EXCHANGE_ADAPTER=my-exchange docker compose up
```

See `adapters/base.js` for the full interface definition and `adapters/okx-rest.js` for a scaffold.

### Add technical indicators

Edit `analyze.py` — it reads candle data from stdin and prints indicator text to stdout. Add any indicator your strategy needs (e.g., OBV, Ichimoku). The output is passed directly to the AI layer and displayed in the dashboard.

### Customize the AI prompts

Edit `lib/ai.js` — `buildClaudePrompt()` controls what the AI sees for market assessment, and `buildPositionTrackPrompt()` controls position advice. Adjust the prompt to match your trading style.

### Customize the frontend

Edit `public/index.html` — it's a single vanilla JS file with no build step. Add new tabs, charts, or widgets directly. Changes are picked up automatically via volume mount.

## Learn More

- [Architecture deep-dive](docs/ARCHITECT.md) — full data flow, design decisions, and module responsibilities
- [OKX Trade CLI docs](https://github.com/okx/agent-tradekit/blob/master/docs/cli-reference.md) — all available CLI commands
