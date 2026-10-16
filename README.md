<p align="center">
  <img src="https://ethersignals.com/logo.png" width="140" alt="EtherSignals — real-time crypto trend signals" />
</p>

<h1 align="center">EtherSignals</h1>

<p align="center">
  <b>Free real-time crypto trend signals for ETHUSDT — multi-timeframe regime detection, adaptive indicator weighting and objective support&nbsp;/&nbsp;resistance levels, delivered instantly to Telegram.</b>
</p>

<p align="center">
  <a href="https://ethersignals.com"><img alt="Website" src="https://img.shields.io/badge/🌐_Live_on-ethersignals.com-2ea44f?style=for-the-badge"></a>&nbsp;
  <a href="https://t.me/ethersignals"><img alt="Telegram Channel" src="https://img.shields.io/badge/📲_Free_Signals-Telegram_Channel-26A5E4?style=for-the-badge"></a>&nbsp;
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge"></a>
</p>

---

## ✨ What is EtherSignals?

**EtherSignals** watches the ETHUSDT perpetual market around the clock and turns raw exchange data into a decision-ready trend report — the moment something meaningful changes.

Every message is a **self-contained snapshot**: you never need to scroll back through history. One glance tells you where price is, how each timeframe is leaning, how confident the model is, and where the key support and resistance levels sit.

> 🎯 **Get it free, in real time, on Telegram** → [t.me/ethersignals](https://t.me/ethersignals)
> The full experience — dashboards, history and webhook delivery — lives at [ethersignals.com](https://ethersignals.com).

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
Nine families spanning trend structure (EMA stack), momentum (MACD, RSI, KDJ), trend strength (ADX/DMI, SuperTrend), volatility channels (Bollinger) and volume flow, plus regression drift. Their exact blend is adaptive and proprietary — the engine continuously learns which indicators deserve influence in the current market character.

**Is this financial advice?**
No. EtherSignals is an analytical tool. Crypto markets are risky; always do your own research.

## 🔗 Links

- 🌐 **Online service**: [ethersignals.com](https://ethersignals.com)
- 📲 **Free Telegram channel**: [t.me/ethersignals](https://t.me/ethersignals)
- 🛠️ Engine: this repository documents the public face of EtherSignals. The server itself is closed-source.

---

<p align="center">
  <sub>Built for traders who prefer signal over noise. · © 2026 EtherSignals · MIT</sub>
</p>
