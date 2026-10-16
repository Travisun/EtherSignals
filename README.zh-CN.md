<p align="right"><a href="README.md">English</a> · <b>简体中文</b></p>

<p align="center">
  <img src="assets/logo.png" width="160" alt="EtherSignals — 实时加密货币趋势信号" />
</p>

<h1 align="center">EtherSignals</h1>

<p align="center">
  <b>免费的 ETHUSDT 实时趋势信号 —— 多周期状态识别、自适应指标权重、客观支撑 / 阻力位。</b>
</p>

<p align="center">
  <b>📲 不错过任何一次趋势切换 —— 信号确认即推送。</b>
</p>

<p align="center">
  <a href="https://t.me/ethersignals"><img alt="订阅免费实时信号" src="https://img.shields.io/badge/订阅免费实时信号_→_t.me%2Fethersignals-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" height="56"></a>
  &nbsp;&nbsp;
  <a href="https://ethersignals.com"><img alt="ethersignals.com — 信号看板与历史" src="https://img.shields.io/badge/ethersignals.com-看板_%26_历史-364A63?style=for-the-badge&logo=googlechrome&logoColor=white" height="56"></a>
</p>

<p align="center">
  <sub>趋势切换 · 关键位突破 · 形态事件 —— 确认的瞬间推送到你的 Telegram。<b>无需注册，完全免费。</b></sub>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge"></a>&nbsp;
  <a href="https://linux.do?ref=seal-click" target="_blank" rel="noopener noreferrer" title="Best Community · LINUX DO">
    <img src="https://linuxdo-seal.cuishushu.com/seals/seal-best-community.svg" alt="Best Community · LINUX DO" height="28" />
  </a>
</p>

---

> 🆕 **EtherSignals 现已完全开源（MIT）。** 本仓库包含完整源码：信号引擎（[`backend/`](backend/)）
> 与信号展示站（[`frontend/`](frontend/)），可自托管、可二次开发、可部署自己的信号频道。
> 直接跳到[快捷启动](#-快捷启动--五步跑通完整链路)，或查看[部署指引](docs/)。

---

## 🚀 快捷启动 · 五步跑通完整链路

在本地跑通「信号引擎 → Webhook → 信号站」全链路。前置要求：**Node ≥ 22**、npm、Docker（仅用于起一个开发数据库）。

```bash
git clone https://github.com/Travisun/EtherSignals.git
cd EtherSignals

# ① 信号站数据库（只需执行一次）
docker run -d --name ethersignals-pg-dev \
  -e POSTGRES_USER=ether -e POSTGRES_PASSWORD=ether -e POSTGRES_DB=ethersignals \
  -p 127.0.0.1:54329:5432 postgres:18-alpine

# ② 前端信号站（终端 1）
cd frontend && cp .env.example .env
#   编辑 .env 两行：
#     DATABASE_URL="postgresql://ether:ether@127.0.0.1:54329/ethersignals"
#     WEBHOOK_SECRETS="dev-webhook-secret-change-me"
npm install && npm run db:deploy
npm run dev -- -p 3001                        # → http://localhost:3001

# ③ 信号引擎（终端 2）
cd ../backend && npm install
npm run dev                                   # → http://localhost:3000
```

```text
# ④ 打通 Webhook：浏览器打开 http://localhost:3000
#    设置 → 通知 → Webhook：
#      URL   = http://127.0.0.1:3001/api/webhooks/signals
#      Token = dev-webhook-secret-change-me
#    启用 → 点「测试」→ 返回 {"accepted":1}
# ⑤ 完成：前端首页 20 秒内出现信号快照 ✅
#    （下一次趋势变化即有真实推送）
```

> 想立刻看到页面效果（不等真实信号）？在 `frontend/` 先执行 `npm run db:seed` 灌入 24 条演示数据。
> 以上为本地回环的最小配置；生产环境（HTTPS 反代、Web Push、Bitget 实盘密钥、2FA/PIN 加固）
> 请按 [docs/](docs/) 三份指引操作。

---

## 📦 仓库结构

| 目录 | 内容 | 技术栈 |
|---|---|---|
| [`backend/`](backend/) | **信号/交易引擎**：五周期趋势信号（自适应指标权重）、策略 Hooks、回测、纸上交易、网格机器人、LLM 助手、MCP（19 工具）、PostgreSQL 审计 | Next.js 14 自定义服务器 · Socket.IO · Bitget WS/REST |
| [`frontend/`](frontend/) | **信号展示站**：webhook 摄入（幂等去重）、信号流页面、Web Push 桌面通知、PWA | Next.js 16 · Prisma 6 · PostgreSQL 18 |
| [`docs/`](docs/) | **部署指引**：后端 / 前端 / Webhook 联通 | — |

数据流：`backend` 检测到趋势变化 → Webhook（Bearer token）推送全量快照 → `frontend` 校验入库 →
页面 20s 刷新 + Web Push 扇出。

## 🛠 部署指引

| 文档 | 内容 |
|---|---|
| [docs/DEPLOY-BACKEND.md](docs/DEPLOY-BACKEND.md) | 后端部署：npm / Docker Compose / 生产三路径，受限网络代理，环境变量表，首次初始化（账号、2FA、PIN、Bitget 密钥、纸上交易），运维与加固 |
| [docs/DEPLOY-FRONTEND.md](docs/DEPLOY-FRONTEND.md) | 前端部署：本地开发四步，生产 compose（构建期迁移、`NEXT_PUBLIC_*` 重建语义、反代示例），环境变量表，Web Push |
| [docs/DEPLOY-WEBHOOK.md](docs/DEPLOY-WEBHOOK.md) | Webhook 联通：两侧配置、token 轮换、幂等契约、自建第三方消费者最小示例、故障排查表 |

字段级 webhook 契约：[backend/docs/webhook.md](backend/docs/webhook.md)（生产者视角）·
[frontend/docs/WEBHOOK.md](frontend/docs/WEBHOOK.md)（消费者视角）。

---

## 📡 信号长什么样

```
[ETHUSDT] 2,440.54

TF  Signal          Win%
2m   ↓ Downtrend      32%
5m   ↑ Uptrend        30%
30m  ↓ Downtrend      28%
2h   → Range          71%
1d   ↓↓ Strong Down   36%

Levels
  Resistance    2,489.70   +2.02%
  Pivot         2,402.28   -1.57%
  Support       2,405.71   -1.43%
  Donchian-20   inside · H 2,778.00 / L 2,405.71

Patterns: MACD death cross
```

| 区块 | 含义 |
|---|---|
| **标题行** | 品种与更新时刻的最新价格 |
| **TF / Signal** | 各周期趋势状态 —— 强势上涨 ↑↑、上涨 ↑、震荡 →、下跌 ↓、强势下跌 ↓↓ |
| **Win%** | 该趋势状态在评估窗口内的历史延续命中率 |
| **Levels** | 客观阻力 / 中轴 / 支撑价位与实时距离，以及 Donchian-20 突破状态 |
| **Patterns** | 触发周期上检测到的 K 线级形态事件 |

## 🧭 工作原理

```
Bitget 行情数据（WebSocket + REST）
        │
        ▼
归一化与聚合 ──► 五个同步周期（2m → 1d）
        │
        ▼
多周期趋势评估
  · 九大指标族投票：趋势结构、动量、波动通道、
    量能与回归漂移
  · 合成状态评分将每个周期划入五种趋势档位，
    带防抖确认
        │
        ▼
自适应权重引擎
  · 按已实现表现持续再平衡各指标影响力，
    统计带近因偏好并有多重安全护栏
        │
        ▼
客观关键位引擎 ──► 经典 Pivot + Donchian-20 突破地图
        │
        ▼
分发 ──► Telegram 频道 · Webhook · 网页看板
```

核心原则（大白话版）：

- **共振优先于单一指标。** 九个独立指标族达成一致才给出强判断；分歧即视为「震荡」。
- **识别状态，而不是噪音。** 趋势档位必须在已收盘 K 线上「证明自己」才会发布；温和回撤不会翻转标签，只有实质性走坏才会。
- **一切都对照真实结果校准。** 每次发布的判断事后都会对照实际走势打分，引擎据此再平衡自身；统计带近因偏好、经过平滑，证据不足时绝不展示。
- **关键位是客观计算的，不是手画的。** 经典 Pivots 与 20 周期 Donchian 极值构成支撑/阻力地图；价格离开通道的那一刻即报告突破。
- **分级推送。** 重大状态切换与关键位突破立即推送；常规漂移合并归纳，保持频道可读。

## 📈 覆盖范围与节奏

| | |
|---|---|
| **市场** | ETHUSDT 合约（更多市场在路线图中） |
| **周期** | 2m · 5m · 30m · 2h · 1d |
| **数据源** | Bitget 公共行情 |
| **分发** | Telegram 频道（免费）· Webhook（程序化）· 网页看板 |
| **更新方式** | 变化驱动 —— 行情画面变了才通知你，而不是定时轰炸 |
| **费用** | Telegram 频道**免费** |

## ❓ 常见问题

**Telegram 频道真的免费吗？**
是的 —— [t.me/ethersignals](https://t.me/ethersignals) 对所有人免费。网页服务 [ethersignals.com](https://ethersignals.com) 提供看板、历史与 webhook 集成。

**信号推送有多快？**
确认变化后数秒内推送。轻微漂移会合并；重大状态切换与关键位突破立即推送。

**会给出买卖指令吗？**
不会。EtherSignals 发布趋势状态、延续统计与客观关键位 —— 决策在你。它是观察市场的透镜，不是自动驾驶。

**引擎用了哪些指标？**
九大指标族：趋势结构（EMA 堆叠）、动量（MACD、RSI、KDJ）、趋势强度（ADX/DMI、SuperTrend）、波动通道（布林带）、量能流，外加回归漂移。具体配比是自适应的 —— 引擎持续学习在当前市场性格中哪些指标值得更大影响力，完整实现见 [`backend/src/server/engine/`](backend/src/server/engine/)。

**这是投资建议吗？**
不是。EtherSignals 是分析工具。加密货币市场风险极高，请务必自己做研究（DYOR）。

## 🔗 相关链接

- 🌐 **在线服务**：[ethersignals.com](https://ethersignals.com)
- 📲 **免费 Telegram 频道**：[t.me/ethersignals](https://t.me/ethersignals)
- 🛠️ **完整源码（MIT）**：信号引擎在 [`backend/`](backend/)，信号站在 [`frontend/`](frontend/) —— 按 [`docs/`](docs/) 指引自托管部署。

---

<p align="center">
  <sub>为偏好信号而非噪音的交易者打造。 · © 2026 EtherSignals · MIT</sub>
</p>
