# Webhook 部署说明（后端 → 前端 / 自建消费者）

Webhook 是 EtherSignals 的信号分发通道：后端引擎在五周期趋势（`signal.trend`）发生变化时，
把**全量快照** POST 到你配置的 URL；官方前端站点和任何第三方消费者用同一个契约接收。

```
backend/（信号引擎，生产者）
   │  POST <webhook-url>
   │  Authorization: Bearer <token>
   ▼
frontend/（官方消费者）POST /api/webhooks/signals
   ├─ 校验 token / 签名 → zod 校验 schema → 按 ts 幂等入库
   └─ after(): Web Push 扇出；首页 ≤ 20s 内可见
```

字段级完整契约以这两份文档为准：

- 生产者视角：[backend/docs/webhook.md](../backend/docs/webhook.md)
- 消费者视角：[frontend/docs/WEBHOOK.md](../frontend/docs/WEBHOOK.md)

---

## 1. 后端侧配置（生产者）

进入 **设置 → 通知 → Webhook**：

1. **URL**：填消费者地址。官方前端为 `https://<your-site>/api/webhooks/signals`。
2. **Token**：与消费者 `WEBHOOK_SECRETS` 中的某一项一致。生成方式：
   ```bash
   openssl rand -hex 32
   ```
3. **启用**后点 **测试**：后端会发送一条**符合 schema 的样例快照**（而非裸探测包），严格的消费者
   也能正常入库，应返回 `{"accepted":1,"duplicates":0}`。每次测试使用新的 `ts`，因此每次都是新记录。
4. 只有 `signal.trend` 会推送，其余系统动态不进 webhook。

投递语义：10 秒超时，失败自动重试 1 次；10 秒窗口内的连续变化合并为一条（取最新状态）；
Strong 档进入/失守、关键位穿越**立即推送**（绕过合并窗口）。

## 2. 前端侧配置（官方消费者）

`frontend/.env`：

```bash
WEBHOOK_SECRETS="<openssl 生成的 token>"        # 逗号分隔可放多个
```

- 后端发送 `Authorization: Bearer <token>`，服务端**常量时间**比较，token 必须命中列表中任意一项。
- **零停机轮换**：`WEBHOOK_SECRETS=旧token,新token` → 后端改用新 token → 确认正常后从列表删除旧 token。
- 可选强化（用于接收第三方发送方）：若请求带 `X-EtherSignals-Signature` 与
  `X-EtherSignals-Timestamp` 头，端点改验 `sha256=HMAC(secret, "{timestamp}.{rawBody}")`
  （±300 秒窗口，`WEBHOOK_TIMESTAMP_TOLERANCE` 可调）。
- 生产环境 `WEBHOOK_SECRETS` 为空时启动自检会直接报错——摄入端点拒绝未签名推送。

修改后重建：`docker compose -f docker-compose.prod.yml up -d --build`。

## 3. 自建第三方消费者（最小实现）

任何能收 HTTP POST 的服务都可以做消费者。最小 Node 示例：

```js
import { createServer } from 'http';

const TOKEN = process.env.WEBHOOK_TOKEN; // 与后端设置页一致
const seen = new Set();                   // 生产环境请持久化 ts（官方前端用 Postgres 唯一键）

createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/hook') return res.end();
  if (`Bearer ${TOKEN}` !== req.headers.authorization)
    return res.writeHead(401).end();

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', () => {
    try {
      const p = JSON.parse(body);
      if (p.type !== 'signal.trend' || typeof p.ts !== 'number') throw new Error('schema');
      if (seen.has(p.ts)) return res.writeHead(200).end('{"duplicates":1}');
      seen.add(p.ts);
      console.log(`[${p.symbol}] ${p.regime} @ ${p.price} (${p.timeframe})`);
      res.writeHead(201).end('{"accepted":1}');
    } catch {
      res.writeHead(400).end();
    }
  });
}).listen(3999, '127.0.0.1');
```

### 消费端验收要点（契约保证）

- **幂等**：同一状态可能在合并窗口边界重复一次，以 `ts` 去重（官方前端的唯一键）。
- **判空**：`prob`、`patterns[].prob`、`levels.resistance`、`levels.support` 可能为 `null`/缺席
  （历史样本不足或日线预热期），`levels` 整体可为 `null`。
- **全量快照**：每条消息自包含最新状态，漏收一条不影响正确性，无需保存历史推导。
- **signals 固定 5 项**：`2m → 5m → 30m → 2h → 1d`（官方前端入库前会按此重排，不依赖线上顺序）。

### 消费端响应约定（与官方前端一致）

| 状态 | 含义 |
| --- | --- |
| `201` | 已入库 `{"accepted":1,"duplicates":0}` |
| `200` | `ts` 重复（重试/合并边界）`{"accepted":0,"duplicates":1}` |
| `401` | token 缺失/不匹配 |
| `400` / `413` | JSON/schema 非法 / 超过 64 KB |

后端把任何非 2xx 视为失败并重试一次；返回 2xx 即视为送达。

## 4. 安全清单

- token 用 `openssl rand -hex 32` 生成，**通过 HTTPS 传输**；HTTP 仅限内网。
- 消费端只绑回环（`127.0.0.1`），经反代对外时同样强制 TLS。
- 轮换走"先加后删"（见 §2），两边都不会出现窗口期 401。
- 不要把 webhook URL 公开发布：知道 URL + token 即可向你的站点写入伪造信号。

## 5. 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 设置页测试失败，`webhook http 401` | 后端 Token 与消费者 `WEBHOOK_SECRETS` 不一致；或轮换时旧 token 已被删除 |
| 测试返回 400 | 消费者不是按本契约实现（缺 `type`/`ts`/schema 字段）；对照 §3 验收要点 |
| 测试通但没有数据推送 | 只有 `signal.trend` 变化才推送（趋势切换/新形态/概率跨 5% 档）；震荡期可能长时间无推送，属正常 |
| 首页数据延迟 | 官方前端为 20s 轮询 + SSR；检查反代是否缓存了 `GET /` 与 `GET /api/signals` |
| 后端日志 `webhook delivery failed` | 超时（10s）或两次失败；检查消费者可用性与网络路径（后端出站走 `HTTPS_PROXY`） |
| 消费端返回 429 | 触发限速（官方前端 120 次/分/IP）；信号频率远低于此，通常是重试风暴或反代 IP 归并所致（检查 `TRUST_PROXY`） |
