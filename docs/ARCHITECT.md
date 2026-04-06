# OKX Trade Dashboard — Architecture

> Legacy architecture note: this document describes the earlier monolithic OKX dashboard. For the current plugin-based, tabbed Build/Use workspace architecture, start with `README.md` and `docs/ARCHITECTURE_PLAN.md`.

## 总览

早期版本是一个实时 BTC 永续合约交易看板。单进程 Node.js 服务，通过 WebSocket 向浏览器推送行情、持仓、技术分析和 AI 建议。

```
Browser (index.html)
    │  WebSocket (ws://)
    ▼
server.js  ──── adapters/okx-cli.js ──── okx CLI ──── OKX API
    │
    ├── lib/store.js   (数据持久化)
    ├── lib/ai.js      (Claude AI)
    └── analyze.py     (技术分析，通过 exec 调用)
```

---

## 目录结构

```
okx_trade_dashboard/
├── server.js               # 入口，应用层（WebSocket + 定时器 + 业务逻辑）
├── analyze.py              # 技术分析脚本（Python，读取 K线 stdin，输出指标文本）
├── adapters/
│   ├── base.js             # AdapterError 类 + 类型定义（JSDoc）
│   ├── okx-cli.js          # 通过 okx CLI 调用交易所（当前默认）
│   └── okx-rest.js         # REST 适配器占位（未实现，方法全抛 AdapterError）
├── lib/
│   ├── store.js            # 数据层：订单/持仓追踪/K线(DuckDB)/分析历史
│   └── ai.js               # AI 层：Claude spawn helper + prompt 构造
├── public/
│   └── index.html          # 单页面前端（原生 JS + Canvas，无框架）
├── data/                   # 运行时数据（gitignore 中）
│   ├── orders-demo.json
│   ├── orders-live.json
│   ├── postrack-demo.json
│   ├── postrack-live.json
│   ├── analysis-demo.json
│   ├── analysis-live.json
│   └── candles.duckdb
├── tests/
│   ├── adapters.test.js    # 适配器单元测试
│   ├── store.test.js       # 数据层单元测试
│   ├── ai.test.js          # AI 层单元测试
│   └── server.test.js      # 集成测试（需要 OKX CLI 和端口 3000）
└── docs/
    ├── ARCHITECT.md        # 本文件
    └── MANIFEST.md         # 模块注册表（按需加载上下文用）
```

---

## 模块职责划分

### `server.js` — 应用层

唯一的"胶水层"，持有全局状态，协调其他模块。

**持有的状态：**
- `currentMode`：`'demo'` | `'live'`
- `cache`：ticker / balance / positions / candles / openOrders / algoOrders / posMode
- `timers`：所有定时器的 ID（便于 graceful shutdown）

**刷新调度：**

| 定时器 | 间隔 | 内容 |
|--------|------|------|
| `timers.fast` | 5s | ticker 行情 |
| `timers.slow` | 60s | 余额 + 持仓 + 历史 |
| `timers.orders` | 10s | 未成交挂单 |
| `timers.candles` | 10min | K线 → 技术分析 → Claude → 仓位追踪 |
| `timers.postrack` | 3min | 仓位追踪（独立，有持仓才运行） |

**调用链（10min 周期）：**
```
candleRefresh()
  └── exchange.fetchCandles()       ← okx CLI
  └── store.upsertCandles()         ← DuckDB
  └── store.loadCandlesFromDB()     ← DuckDB
  └── analysisRefresh()
        └── analyze.py              ← exec
        └── store.saveAnalysisHistory()
        └── autoClaudeAssess()      ← 不 await，独立运行
        └── positionTrackRefresh()  ← 不 await，独立运行
```

**Claude 解耦原则：** `autoClaudeAssess()` 和 `positionTrackRefresh()` 均用 `.catch()` 独立运行，Claude 挂了不影响行情和分析。

---

### `adapters/okx-cli.js` — 交易所层

封装所有 `okx` CLI 调用。通过环境变量 `EXCHANGE_ADAPTER` 可切换到其他适配器。

**Demo / Live 切换：** 每个方法接收 `mode` 参数，内部拼接 `--demo` 或 `--profile live`。

**持仓模式适配（净仓 vs 买卖双向）：**
- 写操作均接受可选的 `posSide` 参数（`'long'` | `'short'` | `undefined`）
- 有 `posSide` 时附加 `--posSide` 到 CLI 命令
- `setLeverage` 在买卖模式下并发设多空两侧

**命令示例：**
```
# 净仓模式
okx --demo swap place --instId BTC-USDT-SWAP --side buy --sz 1 --ordType market

# 买卖双向模式
okx --demo swap place --instId BTC-USDT-SWAP --side buy --sz 1 --ordType market --posSide long
```

---

### `lib/store.js` — 数据层

无网络依赖，可独立测试。通过 `setPosTrackModeGetter(fn)` 注入 `currentMode`（避免循环依赖）。

**四类存储：**

| 存储 | 内存结构 | 持久化 |
|------|----------|--------|
| 订单 | `ordersStore.{demo,live}: Map<ordId, order>` | `data/orders-{mode}.json` |
| 仓位追踪 | `posTrackHistories.{demo,live}: []` | `data/postrack-{mode}.json`，限 200 条 |
| K线 | DuckDB `candles` 表 | `data/candles.duckdb` |
| 分析历史 | `analysisHistories.{demo,live}: []` | `data/analysis-{mode}.json`，限 200 条 |

**DuckDB K线策略：**
```
写：每次刷新 fetch 100 条新 K线 → upsertCandles（参数化，防 SQL 注入）
读：loadCandlesFromDB 取最近 500 条 → 给图表
```

---

### `lib/ai.js` — AI 层

封装所有 Claude 调用，无 Anthropic SDK，通过 `claude -p` CLI stdin 管道通信。

**核心函数：**

```
spawnClaude(prompt, timeoutMs=60000)
  └── spawn('claude', ['-p'])
  └── stdin.write(prompt)
  └── 60s 超时自动 kill
  └── 返回 stdout.trim()

runClaudeAnalysis(analysisEntry, positions, mode)
  └── buildClaudePrompt()   → 技术分析评估 prompt（≤200字格式）
  └── spawnClaude()

buildPositionTrackPrompt(analysisRaw, positions, mode)
  └── 仓位追踪 prompt（≤100字格式）
  └── server.js 中直接调用 spawnClaude()
```

---

### `public/index.html` — 前端

单文件，约 2000 行，原生 JS + Canvas，无构建工具。

**Tab 布局：**
```
Tab1 行情&持仓
  ┌──────────────────┬──────────────┐
  │  K线图 (Canvas)  │  持仓卡       │
  │                  │  仓位追踪卡   │
  ├──────────────────┴──────────────┤
  │  技术分析              │  Claude建议  │
  └──────────────────────────────────┘

Tab2 账户详情
  ┌────────────┬─────────────────────┐
  │  资产饼图   │  历史订单 / 分析历史  │
  │  ATR计算器  │                     │
  └────────────┴─────────────────────┘
```

**WebSocket 消息流：**
```
服务端 → 前端                前端 → 服务端
─────────────────────        ─────────────────────
ticker          (5s)         setMode
snapshot        (60s)        placeOrder
candles         (10min)      closePosition
analysis        (10min)      cancelOrder
analysisHistory (连接时)     amendAlgoOrder
positionTrack   (3min)       addAlgoOrder
positionTrackHistory         askClaude
claudeResponse               pnlQuery
openOrders      (10s)        candles (手动刷新)
algoOrders                   refresh
modeChanged
```

**关键全局变量：**
- `currentMode`、`positions[]`、`balances[]`
- `localAnalysisHistory[]`、`localPosTrackHistory[]`（前端缓存）
- `cache.posMode`（服务端推送，决定净仓/买卖标签）
- `chartActionMarkers[]`（K线图操作标记，用于复盘点击检测）

---

## 数据流（完整路径）

### 行情更新（每5秒）
```
setInterval → fastRefresh()
  → exchange.fetchTicker('BTC-USDT', mode)
  → broadcast({ type:'ticker', data, mode })
  → 前端 handleTicker()
      → 更新价格显示
      → 实时计算持仓浮盈（upl = (price - avgPx) * pos * CT_VAL）
```

### 下单流程
```
前端 confirmOrder()
  → send({ action:'placeOrder', inst, side, sz, sl, tp, lever })
  → server.js WS handler
      → 派生 posSide（买卖模式时：buy→long, sell→short）
      → exchange.setLeverage()   ← 可选
      → exchange.placeMarketOrder({ ..., posSide })
      → exchange.placeAlgoOrder({ ..., posSide })  ← 有 sl/tp 时
  → broadcast orderResult / orderStream
  → slowRefresh() + algoOrdersRefresh() + positionTrackRefresh()
```

### 技术分析流程
```
setInterval(10min) → candleRefresh()
  → exchange.fetchCandles(100条)
  → store.upsertCandles() → DuckDB
  → store.loadCandlesFromDB(500条)
  → broadcast candles → 前端重绘图表
  → analysisRefresh()
      → exec(okx | analyze.py) × 2（主图 + 高周期）
      → store.saveAnalysisHistory()
      → broadcast analysis
      → autoClaudeAssess().catch()   ← 独立，不阻塞
      → positionTrackRefresh().catch() ← 独立，不阻塞
```

---

## 持仓模式自适应

OKX 支持两种持仓模式，服务端自动检测：

| 模式 | `posSide` 字段值 | 下单是否需要 `--posSide` |
|------|----------------|------------------------|
| 净仓（net） | `"net"` | 不需要 |
| 买卖双向（long_short） | `"long"` / `"short"` | 必须 |

检测逻辑（`slowRefresh` 中）：
```javascript
cache.posMode = positions.some(p => p.posSide !== 'net') ? 'long_short' : 'net';
```

前端顶栏「净仓」/「买卖」标签随 snapshot 自动更新。

---

## 关键设计决策

| 决策 | 原因 |
|------|------|
| 不用 @anthropic-ai/sdk，直接调 `claude` CLI | 无需 API key，复用已登录的 Claude Code 身份 |
| DuckDB 存 K线，JSON 存其他 | K线需要高效范围查询；订单/分析数量少，JSON 够用 |
| demo/live 数据完全分离 | 切换模式时无数据污染 |
| Claude 用 `.catch()` 解耦 | 60s 的 Claude 调用不阻塞行情和技术分析主流程 |
| `setPosTrackModeGetter(fn)` 注入 mode | store.js 不 require server.js，避免循环依赖 |
| `timers` 对象存所有定时器 ID | graceful shutdown 时统一 clearInterval |
