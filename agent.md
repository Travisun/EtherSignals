# agent.md — working rules for this repository

> 任何代理/协作者在本仓库工作前先读本文件。规则与用户约定冲突时以用户最新指示为准。

## 仓库拓扑与推送策略（最重要）

| 仓库 | 可见性 | 角色 |
|---|---|---|
| `Travisun/EtherSignalsPrivate` | 私有 | **唯一开发与跟踪仓库（默认推送目标）**。以后没说的情况下，所有推送都到这里。 |
| `Travisun/EtherSignals` | 公开 | 开源参考，**已冻结：除非用户明确要求，绝不推送**。 |
| `Travisun/EtherSignalsServer` / `Travisun/EtherSignalsWeb` | 私有 | 旧的按端拆分仓库，已被本 monorepo 取代——新工作不再推送。 |

本地克隆的 remote 约定：
- `origin` → `EtherSignalsPrivate`（推送目标）
- `public` → `EtherSignals`（只拉不推的参考）

## 开发流程

1. 开发直接在本 monorepo 进行：后端改动在 `backend/`，前端在 `frontend/`。
2. 每次推送前的最低验证门槛：
   - backend：`npm run typecheck`；改了 i18n 词典加 `npm run i18n:check`；发布级改动跑 `node scripts/acceptance.mjs`（须先起服务）
   - frontend：`npx tsc --noEmit` + `npx vitest run`；改了 Prisma schema 先 `npx prisma migrate dev`（本地）/`migrate deploy`（部署机）
3. 提交信息风格：`<area>: <摘要>`（area ∈ backend / frontend / docs / repo），正文写清楚“为什么”。

## 部署

### 生产服务器（文件复制部署，非 git）

| 服务 | 主机（ssh 别名） | 远端目录 | 容器 / 端口 | 数据库 |
|---|---|---|---|---|
| backend | `opptrix-mail` | `/opt/ethersignals` | `ethersignals`，`127.0.0.1:3100→3000`，SSH 隧道访问 | 无（审计降级为 JSON，设计内） |
| frontend | `oracle-a1` | `/opt/ethersignals` | `ethersignals-app-1`，`127.0.0.1:3021`，反代+TLS | 外部 PostgreSQL（`.env` 的 DATABASE_URL） |

- **升级一律用脚本**（monorepo 根目录）：`scripts/upgrade-remote.sh <backend|frontend> [--dry-run]`。
  rsync 只同步源码（绝不触碰远端 `data/`、`.env`、node_modules、.next）→ 旧镜像打 rollback 备份 tag →
  compose build + up -d → 健康验证；失败打印回滚命令。细节见 `docs/DEPLOY-BACKEND.md` §6 与 `docs/DEPLOY-FRONTEND.md` §4。
- **数据库迁移**只发生在前端：构建期内 `prisma migrate deploy`（幂等，迁移文件已提交），构建失败自动中止、旧容器不受影响。后端无迁移步骤。
- 升级顺序两端皆安全（webhook 新字段向后兼容）；生产 webhook 链路：opptrix-mail → `https://ethersignals.com/api/webhooks/signals`（oracle-a1）。
- 本机开发实例：backend `127.0.0.1:3010`、frontend `127.0.0.1:3021`（启动命令见下）。

### 本机运行实例

- backend（`backend/` 目录）：`rm -rf .next && npm run build` → `NODE_ENV=production PORT=3010 HOST=127.0.0.1 node server.mjs`
- frontend（`frontend/` 目录）：`npx prisma migrate deploy && npm run build` → `NODE_ENV=production PORT=3021 HOSTNAME=127.0.0.1 npm run start`
- 生产构建绝不与 dev 共用 `.next`；升级一律干净重建。
- 完整拓扑（含局域网备用机）：见后端运行数据目录里的《本地部署记录》（gitignored，仅限本机，**永不提交**）。

## 密钥与敏感信息

- `.env` 与后端运行数据目录均已 gitignore——保持现状，永不提交。
- 推送前对补丁做一次敏感扫描（密钥/内网地址/机器路径）；部署记录类文档只写拓扑与命令，不写任何密钥值。
