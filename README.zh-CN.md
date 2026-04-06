# Build Your Own Trade

[English](README.md) | 中文

> **⚠️ 仅供学习参考，不构成任何投资建议。使用风险自负。**

这是一个 **AI 辅助的 OKX 交易工作台**。你可以在浏览器里构建自己的交易界面：使用标签页拆分 Watch / Trade / Review 工作流，在 Build 模式里编辑当前 tab，在 Use 模式里专注使用，并通过 Claude 获取模块推荐和工作区建议。

![构建你自己的交易系统](docs/screenshot-zh.png)

## 现在这个项目能做什么

当前版本已经支持：

- **模块化交易面板** — ticker、chart、balance、positions、orders、analysis、history、trade-review 等
- **多标签工作区** — 把不同任务拆成 Watch / Trade / Review tab
- **Build / Use 模式**
  - Build：编辑当前 tab
  - Use：更干净地使用当前工作区
- **AI 推荐** — 推荐当前 tab 适合添加哪些模块，也会推荐适合创建的 tab 结构
- **下单与订单管理** — 下单、撤单、改单、平仓
- **技术分析** — RSI、MACD、布林带、支撑阻力等
- **交易复盘** — 历史订单 + AI 复盘建议

## 前置条件

- OKX API 凭证（推荐先用模拟盘）
- Node.js >= 18
- Python 3
- OKX Trade CLI

## 本地启动

```bash
npm install
npm install -g @okx_ai/okx-trade-cli
okx config init

node server.js
# 打开 http://localhost:3000
```

开发时如果想自动重载：

```bash
npm run dev
```

这个项目当前 **没有前端构建步骤**，使用的是原生 JS + ES modules。

## Docker 启动

```bash
npm install -g @okx_ai/okx-trade-cli
okx config init

docker compose up
# 打开 http://localhost:3000
```

## 当前架构

```text
浏览器
  ├── public/core/app.js          # 应用壳、Build/Use、tabs、chat overlay
  ├── public/core/layout.js       # tabbed layout 状态与组件挂载
  ├── public/core/builder.js      # Build 模式侧边编辑面板
  ├── public/core/chat.js         # AI 聊天 UI
  ├── public/core/suggestions.js  # 推荐逻辑与 suggested tabs
  └── plugins/okx/components/*    # 各个自包含面板组件

server.js
  └── core/engine.js              # 插件宿主、静态资源、WebSocket、生命周期
      └── plugins/okx/
          ├── actions/            # market / account / trading / analysis
          ├── store/              # DuckDB + JSON 持久化
          ├── prompts/            # Claude prompts
          ├── adapter.js          # OKX CLI 集成
          └── manifest.json       # 能力声明与 journey metadata
```

## 目录结构

```text
build-your-own-trading-tool/
├── core/                    # 通用运行时（与交易所无关）
├── plugins/okx/             # OKX 插件实现
├── public/
│   ├── index.html           # 最小页面壳
│   └── core/                # 前端框架：tabs、layout、builder、chat
├── tests/                   # 单测、集成测试、阶段性布局测试
├── docs/ARCHITECTURE_PLAN.md
└── server.js
```

## 数据存储

| 类型 | 引擎 | 文件 |
|------|------|------|
| K 线 | DuckDB | `data/candles.duckdb` |
| 订单历史 | JSON | `data/orders-{mode}.json` |
| 持仓追踪 | JSON | `data/postrack-{mode}.json` |
| 分析历史 | JSON | `data/analysis-{mode}.json` |

## 核心概念

### Build vs Use
- **Use mode**：日常使用，更干净
- **Build mode**：编辑当前 tab，增删组件、创建推荐 tab

### Tabs
每个 tab 都有自己的模块集合和 recently removed 状态。一个典型组织方式是：
- **Watch** — ticker、chart、analysis
- **Trade** — positions、order-panel、open-orders
- **Review** — history、trade-review、claude-insights

### AI 的角色
AI 在这里更适合作为 **推荐者 / 规划者**：
- 推荐当前 tab 该补哪些模块
- 推荐是否应该新建 Watch / Trade / Review tab
- 解释某个组件适合放在哪个 tab

最终布局和组织仍然由用户决定。

## 测试

```bash
npm test
```

当前也可以单独跑一些更聚焦的检查：

```bash
node tests/phase5.test.js
node tests/phase6-layout.test.js
```

## 备注

- 推荐优先在 **模拟盘** 下实验
- 当前有效的交易接入方式是 **OKX CLI**
- 如果终端里 `okx` 能用，但 Node 里不能用，通常是 PATH 或 CLI 安装问题

## GitHub

远端仓库：

```text
https://github.com/fanqi1909/build-your-own-trading-tool
```
