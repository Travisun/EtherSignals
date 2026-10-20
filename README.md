<p align="right"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">
  <img src="assets/logo.png" width="160" alt="EtherSignals — real-time crypto trend signals" />
</p>

<h1 align="center">EtherSignals</h1>

<p align="center">
  <b>Free real-time crypto trend signals for ETHUSDT — multi-timeframe regime detection, adaptive indicator weighting and objective support&nbsp;/&nbsp;resistance levels.</b>
</p>

<p align="center">
  <b>📲 Never miss a regime shift — get every alert the moment it happens.</b>
</p>

<p align="center">
  <a href="https://t.me/ethersignals"><img alt="Get free real-time signals on Telegram" src="https://img.shields.io/badge/Subscribe_Free_–_Real_Time_Signals-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" height="56"></a>
  &nbsp;&nbsp;
  <a href="https://ethersignals.com"><img alt="ethersignals.com — dashboards, history and webhook delivery" src="https://img.shields.io/badge/ethersignals.com-Dashboards_%26_History-364A63?style=for-the-badge&logo=googlechrome&logoColor=white" height="56"></a>
  &nbsp;&nbsp;
  <a href="https://www.producthunt.com/products/ether-signals?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-ether-signals" target="_blank" rel="noopener noreferrer"><img alt="Ether Signals - AI based real-time crypto trend signals, graded in public | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1286330&amp;theme=dark&amp;t=1792482262855"></a>
</p>

<p align="center">
  <sub>Trend shifts · level breaks · pattern events — pushed to your Telegram the second they confirm. <b>No account, no cost.</b></sub>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge"></a>&nbsp;
  <a href="https://linux.do?ref=seal-click" target="_blank" rel="noopener noreferrer" title="Best Community · LINUX DO">
    <img src="https://linuxdo-seal.cuishushu.com/seals/seal-best-community.svg" alt="Best Community · LINUX DO" height="28" />
  </a>
</p>

---

> 🆕 **EtherSignals is now fully open source (MIT).** This repository contains the complete source:
> the signal engine ([`backend/`](backend/)) and the web dashboard ([`frontend/`](frontend/)) —
> self-host it, extend it, or deploy your own channel. Jump to the [Quick Start](#-quick-start--5-steps-to-a-running-pipeline),
> or the [deployment guides](docs/).

---

## 🚀 Quick Start · 5 steps to a running pipeline

Run the full path locally — signal engine → webhook → dashboard. Prerequisites: **Node ≥ 22**, npm, Docker (only for the dev database).

```bash
git clone https://github.com/Travisun/EtherSignals.git
cd EtherSignals

# ① Dashboard database (once)
docker run -d --name ethersignals-pg-dev \
  -e POSTGRES_USER=ether -e POSTGRES_PASSWORD=ether -e POSTGRES_DB=ethersignals \
  -p 127.0.0.1:54329:5432 postgres:18-alpine

# ② Frontend dashboard (terminal 1)
cd frontend && cp .env.example .env
#   edit two lines in .env:
#     DATABASE_URL="postgresql://ether:ether@127.0.0.1:54329/ethersignals"
#     WEBHOOK_SECRETS="dev-webhook-secret-change-me"
npm install && npm run db:deploy
npm run dev -- -p 3001                        # → http://localhost:3001

# ③ Signal engine (terminal 2)
cd ../backend && npm install
npm run dev                                   # → http://localhost:3000
```

```text
# ④ Wire the webhook: open http://localhost:3000
#    Settings → Notifications → Webhook:
#      URL   = http://127.0.0.1:3001/api/webhooks/signals
#      Token = dev-webhook-secret-change-me
#    Enable → click "Test" → {"accepted":1}
# ⑤ Done: the dashboard shows the snapshot within 4s ✅
#    (real pushes arrive on the next trend change)
```

> Want data on the page immediately? Run `npm run db:seed` in `frontend/` for 24 demo signals.
> The above is the minimal loopback setup; for production (TLS reverse proxy, Web Push, live
> Bitget keys, 2FA/PIN hardening) follow the guides in [docs/](docs/).

---

## 📦 Repository structure

| Path | What it is | Stack |
|---|---|---|
| [`backend/`](backend/) | **Signal / trading engine**: five-timeframe trend signals (adaptive indicator weighting), strategy hooks, backtesting, paper trading, grid bot, LLM assistant, MCP (19 tools), PostgreSQL audit | Next.js 14 custom server · Socket.IO · Bitget WS/REST |
| [`frontend/`](frontend/) | **Public dashboard**: webhook ingest (idempotent), signal feed, Web Push notifications, PWA | Next.js 16 · Prisma 6 · PostgreSQL 18 |
| [`docs/`](docs/) | **Deployment guides** (中文): backend / frontend / webhook integration | — |

Data flow: `backend` detects a trend change → webhook push (Bearer token) with a full snapshot →
`frontend` verifies & stores it → page refreshes within 4s + Web Push fan-out.

## 🛠 Deployment guides

| Doc | Contents |
|---|---|
| [docs/DEPLOY-BACKEND.md](docs/DEPLOY-BACKEND.md) | Backend: npm / Docker Compose / production paths, restricted-network proxy setup, env reference, first-run setup (account, 2FA, PIN, Bitget keys, paper mode), operations & hardening (中文) |
| [docs/DEPLOY-FRONTEND.md](docs/DEPLOY-FRONTEND.md) | Frontend: local dev in four steps, production compose (build-time migrations, `NEXT_PUBLIC_*` rebuild semantics, reverse proxy example), env reference, Web Push (中文) |
| [docs/DEPLOY-WEBHOOK.md](docs/DEPLOY-WEBHOOK.md) | Webhook integration: both sides' configuration, token rotation, idempotency contract, minimal third-party receiver, troubleshooting (中文) |

Field-level webhook contract: [backend/docs/webhook.md](backend/docs/webhook.md) (producer view) ·
[frontend/docs/WEBHOOK.md](frontend/docs/WEBHOOK.md) (consumer view).

---

## 📡 What a signal looks like

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

| Block | What it tells you |
|---|---|
| **Headline** | Ticker and the latest price at the moment of the update |
| **TF / Signal** | Trend state per timeframe — Strong Up ↑↑, Up ↑, Range →, Down ↓, Strong Down ↓↓ |
| **Win%** | How often this exact trend state has historically continued over the evaluation window |
| **Levels** | Objective resistance / pivot / support prices with live distance, plus Donchian-20 breakout state |
| **Patterns** | Candlestick-level events detected on the triggering timeframe |

## 🧭 How it works

```
Bitget market data (WebSocket + REST)
        │
        ▼
Normalisation & aggregation ──► five synchronized timeframes (2m → 1d)
        │
        ▼
Multi-timeframe trend evaluation
  · nine indicator families vote: trend structure, momentum,
    volatility channels, volume flow and regression drift
  · a composite regime score classifies each timeframe into
    five trend states, with anti-flicker confirmation
        │
        ▼
Adaptive weighting engine
  · indicator influence is continuously re-balanced by realized
    performance, with recency-aware statistics and safety guardrails
        │
        ▼
Objective level engine ──► classic pivots + Donchian-20 breakout map
        │
        ▼
Delivery ──► Telegram channel · webhooks · web dashboard
```

Key principles, in plain words:

- **Confluence over single indicators.** Nine independent families must agree before a strong call is made; disagreement reads as *Range*.
- **Regimes, not noise.** A trend state must *prove itself* on closed bars before it is published, and mild pullbacks never flip the label — only genuine deterioration does.
- **Everything is calibrated against what actually happened.** Every published call is later graded against realized price movement, and the engine re-balances itself from those grades. Statistics are recency-biased, smoothed, and never shown without enough evidence.
- **Levels are objective, not drawn by hand.** Classic floor-trader pivots and 20-period Donchian extremes form the support/resistance map; breakouts are reported the moment price leaves the channel.
- **Urgency-aware delivery.** Major regime shifts and level breaks go out immediately; routine drift is consolidated so the channel stays readable.

## 📈 Coverage & cadence

| | |
|---|---|
| **Market** | ETHUSDT perpetual (more markets on the roadmap) |
| **Timeframes** | 2m · 5m · 30m · 2h · 1d |
| **Data source** | Bitget public market feed |
| **Delivery** | Telegram channel (free) · webhook (programmatic) · web dashboard |
| **Update style** | Change-driven — you are notified when the picture changes, not on a timer |
| **Cost** | The Telegram channel is **free** |

## ❓ FAQ

**Is the Telegram channel really free?**
Yes — [t.me/ethersignals](https://t.me/ethersignals) is free for everyone. The web service at [ethersignals.com](https://ethersignals.com) adds dashboards, history and webhook integration.

**How fast are signals delivered?**
Within seconds of a confirmed change. Minor drift is consolidated; significant regime shifts and level breaks are pushed immediately.

**Does it give buy/sell orders?**
No. EtherSignals publishes trend states, continuation statistics and objective levels — the decision is yours. It is a lens on the market, not an autopilot.

**Which indicators power the engine?**
Nine families spanning trend structure (EMA stack), momentum (MACD, RSI, KDJ), trend strength (ADX/DMI, SuperTrend), volatility channels (Bollinger) and volume flow, plus regression drift. Their exact blend is adaptive — the engine continuously learns which indicators deserve influence in the current market character, and the full implementation is in [`backend/src/server/engine/`](backend/src/server/engine/).

**Is this financial advice?**
No. EtherSignals is an analytical tool. Crypto markets are risky; always do your own research.

## 🔗 Links

- 🌐 **Online service**: [ethersignals.com](https://ethersignals.com)
- 📲 **Free Telegram channel**: [t.me/ethersignals](https://t.me/ethersignals)
- 🛠️ **Full source, MIT**: signal engine in [`backend/`](backend/), web dashboard in [`frontend/`](frontend/) — self-host with the guides in [`docs/`](docs/).

---

<p align="center">
  <sub>Built for traders who prefer signal over noise. · © 2026 EtherSignals · MIT</sub>
</p>
