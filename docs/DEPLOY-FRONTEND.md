# 前端部署说明（EtherSignals 信号站）

`frontend/`（EtherSignalsWeb）是只读的公开信号展示站：接收后端推送的 `signal.trend`
webhook 快照，提供信号流页面（20 秒轮询 + SSR 直读数据库）、Web Push 桌面通知、PWA、
Telegram 频道引流。**无账号体系**——站点对访客只读，唯一的写入口是 webhook 摄入端点。

架构细节见 [frontend/docs/ARCHITECTURE.md](../frontend/docs/ARCHITECTURE.md)。

---

## 1. 前置要求

| 组件 | 要求 |
| --- | --- |
| Node.js | ≥ 22（本地开发）；Docker 镜像为 node:24-slim |
| PostgreSQL | 18（Prisma 6 管理 schema，迁移文件已提交） |
| Docker | 24+（生产推荐） |

## 2. 本地开发

```bash
# 1. 开发数据库（跑一次即可，容器持久）
docker run -d --name ethersignals-pg-dev \
  -e POSTGRES_USER=ether -e POSTGRES_PASSWORD=ether -e POSTGRES_DB=ethersignals \
  -p 127.0.0.1:54329:5432 postgres:18-alpine

# 2. 配置
cp .env.example .env            # 编辑 DATABASE_URL 与 WEBHOOK_SECRETS

# 3. 安装、迁移、灌演示数据
npm install                     # postinstall 自动 prisma generate
npm run db:deploy               # prisma migrate deploy
npm run db:seed                 # 24 条假信号（仅限开发！表非空会拒绝）

# 4. 运行
npm run dev                     # http://localhost:3000
```

本地验证 webhook（token 与 `.env` 里 `WEBHOOK_SECRETS` 一致）：

```bash
TOKEN="dev-webhook-secret-change-me"

curl -X POST http://localhost:3000/api/webhooks/signals \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"signal.trend","ts":'"$(date +%s000)"',"symbol":"ETHUSDT","marketType":"futures",
       "price":2440.54,"timeframe":"5m","regime":"up","score":0.34,
       "signals":[{"tf":"5m","regime":"up","score":0.34,"prob":0.5,"patterns":[]}],
       "levels":null}'
# → {"accepted":1,"duplicates":0}
```

## 3. 生产部署

PostgreSQL 使用外部实例（宝塔自管 / 云 RDS 均可）——先建库建用户，然后：

```bash
cp .env.example .env    # 填 DATABASE_URL、WEBHOOK_SECRETS（必填）、NEXT_PUBLIC_SITE_URL 等
docker compose -f docker-compose.prod.yml up -d --build
```

行为要点：

- **监听**：容器用 host network，绑定 `127.0.0.1:${PORT:-3021}`——把 nginx / 宝塔 / Caddy 的
  TLS 反代指过去即可。`TRUST_PROXY=true`（默认）：限流用的客户端 IP 取自 `X-Forwarded-For`。
- **迁移在构建期执行**：Dockerfile 以 build arg 接收 `DATABASE_URL`（`build.network: host`
  使构建容器能到达本机回环上的数据库），`prisma migrate deploy` 幂等、每次构建都会执行；
  schema 变更随镜像一起发布，容器重启不碰数据库。
- **`NEXT_PUBLIC_*` 是构建期烘焙**：改了 `.env` 里的 `NEXT_PUBLIC_*` 后必须带 `--build` 重建镜像。
- **健康检查**：`GET /api/health`（Docker HEALTHCHECK 已配置，30s 间隔）。
- **日志轮转**：compose 已配置 json-file `max-size 10m / max-file 5`。

反代示例（nginx）：

```nginx
server {
    server_name ethersignals.example.com;
    listen 443 ssl http2;
    # ... TLS 证书配置 ...
    location / {
        proxy_pass http://127.0.0.1:3021;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 4. 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 生产必填 | PostgreSQL 连接串 |
| `WEBHOOK_SECRETS` | 生产必填 | webhook 摄入 token 列表（逗号分隔，支持零停机轮换）；为空时生产启动自检失败——摄入端点拒绝未签名推送 |
| `WEBHOOK_TIMESTAMP_TOLERANCE` | 否 | HMAC 时间戳容差秒数，默认 300 |
| `NEXT_PUBLIC_SITE_URL` | 否 | 站点公开 URL（metadata/manifest/OG/sitemap），**构建期生效** |
| `NEXT_PUBLIC_TELEGRAM_URL` | 否 | Telegram 频道链接（页头/页脚/抽屉），默认 `https://t.me/EtherSignals` |
| `NEXT_PUBLIC_GITHUB_REPO` | 否 | 展示 star 数的仓库，默认 `Travisun/EtherSignals`；仓库私有才需要 `GITHUB_TOKEN` |
| `NEXT_PUBLIC_UMAMI_URL` / `NEXT_PUBLIC_UMAMI_SITE_ID` | 否 | 自托管 Umami 统计；**改动后需同步修改 `next.config.ts` 里的 CSP**（script-src / connect-src），再重建 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | 否 | Web Push 密钥对；不配则推送优雅降级（页面打开时仍有本地通知）。生成：`npx web-push generate-vapid-keys` |
| `TRUST_PROXY` | 否 | `true`（默认）仅在确实处于反代之后；直连暴露时设 `false`，否则客户端可伪造 IP 绕过限流 |
| `PORT` | 否 | 生产监听端口，默认 3021 |

## 5. 常用运维

| 命令 | 用途 |
| --- | --- |
| `npm test` | Vitest：限流器、HMAC 签名、payload schema、工具函数 |
| `npm run lint` | ESLint（next/core-web-vitals + TS） |
| `npm run db:migrate` | 创建/应用开发迁移 |
| `npm run db:deploy` | 应用迁移（Docker 入口使用） |
| `npm run db:seed` | 灌演示数据（表非空时拒绝） |
| `npm run icons` | 从源 PNG 重新生成全部品牌图标 |

数据表只有 `Signal`（唯一键 `ts`，天然幂等去重）与 `PushSubscription` 两张，备份即 `pg_dump`。

安全模型（威胁模型与缓解措施详见 [frontend/docs/SECURITY.md](../frontend/docs/SECURITY.md)）：
CSP / X-Frame-Options 等安全头已内置于 `next.config.ts`；摄入端点限速 120 次/分/IP、
请求体上限 64 KB、token 常量时间比较。

---

## 4. 已有部署的升级（oracle-a1）

前端部署在 `oracle-a1:/opt/ethersignals`（文件复制部署，非 git；容器 `ethersignals-app-1`，
`127.0.0.1:3021`，反代 + TLS 在前；`.env` 提供 DATABASE_URL（外部 PostgreSQL）/ WEBHOOK_SECRETS /
VAPID）。一条命令完成**代码更新 + 数据库迁移 + 镜像重建 + 容器替换 + 健康验证**：

```bash
# 在 monorepo 根目录执行（先演练看差异清单，去掉 --dry-run 实际执行）
scripts/upgrade-remote.sh frontend --dry-run
scripts/upgrade-remote.sh frontend
```

脚本行为：rsync 源码（**永不触碰** `.env`、node_modules、.next、`.git`）→ 旧镜像打
`rollback-<时间戳>` 备份 tag → `docker compose -f docker-compose.prod.yml build`——
**Prisma 迁移在镜像构建期执行**（Dockerfile 内 `prisma migrate deploy`，幂等；构建失败即中止，
运行中的旧容器不受影响）→ `up -d` → 轮询 `http://127.0.0.1:3021/api/health` 到 200；
失败时打印回滚命令。

注意：**后端先于前端升级是安全的**（webhook 新增字段对旧前端透明——zod 剥离未知键）；
前端先行同样安全（`nhnl` 可选）。升级前端即完成数据库迁移，无需单独的迁移步骤。
