# Webhook 推送数据结构（signal.trend）

推送目标：`POST <your-url>`，仅推送 `signal.trend`（五周期趋势信号变化）。

## 请求头

```
Content-Type: application/json
Authorization: Bearer <你的 token>     ← 设置页 Webhook Token 字段
```

## 投递语义

| 项 | 值 |
|---|---|
| 触发 | 趋势切换 / 新形态出现 / 延续概率跨 5% 档 |
| 合并 | 10 秒窗口内的连续变化合并为一条（内容为最新状态） |
| 优先级 | Strong 档进入/失守、关键位穿越 → 立即推送（绕过窗口） |
| 超时/重试 | 10 秒超时，失败重试 1 次 |
| 过滤 | 只推 signal.trend，其余系统动态不进 webhook |

## 字段结构

```jsonc
{
  "type": "signal.trend",        // 固定值；目前只有这一种
  "ts": 1792123570978,           // 推送时间戳（Unix 毫秒）
  "message": "[ETHUSDT] ...",    // 与 Telegram 频道相同的排版文本（含换行）
  "symbol": "ETHUSDT",           // 品种
  "marketType": "futures",       // "futures" | "spot"
  "price": 2440.54,              // 推送时最新价
  "timeframe": "5m",             // 触发本次推送的周期
  "regime": "strong_down",       // 触发周期的趋势档位（见下方枚举）
  "score": -0.51,                // 触发周期的合成评分，范围 [-1, 1]，保留 3 位小数
  "signals": [                   // 完整五周期看板，顺序固定: 2m, 5m, 30m, 2h, 1d
    {
      "tf": "2m",
      "regime": "up",            // "strong_up" | "up" | "neutral" | "down" | "strong_down"
      "score": 0.341,            // 该周期合成评分 [-1, 1]
      "prob": 0.32,              // 延续胜率 0..1（该状态历史上 3 根内延续的走查命中率）；
                                 //   null = 历史样本不足（<15）
      "patterns": [              // 该周期当根出现的形态（可能为空数组）
        { "key": "macd_golden", "prob": 0.42 }   // prob 同样可为 null（样本不足）
      ]
    }
    // ... 共 5 项
  ],
  "levels": {                    // 客观关键价位；null = 日线数据不足（预热期）
    "resistance": 2489.7,        // 现价上方最近阻力（Pivot 组 ∪ Donchian-20 中选取）；价格高于全部层级时该字段整个省略
    "pivot": 2402.28,            // 经典 Pivot 中轴 PP=(H+L+C)/3，基于上一已完成交易日
    "support": 2405.71,          // 现价下方最近支撑；价格低于全部层级时该字段整个省略
    "donchianHigh": 2778.0,      // 20 根已收盘日线最高
    "donchianLow": 2405.71,      // 20 根已收盘日线最低
    "breakout": "inside"         // "up"=价格站上 Donchian 高 | "down"=跌破低 | "inside"=区间内
  }
}
```

## 枚举与取值

- **regime**: `strong_up`（强势上涨）`up`（上涨）`neutral`（震荡）`down`（下跌）`strong_down`（强势下跌）
- **patterns[].key**: `ema_align_bull` `ema_align_bear` `macd_golden` `macd_dead` `st_flip_bull` `st_flip_bear` `rsi_recovery` `rsi_fade` `donchian_break_up` `donchian_break_down` `bb_squeeze`
- **timeframe**: `2m` `5m` `30m` `2h` `1d`（2m/2h 为本地聚合）
- **breakout**: `up` `down` `inside`

## 消费端验收要点

- 幂等：同一状态可能在合并窗口边界重复一次，建议以 `ts` 去重
- `prob`/`levels.resistance`/`levels.support`/`patterns[].prob` 均可能为 `null`，判空后再用
- 每条消息都是**全量快照**：不需要保存历史来推导状态；漏收一条不影响最新一条的正确性

## 本地验证

```bash
curl -X POST https://api.telegram.org  # 无关；直接对你的 URL:
curl -X POST https://your-server.com/signal \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"type":"signal.trend","ts":0,"message":"test"}'
```

应用侧配置：设置 → Webhook → 填 URL 与 Token → 启用 → 发送测试。
