# DownTrade 机构级增强 — 审计结论与实施记录

> 2026-10-13 全面审计后的增强实施。审计对照对象：Bloomberg Terminal / TradingView / Binance·OKX 专业版 / 机构级交易系统标准（幂等、对账、风控熔断、优雅降级、可观测性）。
> 审计覆盖：交易前端、服务端引擎、安全体系、数据层与 API、全站 UX 与国际化，共发现 **P0 × 12、P1 × 40+、P2 × 30+**。

---

## 一、本次已实施（P0/P1 全量 + 部分 P2）

### 1. 资金安全（P0，全部修复）

| # | 问题 | 修复 |
|---|---|---|
| 1 | **one_way 模式平仓单既无 tradeSide 也无 reduceOnly**，残余成交会反向开仓 | `executor.ts`：one_way 下 close 单强制 `reduceOnly: true`；holdMode 未知时**拒绝下单**而非猜测 hedge |
| 2 | **网格卖出先记账后成交**，下单失败凭空释放库存、虚记盈利 | `grid.ts`：先 `execFill`，`fills.length > 0` 才更新库存/记账；买入卖出路径对称 |
| 3 | **回测外窗对齐前视偏差**（用了未来收盘价） | `runner.ts`：对齐条件改为「参考 bar 收盘时刻 ≤ 基础 bar 收盘时刻」 |
| 4 | **回测信号方向=当根K线颜色**，做空类条件全部回测成多 | 按条件语义投票定方向（MACD 金叉→多、死叉→空等），`any` 逻辑取多数派 |
| 5 | **共享 WS 通道误退订**，停一个 2m 策略会掐断 1m 策略行情 | `candleService.ts`：通道级消费者引用计数 + 每窗口陈旧看门狗（>3×TF 无数据即告警） |
| 6 | **手动下单绕过 maxOrderUsd 风控** | 统一 `preTradeCheck` 前置风控闸门：手动/策略/网格/Agent 全部经过 |
| 7 | **一键平仓无确认、失败被吞** | ConfirmDialog（列明仓位数与总名义价值）+ `Promise.allSettled` 逐笔统计成败 |
| 8 | **MCP Bearer token 用 Math.random 生成**（可预测→可伪造实盘下单） | `crypto.randomBytes(32).toString('base64url')`；全局 `uid()` 改 CSPRNG |
| 9 | **`/api/trade/leverage` 完全无鉴权** | guard(pin) + 杠杆 1-125 校验 + symbol 白名单 + 审计 |
| 10 | **GET /api/settings 泄漏 Telegram botToken / WebPush 私钥 / 订阅密钥** | maskSettings/unmask 全量补齐，设备指纹脱敏 |
| 11 | **jsonStore 读取失败静默回退默认值，下次保存即覆盖全部真实数据** | 区分 ENOENT 与损坏：损坏文件先备份（`.corrupt-<ts>`），拒绝覆盖式清零 |
| 12 | **setLeverage 静默失败，订单以错误杠杆发出** | 失败即阻断该笔订单并告警审计 |

### 2. 安全加固（P0/P1）

- **Socket.IO**：默认仅绑定 `127.0.0.1`（`HOST` 环境变量显式开放）；Origin 白名单（本地/回环，`GT_EXTRA_ORIGINS` 扩展）；握手经 `/api/auth` 会话校验，安全模式下未登录无法接收持仓/余额广播。
- **密码暴力破解**：configure/disable/totp.disable/pin.set/device.revoke 等全部密码验证分支统一走 `loginAllowed` 限速并写 `password.fail` 审计；IP 取自服务端 socket 戳记（`x-gt-client-ip`），客户端 XFF 不再被信任；限速 Map 容量上限。
- **未加 guard 的端点全部收口**：backtest POST/DELETE、strategies/bots/agents/llm GET、engine DELETE、PATCH。
- **2FA**：`totp.disable` 现在要求当前有效 2FA 码；`pin.verify` 要求会话（防锁定 DoS）；`logout-all` 要求会话；`/api/auth` GET 对未认证方只暴露 `{enabled}`。
- **设备绑定强制化**：会话绑定设备后，缺失/不匹配 `x-gt-device` 一律 401。
- **LLM 端点**：消息数 ≤60、payload ≤256KB（费用滥用防护）。
- **优雅停机**：SIGTERM/SIGINT → 停策略/网格/私有流 → 撤销引擎挂单（clientOid 前缀 `gt`）→ `flushAll()` → 退出；进程内 `x-gt-internal` 握手密钥防外部调用。
- **多副本脑裂治理**：Redis 续期改 Lua 原子 compare-and-expire；Redis 故障 **fail-closed**（宁可停不可双跑）；失去领导立即停车并进入待机重选；恢复后自动重启引擎。

### 3. 交易可靠性（P1）

- **幂等下单**：策略触发生成确定性 `clientTag`（strategyId+触发时间+动作序号），重试不会双开仓；全部失败时**回滚冷却**，信号不被瞬时故障吞掉。
- **时钟同步**：启动时及每 5 分钟对时 `/api/v2/public/time`，签名时间戳加 offset（NTP 失效容器不再全量 40101）。
- **WS 看门狗**：pong 超时 2×25s 强制重连（半开 TCP 检测）；私有流订阅改为 login-success 后一次性发送（修复 5s guard 吞订阅竞态）；重连补发 login。
- **K 线缺口**：重连追赶批次产生的过期收盘事件（>5min）不再触发策略；多 bar 批次逐 bar emit 收盘事件。
- **部分成交可见**：`partially_filled` 推送通知 + 事件。
- **`429` 计数**与 REST 错误计数进入引擎指标。
- **paper broker**：无仓位平仓不再产生幽灵成交；SL/TP 触发加 in-flight 防双发；`refPrice<=0` 拒单。
- **现货市价 sell 移除非法 `force: ioc`**；现货 limit buy 补 minTradeUSDT 检查；取整后复查最小下单量。

### 4. 风控引擎（新增 `src/server/engine/risk.ts`）

- **Kill Switch**：全局紧急停止，持久化（重启不清除），全站红色横幅 + 一键解除（PIN 保护）。
- **日亏熔断**：净值快照为基准，跌破单日限额自动暂停并告警。
- **总敞口上限**：全部持仓名义价值（10s 缓存）+ 本单超过上限即拒绝。
- **连亏熔断**：paper 平仓按策略归因，连亏 N 次自动停策略。
- **异动保护**：24h 涨跌幅超过阈值拒绝新开仓（平仓不受限）。
- 接入点：`executeOrderAction` 单一闸门 + runtime 15s 定时器喂净值。

### 5. 回测可信化

- 前视偏差修复 + 方向投票（见上）。
- **跳空止损**：止损成交价取 `min(stop, open)`（多头），不再低估亏损。
- **强平模拟**：杠杆 >1 时按维持保证金率 0.5% 估算强平价，盘中触发即以强平价结算并计数。
- **资金费率**：杠杆期货回测按 8h 结算计提（拉取历史费率，缺失时静默跳过）。
- **指标预热**：前 100 根 bar 只训练指标不产生信号。
- **样本内外切分**：自动输出 70/30 IS/OOS 收益，识别过拟合。
- 回测列表接口剥离 equity/trades 大负载（详情走 `?id=`）。

### 6. 数据与 API 增强

- **净值快照**：15s 定时落盘（上限 2 万条，防抖写）+ `GET /api/account/equity-history` + Dashboard 净值曲线卡。
- **`GET /api/stats/summary`**：今日盈亏/笔数、paper 胜率、每策略 win/loss/realizedPnl、每 bot 归因。
- **策略绩效**：paper 平仓自动归因 winCount/lossCount/realizedPnl（连亏熔断同源）。
- **`POST /api/trade/tpsl`**：持仓改 TP/SL —— paper 直接改写百分比；实盘撤旧计划单 + 挂新 mark-price 触发单（市价执行）。
- **`POST /api/trade/cancel-all`**：批量撤单（可全账户），带确认对话框；paper 模式清 paper 单。
- **事件补全**：`position.closed`、`ORDER_CANCELED` 落地（LLM Agent 事件触发随之可用）；撤单成功/失败通知；`grid.fill` 文案补 `{symbol}`。
- **启动对账**：崩溃残留的 running 回测自动标记 interrupted；bot 编辑先 stop 再 start（修复订阅引用泄漏）。

### 7. 前端专业化

- **涨跌色全局 CSS 变量**：`--up-rgb/--down-rgb` 注入 `:root`，`text-up/bg-up/10` 等全部工具类（含 flash 动画）一处切换全站生效——修复 9 处硬编码反色问题。
- **OrderForm**：交易所精度联动（tick 对齐、blur 吸附、数量按 quantityPrecision 截断）、价格 ±tick 步进按钮、预估强平价、最小下单量校验、`confirmOrders` 设置生效（关闭后实盘直发）、AI 建议的 SL/TP 自动带入、百分比按钮在无价格时禁用。
- **持仓表**：**分批平仓**（25/50/75% + 自定义数量）、**改 TP/SL 对话框**（方向合法性校验）、标的点击跳图表、使用服务端 marginSize、排序（PnL/ROE/规模/标的）+ 多空筛选。
- **订单页**：批量撤单（确认+计数）、标的搜索、`autoRefresh {n}s`。
- **Dashboard**：净值曲线卡（SVG 面积图+区间收益）、绩效概览（胜率/已实现/今日）、真实化的快速开始 checklist、引擎健康（滞后窗口数、429 计数）。
- **风控横幅**：kill switch 状态全站顶栏可见，一键解除。
- **确认弹窗全覆盖**：一键平仓/批量撤单/清空日志/删除账户/revoke 设备/停用保护/注销所有会话/重置 bot 统计/删除回测。
- **PIN 无感回放**：428 拦截的请求在 PIN 输入后自动重放，原 promise 直接拿到结果，无需重新点击。
- **轮询节流**：页面隐藏时暂停（订单/持仓/行情），节省 API 预算。
- **深链**：`/trade` intent 保留 + 持仓/订单标的可点击；策略执行日志 → `/activity?channel=strategy&strategy=<name>`。

### 8. 设置与运维

- Telegram / WebPush 测试按钮；数据 Tab（脱敏导出 JSON、清空回测/事件/净值）；删除账户/危险操作二次确认；API Key 密文显示切换；totp.disable 双因子确认。
- 引擎指标：WS 重连数、429/错误计数、时钟偏移、滞后窗口、领导状态、风控状态 → `GET /api/engine`。

---

## 二、后续路线（本轮未实施，按优先级）

### P1（下一迭代）
1. **订单生命周期闭环**：下单超时后按 clientOid 查证再定性（orders-pending 无 clientOid 过滤，需逐单核对）；失败退避重试队列。
2. **实盘成交本地账本**：私有流镜像落库（订单/成交 append-only），摆脱交易所分页限制。
3. **多账户私有流**：为每个被策略绑定的账户建独立 private stream（当前仅 active 账户有推送）。
4. **Bar-close 求值模式**：策略可选 `evalMode: intrabar | bar_close`，与回测语义完全对齐。
5. **现货平仓精确化**：按策略库存台账只平自身仓位（当前 close_positions 卖出全部余额）。
6. **限频预算**：按 Bitget endpoint 权重实现令牌桶（当前仅计数）。
7. **Markets 详情层**：资金费率历史/下次结算倒计时、OI、多空比（Bitget open-interest / history-fund-rate / long-short-ratio 接口）。
8. **参数优化**：回测 grid search + 热力矩阵；多 run 叠加对比。
9. **移动止损**（trailing stop）：paper + 实盘 plan 单（`moving_plan`）。
10. **虚拟滚动**：Markets 300+ 行、Activity 500 条。
11. **会话入 Redis**：多副本会话共享（当前重启掉线）。

### P2（打磨）
- 暗色模式（`darkMode:'class'` + 语义 token 已就绪一半：up/down 已是变量）。
- 图表上直接交易（点图表挂单）、订单线/持仓线拖拽改单。
- 快捷键下单（B/S/Esc 已有 Esc 栈基础）。
- 告警实体（价格/指标一次性告警，当前需用策略模拟）。
- Activity/Orders 虚拟化 + CSV 导出（events 已有 JSON 导出）。
- 收藏按 marketType 分离（当前 futures/spot 共用列表）。
- JSON 文件加 schema 版本号 + 迁移器。
- 秘钥静态加密（主密码派生 AES-GCM）或 OS keychain。
- `_Host-` cookie、CSP/HSTS 响应头、全局令牌桶限流、请求体统一限长。
- TOTP 重放缓存、scrypt 参数升级（N=2^17）。

---

## 三、部署注意

1. **默认只监听 127.0.0.1**——需要局域网/公网访问时设 `HOST=0.0.0.0` 并置于 TLS 反代之后。
2. 多副本部署必须配 `REDIS_URL`（fail-closed 选主）；单实例无需。
3. Docker 用户：socket.io 走 `/ws`，反代需升级协议（`proxy_set_header Upgrade/Connection`）。
4. 导出功能永远脱敏；`data/` 内文件仍为明文密钥（0600），请勿入 git。
