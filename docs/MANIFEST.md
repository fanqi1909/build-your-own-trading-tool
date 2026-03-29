# OKX Trade Dashboard — Module Manifest

## 按需加载指南

| 任务类型 | 优先读 |
|----------|-------|
| 数据持久化 / JSON / DuckDB | `lib/store.js` |
| Claude / 仓位追踪 / prompt | `lib/ai.js` |
| 技术分析 / analyze.py 调用 | `server.js` (`analysisRefresh`) + `analyze.py` |
| WebSocket 消息 / 刷新周期 | `server.js` |
| 前端 UI / 图表 / 模态框 | `public/index.html` |
| 交易所 CLI 调用 | `adapters/okx-cli.js` |

---

## 模块说明

### `lib/store.js` — 数据层

**职责：** 所有 JSON 文件读写 + DuckDB K线存储

| Export | 说明 |
|--------|------|
| `ordersStore` | `{ demo: Map, live: Map }` 内存订单表 |
| `loadOrders()` | 启动时从 `data/orders-{mode}.json` 加载 |
| `saveOrders(mode)` | 持久化到文件（含 try-catch） |
| `upsertOrders(orders, mode)` | 写内存 Map + 自动 save |
| `posTrackHistories` | `{ demo: [], live: [] }` 内存数组 |
| `posTrackHistory()` | 返回当前 mode 的数组 |
| `loadPosTrackHistory()` | 启动时加载 `data/postrack-{mode}.json` |
| `savePosTrackHistory()` | 限 200 条，持久化（含 try-catch） |
| `setPosTrackModeGetter(fn)` | 注入 `() => currentMode`（server.js 启动时调用） |
| `initCandleDB()` | 初始化 DuckDB，创建 candles 表 |
| `upsertCandles(inst, bar, candles)` | 参数化逐条 upsert（防 SQL 注入） |
| `loadCandlesFromDB(inst, bar, limit)` | 参数化查询，返回最近 N 条 |
| `getCandleConn()` | 返回 DuckDB connection（检查是否初始化） |
| `analysisHistories` | `{ demo: [], live: [] }` 内存数组 |
| `analysisHistory()` | 返回当前 mode 的数组 |
| `loadAnalysisHistory()` | 启动时加载（兼容旧 `analysis-history.json` 迁移） |
| `saveAnalysisHistory()` | 限 200 条，持久化（含 try-catch） |
| `parseAnalysis(raw)` | 从 raw string 提取 bull/bear/atr |

**存储文件：**
- `data/orders-demo.json` / `data/orders-live.json`
- `data/postrack-demo.json` / `data/postrack-live.json`
- `data/analysis-demo.json` / `data/analysis-live.json`
- `data/candles.duckdb`

---

### `lib/ai.js` — AI 层

**职责：** Claude CLI 调用封装 + 两套 prompt

| Export | 说明 |
|--------|------|
| `spawnClaude(prompt, timeoutMs?)` | 共享 spawn helper，默认 60s 超时 |
| `buildClaudePrompt(analysisRaw, positions, mode)` | 构造技术分析评估 prompt |
| `runClaudeAnalysis(analysisEntry, positions, mode)` | = buildClaudePrompt + spawnClaude |
| `buildPositionTrackPrompt(analysisRaw, positions, mode)` | 构造仓位追踪 prompt |
| `POSITION_TRACK_PROMPT` | 仓位追踪 prompt 模板字符串 |

**注意：** `autoClaudeAssess()` 和 `positionTrackRefresh()` 依赖 `cache`/`broadcast`，留在 `server.js`。

---

### `server.js` — 应用层

**职责：** Express + WebSocket 服务、刷新调度、业务逻辑

**cache 结构：**
```
cache.ticker          — 最新行情
cache.balance         — 账户余额
cache.positions       — 当前持仓
cache.history         — 历史订单（最近N条）
cache.candles         — K线数据（最多500条）
cache.openOrders      — 未成交挂单
cache.algoOrders      — 策略单（OCO）
```

**刷新周期：**
| Timer key | 间隔 | 函数 |
|-----------|------|------|
| `timers.fast` | 5s | `fastRefresh()` → ticker |
| `timers.slow` | 60s | `slowRefresh()` → balance/positions/history |
| `timers.orders` | 10s | `openOrdersRefresh()` |
| `timers.candles` | 10min | `candleRefresh()` → upsert DB → analysisRefresh |
| `timers.postrack` | 3min | `positionTrackRefresh()` 独立 |

**WS 消息 action → 处理：**
- `setMode` — 切换 demo/live，推送历史，全量刷新
- `candles` — 手动刷新 K线+分析
- `refresh` — 强制全量刷新
- `askClaude` — 手动触发 Claude 评估
- `placeOrder` — 开仓（市价/限价 + algo SL/TP）
- `cancelOrder` — 撤销挂单
- `closePosition` — 平仓/减仓
- `amendAlgoOrder` — 修改止盈止损
- `addAlgoOrder` — 新建 algo 单
- `pnlQuery` — 本地 PnL 统计

---

### `public/index.html` — 前端

**职责：** 单页面 UI，WebSocket 客户端

**关键全局变量：**
- `currentMode` — 'demo'/'live'
- `positions`, `balances`, `historyOrders`, `algoOrders`
- `localAnalysisHistory[]`, `localPosTrackHistory[]`
- `posTrackPageIdx`, `posTrackExpandedIdx`, `PT_PAGE_SIZE=5`
- `ahPageIdx`, `ahExpandedIdx`, `viewingAnalysisIdx`
- `selectedActionTs` — K线图高亮标记
- `posTrackFilterAction` — 「只看操作」过滤
- `_szUnit` ('contracts'/'usdt'), `CT_VAL=0.01`
- `chartActionMarkers[]` — K线图操作标记点击区域

**WS 消息 type → handler：**
- `ticker` → `handleTicker()` (实时 PnL 计算)
- `snapshot` → `handleSnapshot()`
- `candles` → `drawChart()`
- `analysis` → `handleAnalysis()`
- `analysisHistory` → `handleAnalysisHistory()`
- `positionTrack` → `handlePosTrack()`
- `positionTrackHistory` → `handlePosTrackHistory()`
- `claudeResponse` → `handleClaudeResponse()`
- `modeChanged` → 收到后前端已清空（setMode 发送前已清）
- `openOrders` → `handleOpenOrders()`
- `algoOrders` → `handleAlgoOrders()`
- `orderResult` / `orderStream` → 订单模态框

---

### `adapters/okx-cli.js` — 交易所层

**职责：** 封装 `okx` CLI 调用，提供统一接口

| 方法 | 说明 |
|------|------|
| `fetchTicker(inst, mode)` | 行情 |
| `fetchBalance(mode)` | 账户余额 |
| `fetchPositions(mode)` | 持仓 |
| `fetchHistory(mode)` | 历史成交 |
| `fetchOpenOrders(mode)` | 未成交挂单 |
| `fetchAlgoOrders(inst, mode)` | 策略单 |
| `fetchCandles(inst, bar, limit, mode)` | K线 |
| `placeMarketOrder(params, mode)` | 市价单 |
| `placeLimitOrder(params, mode)` | 限价单 |
| `placeAlgoOrder(params, mode)` | OCO 止盈止损 |
| `amendAlgoOrder(params, mode)` | 修改策略单 |
| `cancelOrder(params, mode)` | 撤单 |
| `closePosition(params, mode)` | 平仓/减仓 |
| `setLeverage(params, mode)` | 设置杠杆 |
