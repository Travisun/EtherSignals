# DownTrade — 专业加密货币交易工作台

本地优先（local-first）的专业交易终端：对接 **Bitget** 合约与现货，实时 WebSocket 行情、多账户下单与委托管理、
信号驱动的 **策略 Hooks（跨周期 × 跨标的多因子条件）**、**回测引擎**、**纸上交易一键上实盘**、
**PostgreSQL 全链路审计日志**、SMTP/桌面通知、多提供商 **LLM 交易助手**，并通过 **MCP 协议**（19 个工具）暴露全部能力。

白色专业交易台风格 · 移动端自适应 · 简体中文 / English 双语 · Docker 一键编排。

> **机构级加固（v1.1）**：预交易风控闸门（Kill Switch / 日亏熔断 / 总敞口 / 连亏熔断 / 异动保护）、
> one_way reduceOnly 防反向开仓、幂等 clientOid、回测去前视偏差 + 强平/资金费率/跳空模拟、
> 净值曲线与策略绩效归因、WS 通道级引用计数 + pong/陈旧看门狗、交易所时钟同步、
> Socket.IO 会话鉴权 + 默认仅监听 127.0.0.1、全站确认弹窗与涨跌色偏好全局生效。
> 详见 [docs/ENHANCEMENT_PLAN.md](docs/ENHANCEMENT_PLAN.md)。

---

## ✨ 功能总览

| 模块 | 说明 |
|---|---|
| **总览 Dashboard** | 账户权益 / 可用 / 未实现盈亏卡片、引擎状态、自选行情、涨跌榜、实时事件流、快速开始清单 |
| **行情 Markets** | 合约 + 现货全市场行情表（WS 实时刷新）、搜索 / 排序 / 自选收藏、资金费率 |
| **交易 Trade** | 专业 K 线图（lightweight-charts）：MA/EMA/BOLL、VOL、MACD/RSI/KDJ 副图；画线工具（水平线/趋势线/射线/矩形/斐波那契）；TradingView 一键切换；盘口 + 成交明细；**账户选择器（模拟盘 / 任一实盘账户）**；限价/市价、杠杆、百分比仓位、下单确认 |
| **订单 Orders** | 当前委托 / 历史委托 / 成交历史，撤单，策略单/手动单标记 |
| **持仓 Positions** | 实时持仓、未实现盈亏 / ROE / 强平价、一键平仓 / 全部平仓 |
| **策略 Hooks** | **跨周期 × 跨标的多因子条件**：每个条件可独立引用其他 K 线周期（1m~1M）与其他标的的现/合约行情（如「BTC 1h RSI<30 且 ETH 5m MACD 金叉」）；15 种条件 AND/OR 组合；动作支持通知 / 自动下单（杠杆、止盈止损）/ 平仓；**绑定单个或多个实盘账户，触发时自动并行下发**；冷却时间、单次/重复；**纸上交易 → 一键切至实盘**；JSON 导入导出 |
| **回测 Backtest** | 与实盘共用同一求值器，**支持跨周期/跨标的条件对齐回测**；手续费/滑点/止盈止损；资金曲线 + 回撤；胜率 / 盈亏比 / 最大回撤 / 夏普 / 对比买入持有 |
| **AI 助手 Assistant** | 多提供商 LLM（OpenAI 兼容 / Anthropic / Gemini / Ollama），流式对话 + 行情上下文注入，结构化交易建议一键应用到下单 |
| **审计日志** | **PostgreSQL 持久化的全链路操作/交易日志**，区分手动 / 策略 / 系统 / MCP / LLM / 回测 六类，记录账户、标的、参数与结果，用于盈亏归因与复盘（`GET /api/audit`、MCP `get_audit_logs`） |
| **设置 Settings** | Bitget **多账户** API（脱敏存储、连接测试、模拟盘）、SMTP + 桌面通知、LLM 提供商与提示词、风控（单笔上限）、MCP 管理 |
| **安全 Security** | 用户账户（scrypt）· 会话绑定**设备指纹** · **TOTP 2FA** · 交易/设置 **PIN**（3 次错误锁定，仅可 2FA 解锁）· 登录限速 · 密码验证分支全局限速 · Socket.IO 会话鉴权 · **默认仅监听 127.0.0.1**（`HOST=0.0.0.0` 显式开放）· 密钥全量脱敏 |
| **网格机器人** | 区间网格自动交易：触碰执行、初始建仓、**跨图条件启动/停止门控**、多账户并行、逐格任务状态与成交流水账本、纸上/实盘 |
| **LLM Agents** | 多 Agent：独立提示词 + 工具白名单 + 权限（真实下单需显式授权），手动/定时/事件触发，工具调用含**站内通知**，全部审计 |
| **MCP 协议** | **19 个工具**：行情 / 账户（`get_accounts`）/ 下单（可指定账户）/ 策略 CRUD / **条件即时评估** / 回测 / LLM / **审计查询**，JSON-RPC 2.0 + Bearer 鉴权 + 全量调用审计 |

## 🚀 快速开始

```bash
npm install
npm run dev          # 开发（自定义服务器 + Socket.IO）
# 或
npm run build && npm start
```

打开 http://localhost:3000。所有密钥/设置在应用内配置，保存在本机 `data/` 目录。

### 受限网络环境（重要）

服务端需要直连 `api.bitget.com`（REST 行情代理、下单、K 线引导）。若服务器所在网络无法直达交易所
（浏览器可上网但 Node 报 `cannot reach api.bitget.com`），通过标准环境变量让服务端流量走代理：

```bash
HTTPS_PROXY=http://127.0.0.1:7897 npm run dev
# 或 HTTP_PROXY / NO_PROXY（Node 服务端 REST + WebSocket 全部生效）
```

- **端口以你本机代理软件实际监听的为准**：macOS 用 `scutil --proxy` 查看（或代理软件设置页）。
  Clash Verge / Mihomo 默认混合端口是 **7897**，旧版 Clash 是 7890，V2RayN 常见 10809。
  端口写错（代理没在监听）时启动日志会立刻打印 `[proxy] ... 拒绝连接 (ECONNREFUSED)` 提示，
  服务端 API 报错也会带上同样的可操作信息。

- **浏览器端行情全部由本服务器中继**（Socket.IO `market:*` 房间 + 分层历史库 REST），浏览器不再直连
  `wss://ws.bitget.com`——只需服务器能到交易所，任何客户端网络都能用；App Socket 断线时浏览器自动
  降级为对本服务器 REST 的轮询（盘口/成交/K线约 5 秒刷新）。
- 服务端到交易所的请求失败会返回 502 与明确错误信息（`NETWORK` / `TIMEOUT`），不再是无从排查的 500。

### Docker 一键编排（推荐部署方式）

```bash
docker compose up -d --build
# → app       http://localhost:3000
# → postgres  审计数据库（自动建表）
# → redis     多副本领导者锁 / HA
```

- 未配置 `DATABASE_URL` 时自动降级为纯 JSON 日志（本地优先，永不因数据库缺失而不可用）
- 未配置 `REDIS_URL` 时单实例运行；配置后多副本自动选主，只有持有锁的副本运行引擎
- 多账户并行执行：策略触发时对所有绑定账户**同时**下发（`Promise.all` 独立签名通道），逐账户风控

### 基础配置（应用内 5 分钟）

1. **设置 → 交易账户**：添加一个或多个 Bitget API（可绑定到不同策略）→ 测试连接 → 设为默认
2. **纸上交易**：设置 → 通用 → 打开纸上交易模式；或在策略卡上随时「切至实盘」（红色确认）
3. **策略 Hooks**：新建 → 条件可引用其他周期/标的 → 绑定账户 → 启动

### 交易对与周期

合约默认 `usdt-futures`（BTCUSDT 等），现货 `SPOT`。K 线周期共 **16 档**：
`1m 2m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 2d 3d 1w 1M` — 其中 **2m/2h/8h/2d** 由本地从 1m/1h/1d 实时聚合合成（Bitget 无原生 2 分钟/2 小时/8 小时/2 日线），图表、策略跨图条件与回测三层均一致支持。

行情链路：**浏览器不直连交易所**。服务器端 `CandleService`（单条交易所 WS）+ 分层历史库（1m/1h/1d JSONL，约 5.5 天 / 166 天 / 6.8 年深度）统一供给；历史 K 线经 `/api/market/candles`（服务器库优先、异步回填），实时 candle / ticker / 盘口 / 成交经 Socket.IO `market:*` 房间中继；App Socket 断线时浏览器自动退化为对本服务器 REST 的轮询。多客户端共用服务器的单条交易所连接，互不冲击交易所限频。

## 🪝 新高新低阶梯（跨图核心参考）

交易页「新高新低」条带为每个周期（`1m 1h 4h 8h 12h 1d 2d 3d 1w 1M`）回答三个问题（全部针对**实时价**）：

1. **本K新高/新低** — 现价是否正处于当前未收盘 K 柱的运行最高/最低点
2. **破前K高/低** — 现价是否突破上一根收盘 K 柱的高/低点
3. **破 N 根通道** — 现价是否突破前 N 根（默认 20，`donN` 可调）收盘 K 的 Donchian 通道

服务端计算（`levelsService`，任一阶梯窗口更新即 500ms 节流推送 `levels:update`），REST 初值 `GET /api/market/levels`。同一套口径已接入策略条件：`price_new_high` / `price_new_low` / `donchian_break_up` / `donchian_break_down`（配 `tf` 覆盖即为跨图条件，回测同口径支持）。

## 🧠 架构

```
浏览器 (React + Next.js App Router)
├── Socket.IO /ws ← 全部行情中继（candle/ticker/book/trade/levels）
│                    + 服务端推送（通知/账户/持仓/订单/引擎状态/信号）
└── REST /api/*   ← 历史K线（服务器分层库优先）、账户、策略、回测…

Node 服务端（单进程，server.mjs；多副本由 Redis 选主；唯一交易所客户端）
├── Runtime
│   ├── CandleService      多窗口 K 线中枢（策略跨图数据源）+ Ticker 缓存
│   ├── MarketHistory      分层历史库：1m/1h/1d JSONL 捕获+回填（data/market/）
│   ├── MarketRelay        行情房间中继（candle 300ms / book 400ms / trade 300ms）
│   ├── LevelsService      新高新低阶梯（10 周期 × 本K/前K/Donchian）500ms 推送
│   ├── PrivateStream      私有 WS → 成交通知 + UI 快照推送
│   ├── RuleEngine         多因子条件评估（跨周期/跨标的）
│   │                      → 冷却 → 多账户并行扇出 → 通知/审计/统计
│   ├── PaperBroker        纸上交易（独立账本、SL/TP、策略归因）
│   └── Notifier           Laravel 风格：EventBus → Socket / SMTP 队列 / 审计
├── PostgreSQL (audit_events)  手动|策略|系统|MCP|LLM|回测 全链路日志
├── Redis (可选)               领导者锁，多副本高可用
└── MCP Server (POST /api/mcp) 19 tools, Bearer 鉴权, 调用全量审计
```

## 🪝 跨图因子条件

每个条件可独立设置 **市场 + 标的 + 周期**（留空跟随策略本体）：

```
BTCUSDT·1H RSI(14) < 30  ∧  ETHUSDT·5M·合约 MACD 金叉  ∧  价格 > MA20  →  市价开多 0.01 BTC @ 5× 账户A+账户B
```

- 实时引擎：为所有被引用窗口维护独立 WS 订阅（引用计数），任一窗口更新即驱动评估
- 回测：外部序列按基础 K 线时间二分对齐（无前视），逐 bar 取该窗口已收盘数据
- LLM 方向条件、15 种技术条件全部支持跨图引用

## 🤖 MCP 接入（19 工具）

设置 → MCP → 启用并复制配置。工具一览：

`get_ticker` `list_tickers` `get_candles` `get_market_context` `get_accounts` `get_balance` `get_positions`
`get_open_orders` `get_order_history` `place_order`（可指定账户；实盘需 `confirm:true`）`cancel_order`
`list_strategies` `create_strategy`（支持跨图条件与账户绑定）`toggle_strategy` `evaluate_conditions`（即时评估）
`run_backtest` `ask_llm` `get_signals` `get_audit_logs`

## 🔐 安全与远程访问

- **设置 → 安全**：设置用户名/密码即启用保护 —— 全部敏感 API 需要登录会话（cookie httpOnly + sameSite=strict + secure 自动探测 HTTPS 代理）
- **2FA**：TOTP（Google Authenticator 等），手动录入密钥绑定
- **交易 PIN**：下单/撤单/策略/机器人/设置变更需 PIN；连续 3 次错误锁定，**仅可通过 2FA 解锁**
- **设备指纹**：会话绑定浏览器指纹，新设备需 2FA 注册；设置页可查看/移除设备、一键注销全部会话
- **远程部署**：`docker compose` 后建议前置 HTTPS 反向代理（如 Caddy 自动 TLS）；cookie secure 标志根据 `x-forwarded-proto` 自动启用
- 全部操作（登录/PIN 事件/订单/信号/MCP 调用）写入 PostgreSQL 审计日志，六类分级可查

## ⚠️ 风险提示

- 加密货币交易风险极高，本工具不构成投资建议。
- 新策略先在纸上交易/回测验证，再用小资金实盘；「切至实盘」前确认账户绑定正确。
- API 密钥仅存本机 `data/`（0600），请勿提交或分享；建议只授予交易权限。
- Bitget 接口端点集中在 `src/server/bitget/rest.ts`，便于单点维护。

## 🛠 技术栈

Next.js 14 (App Router) · React 18 · TypeScript · TailwindCSS · Zustand · lightweight-charts ·
Socket.IO · lucide-react · nodemailer · PostgreSQL (pg) · Redis (ioredis) · Web Push (VAPID) · TOTP/PIN 安全层 · MCP (JSON-RPC 2.0)

## 📄 License

仅供学习与个人使用（MIT）。
