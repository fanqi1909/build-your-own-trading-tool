# Build Your Own Trade

[English](README.md) | [中文](README.zh-CN.md)

> **⚠️ For educational purposes only. Not financial advice. Use at your own risk.**

Build your own AI-assisted OKX trading workspace — modular dashboard tabs, technical analysis, order execution, trade review, and Claude-powered recommendations, all in your browser.

![Build Your Own Trade](docs/screenshot.png)

## What It Does

This project gives you a browser-based trading workspace with:

- **Modular dashboard panels** — ticker, chart, balance, positions, orders, analysis, history, review
- **Tabbed workspaces** — split your setup into Watch / Trade / Review tabs
- **Build / Use flow** — edit the active tab in Build mode, then switch back to a cleaner Use mode
- **AI recommendations** — Claude suggests which modules fit the current tab and which tab structures make sense
- **Trade execution** — place, amend, and cancel OKX orders
- **Technical analysis** — RSI, MACD, Bollinger Bands, support/resistance, and more
- **Trade review** — order history + AI postmortem workflow

## Prerequisites

- OKX API credentials (demo mode recommended)
- Node.js >= 18
- Python 3
- OKX Trade CLI

## Local Start

```bash
npm install
npm install -g @okx_ai/okx-trade-cli
okx config init

node server.js
# Open http://localhost:3000
```

No build step is required.

If you want auto-reload during development:

```bash
npm run dev
```

## Docker Start

```bash
npm install -g @okx_ai/okx-trade-cli
okx config init

docker compose up
# Open http://localhost:3000
```

## Current Architecture

```text
Browser
  ├── public/core/app.js          # app shell, build/use mode, tabs, chat overlay
  ├── public/core/layout.js       # tabbed layout state + mounted components
  ├── public/core/builder.js      # builder side panel
  ├── public/core/chat.js         # AI chat UI
  ├── public/core/suggestions.js  # recommendations + suggested tab helpers
  └── plugins/okx/components/*    # self-contained UI panels

server.js
  └── core/engine.js              # plugin host, static serving, ws server
      └── plugins/okx/
          ├── actions/            # market/account/trading/analysis actions
          ├── store/              # DuckDB + JSON persistence
          ├── prompts/            # Claude prompts
          ├── adapter.js          # OKX CLI integration
          └── manifest.json       # capabilities + journey metadata
```

## Project Structure

```text
build-your-own-trading-tool/
├── core/                    # domain-agnostic runtime
├── plugins/okx/             # all OKX-specific logic
├── public/
│   ├── index.html           # minimal shell
│   └── core/                # client app framework (tabs, layout, chat, builder)
├── tests/                   # phased architecture and layout tests
├── docs/ARCHITECTURE_PLAN.md
└── server.js
```

## Data Storage

| Type | Engine | File |
|------|--------|------|
| K-line candles | DuckDB | `data/candles.duckdb` |
| Order history | JSON | `data/orders-{mode}.json` |
| Position tracking | JSON | `data/postrack-{mode}.json` |
| Analysis history | JSON | `data/analysis-{mode}.json` |

## Key Concepts

### Build vs Use
- **Use mode**: cleaner day-to-day dashboard usage
- **Build mode**: edit the active tab, add/remove panels, create suggested tabs

### Tabs
Each tab has its own module set and removed-history state. Example structure:
- **Watch** — ticker, chart, analysis
- **Trade** — positions, order panel, open orders
- **Review** — history, trade review, Claude insights

### AI Role
AI is best used here as a **planner/recommender**:
- recommend which modules belong in the current tab
- recommend when to create a new Watch / Trade / Review tab
- explain what a missing panel is for

The user still controls the final organization and layout.

## Testing

```bash
npm test
```

Useful focused checks:

```bash
node tests/phase5.test.js
node tests/phase6-layout.test.js
```

## Notes

- Demo mode is the safest default for experimentation
- There is no frontend build pipeline — this is vanilla JS + ES modules
- If `okx` works in your terminal but not from Node, make sure the CLI is installed and on PATH

## GitHub

Remote repo:

```text
https://github.com/fanqi1909/build-your-own-trading-tool
```
