# 后端部署说明（EtherSignals 信号/交易服务器）

`backend/` 是 EtherSignals 的信号生产端：Next.js 14（自定义 HTTP 服务器 + Socket.IO）单进程应用，
内置五周期趋势信号引擎、策略 Hooks、回测、纸上交易、网格机器人、LLM 助手与 MCP（19 工具），
对接 Bitget 合约与现货。信号产生后通过 **Webhook** 推送给前端站点（见
[DEPLOY-WEBHOOK.md](DEPLOY-WEBHOOK.md)）。

> 设计原则是**本地优先（local-first）**：所有密钥（交易所 API、SMTP、LLM、Telegram、Webhook token）
> 都在应用「设置」页内配置，只保存在本机 `data/` 目录（权限 0600），代码仓库中不存在任何密钥。

---

## 1. 前置要求

| 组件 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 18.17（开发）；Docker 镜像为 node:24 | 运行时依赖 undici v8，需 Node ≥ 22.10，镜像已固定 node:24-alpine |
| PostgreSQL | 16（可选） | 审计日志持久化；不配则自动降级为 JSON 文件日志 |
| Redis | 7（可选） | 多副本领导者锁 / 高可用；不配则单实例运行 |
| Docker | 24+ | 推荐的部署方式 |
| 网络 | 能访问 `api.bitget.com` / `ws.bitget.com` | 受限网络需配置代理（见 §3） |

---

## 2. 三种部署方式

### 方式 A：本地开发（npm）

```bash
npm install
npm run dev            # 开发模式，自定义服务器 + Socket.IO，http://localhost:3000
# 或
npm run build && npm start   # 生产模式
```

### 方式 B：Docker Compose 一键编排（推荐）

```bash
docker compose up -d --build
# → app       http://localhost:3000
# → postgres  审计数据库（db/init.sql 自动建表，数据在 named volume pgdata）
# → redis     领导者锁（数据在 named volume redisdata）
```

- 优雅降级：不配 `DATABASE_URL` 只写 JSON 日志；不配 `REDIS_URL` 单实例运行——**不会因为缺数据库而不可用**。
- 交易数据（密钥、策略、学习状态）挂载在 `./data`，随容器删除而保留。
- 多副本高可用：给多个副本配同一个 `REDIS_URL`，只有持有领导者锁的副本运行引擎。
- **出站 IPv4 优先**：镜像内置 `NODE_OPTIONS=--dns-result-order=ipv4first`。容器桥接网络常见
  "域名返回 AAAA 记录但实际没有 IPv6 出口"，v6 优先的连接会先挂起直到超时——设置后交易所
  REST/WebSocket 一律先走 IPv4。需要恢复系统默认时，在 compose 的 `app.environment` 里覆盖
  `NODE_OPTIONS` 即可。

### 方式 C：生产部署要点

```bash
# 重要：生产构建必须干净。.next 目录若被 dev server 污染会导致难以排查的 500
rm -rf .next && npm run build
NODE_ENV=production node server.mjs
```

1. **监听地址**：默认只绑定 `127.0.0.1`（安全默认）。需要局域网/公网访问时设 `HOST=0.0.0.0`，
   并且**务必**置于 TLS 反向代理之后（Caddy 自动 TLS 最省事）：

   ```caddy
   trading.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   Cookie 的 `secure` 标志会根据 `x-forwarded-proto` 自动启用，无需手工配置。
2. **WebSocket 跨源**：Socket.IO 只允许同源/本地 Origin；经反代访问即同源。若确需跨域，
   用 `GT_EXTRA_ORIGINS=https://a.example.com,https://b.example.com` 显式白名单。
3. **数据备份**：定期备份 `./data/` 目录与 PostgreSQL（`audit_events` 表）。

---

## 3. 受限网络环境（代理）

服务端需要直连 `api.bitget.com`（REST 行情代理、下单、K 线引导）。浏览器能上网但 Node 报
`cannot reach api.bitget.com` 时，让服务端流量走本地代理（Node 的 fetch **不会**读系统代理设置）：

```bash
HTTPS_PROXY=http://127.0.0.1:7897 npm run dev
# 或写入 .env（HTTP_PROXY / NO_PROXY 同样生效，REST + WebSocket 全覆盖）
```

- 端口以本机代理软件实际监听为准：macOS 用 `scutil --proxy` 查看。Clash Verge / Mihomo 默认
  混合端口 **7897**，旧版 Clash 7890，V2RayN 常见 10809。
- 端口写错时代理拒绝连接，启动日志会立刻打印 `[proxy] ... ECONNREFUSED`，API 报错也带同样信息。
- 自检：`node scripts/ws-probe.mjs` 同时验证 REST 与公共 WebSocket 通道。
- 浏览器端行情默认**直连** `wss://ws.bitget.com`（最低延迟）；无法直连时自动降级为服务端中继
  （约 5 秒刷新，页面有降级提示条）。

---

## 4. 环境变量

全部可选，均有安全默认值：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 端口 |
| `HOST` | `127.0.0.1` | 监听地址；`0.0.0.0` 显式开放（务必配合 TLS 反代） |
| `DATA_DIR` | `./data` | 本地持久化目录（密钥/策略/设置，权限 0600） |
| `DATABASE_URL` | 空 | PostgreSQL 连接串（审计日志）；空则 JSON 日志降级 |
| `REDIS_URL` | 空 | Redis 连接串（多副本选主）；空则单实例 |
| `HTTPS_PROXY` / `HTTP_PROXY` | 空 | 交易所出站代理 |
| `NO_PROXY` | 空 | 不走代理的地址 |
| `GT_EXTRA_ORIGINS` | 空 | Socket.IO 额外允许的 Origin（逗号分隔） |

---

## 5. 初始化（应用内 5 分钟）

1. **安全**：打开 `http://localhost:3000` → 设置 → 安全 → 设置用户名/密码（scrypt 存储）即启用保护。
   建议立即绑定 TOTP 2FA，并设置交易 PIN（下单/改设置需 PIN，3 次错误锁定，仅 2FA 可解锁）。
2. **交易账户**：设置 → 交易账户 → 添加 Bitget API（可在 Bitget 后台只授予「合约/现货交易」权限、
   不给提现）→ 测试连接 → 设为默认。支持多账户，策略可绑定单个或多个账户并行下发。
3. **纸上交易**：设置 → 通用 → 打开纸上交易模式；新策略先纸上/回测验证，再在策略卡上「切至实盘」。
4. **Webhook / Telegram 通知**：见 [DEPLOY-WEBHOOK.md](DEPLOY-WEBHOOK.md)。

---

## 6. 运维

- **健康/日志**：启动日志打印监听地址与代理状态；所有 handler 异常都会带方法/路径打印
  （不会出现静默 500）。
- **优雅停机**：`SIGTERM`/`SIGINT` → 停引擎 → 落盘存储 → 3 秒看门狗强制退出（Compose 停机无需干预）。
- **MCP 接入**：设置 → MCP → 启用后复制 JSON-RPC 配置（Bearer 鉴权，全量调用审计），
  工具清单见后端 [README](../backend/README.md)。
- **审计**：配置 `DATABASE_URL` 后，登录/PIN/订单/信号/MCP/回测六类操作全量写入 `audit_events`，
  `GET /api/audit` 可查。

## 7. 安全提示

- `data/` 含全部密钥，请勿提交或分享；服务器按「单用户自用」设计，勿暴露给不受信网络。
- API 密钥遵循最小权限：只开交易，不开提现；定期在交易所侧轮换。
- 加密货币交易风险极高，本项目不构成投资建议。
