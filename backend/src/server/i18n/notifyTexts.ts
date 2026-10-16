/** Server-side localized notification texts (zh-CN / en), Laravel "notification lines". */
export type NotifLocale = 'zh-CN' | 'en';

const TEMPLATES: Record<string, { zh: string; en: string }> = {
  'signal.triggered': {
    zh: '策略信号触发：{name}（{symbol} {tf}）',
    en: 'Strategy signal fired: {name} ({symbol} {tf})',
  },
  // signal pushes are intentionally locale-neutral English (international)
  'signal.trend': {
    zh: '{detail}',
    en: '{detail}',
  },
  'signal.optimized': {
    zh: '🧠 {symbol} self-tuning done — replay accuracy before→after, ✓ = weights updated | {detail}',
    en: '🧠 {symbol} self-tuning done — replay accuracy before→after, ✓ = weights updated | {detail}',
  },
  'signal.rollback': {
    zh: '⏪ {symbol} {tf} underperforming — rolled back to weight version v{version}',
    en: '⏪ {symbol} {tf} underperforming — rolled back to weight version v{version}',
  },
  'signal.condition': {
    zh: '满足条件：{conditions}',
    en: 'Conditions met: {conditions}',
  },
  'strategy.started': { zh: '策略已启动：{name}', en: 'Strategy started: {name}' },
  'strategy.stopped': { zh: '策略已停止：{name}', en: 'Strategy stopped: {name}' },
  'strategy.skipped_cooldown': {
    zh: '策略 {name} 处于冷却期，已跳过触发',
    en: 'Strategy {name} skipped (cooldown)',
  },
  'grid.started': { zh: '网格机器人已启动：{name}（{symbol}）', en: 'Grid bot started: {name} ({symbol})' },
  'grid.stopped': { zh: '网格机器人已停止：{name}', en: 'Grid bot stopped: {name}' },
  'grid.fill': {
    zh: '网格成交：{name} {symbol} {side} {qty}@{price}',
    en: 'Grid fill: {name} {symbol} {side} {qty}@{price}',
  },
  'agent.message': { zh: '{message}', en: '{message}' },
  'order.placed': {
    zh: '订单已提交：{symbol} {side} {orderType} {size}@{price}',
    en: 'Order placed: {symbol} {side} {orderType} {size}@{price}',
  },
  'order.placed.paper': {
    zh: '纸上交易订单：{symbol} {side} {size}@{price}',
    en: 'Paper order: {symbol} {side} {size}@{price}',
  },
  'order.placed.fail': {
    zh: '下单失败：{symbol} {side} {size} — {reason}',
    en: 'Order failed: {symbol} {side} {size} — {reason}',
  },
  'order.canceled': { zh: '订单已撤销：{orderId}', en: 'Order canceled: {orderId}' },
  'order.cancel.fail': {
    zh: '撤单失败：{orderId} — {reason}',
    en: 'Cancel failed: {orderId} — {reason}',
  },
  'order.filled': {
    zh: '订单成交：{symbol} {side} {size}@{price}',
    en: 'Order filled: {symbol} {side} {size}@{price}',
  },
  'position.closed': {
    zh: '持仓已平仓：{symbol} {side} 盈亏 {pnl}',
    en: 'Position closed: {symbol} {side} PnL {pnl}',
  },
  'smtp.test.ok': { zh: 'SMTP 测试邮件已发送', en: 'SMTP test email sent' },
  'smtp.test.fail': { zh: 'SMTP 测试失败：{reason}', en: 'SMTP test failed: {reason}' },
  'account.test.ok': {
    zh: '交易所账户连接成功：{label}',
    en: 'Exchange account connected: {label}',
  },
  'account.test.fail': {
    zh: '交易所账户连接失败：{reason}',
    en: 'Exchange account failed: {reason}',
  },
  'llm.advice.ready': {
    zh: 'LLM 交易建议已生成：{symbol} {bias}（置信度 {confidence}）',
    en: 'LLM advice ready: {symbol} {bias} (confidence {confidence})',
  },
  'llm.no_provider': {
    zh: '未配置可用的 LLM 提供商，请在设置中添加',
    en: 'No LLM provider configured — add one in Settings',
  },
  'backtest.done': {
    zh: '回测完成：{symbol} {tf} 收益率 {returnPct}%',
    en: 'Backtest finished: {symbol} {tf} return {returnPct}%',
  },
  'backtest.error': { zh: '回测失败：{reason}', en: 'Backtest failed: {reason}' },
  'engine.error': { zh: '引擎错误：{reason}', en: 'Engine error: {reason}' },
  'engine.started': { zh: '交易引擎已启动', en: 'Trading engine started' },
  'account.switched': {
    zh: '已切换交易账户：{label}',
    en: 'Active account switched: {label}',
  },
  'settings.saved': { zh: '设置已保存', en: 'Settings saved' },
  'risk.halted': {
    zh: '⛔ 风控触发，交易已暂停：{reason}',
    en: '⛔ Risk halt — trading paused: {reason}',
  },
  'risk.resumed': { zh: '✅ 风控已解除，恢复交易', en: '✅ Risk halt cleared — trading resumed' },
  'telegram.test.ok': { zh: 'Telegram 测试消息已发送', en: 'Telegram test message sent' },
  'webhook.test.ok': { zh: 'Webhook 测试已发送', en: 'Webhook test sent' },
  'webhook.test.fail': { zh: 'Webhook 测试失败：{reason}', en: 'Webhook test failed: {reason}' },
  'telegram.test.fail': { zh: 'Telegram 测试失败：{reason}', en: 'Telegram test failed: {reason}' },
  'webpush.test.ok': { zh: 'WebPush 测试已发送', en: 'WebPush test sent' },
  'webpush.test.fail': { zh: 'WebPush 测试失败：{reason}', en: 'WebPush test failed: {reason}' },
  'tpsl.updated': {
    zh: '止盈止损已更新：{symbol} SL {sl} / TP {tp}',
    en: 'TP/SL updated: {symbol} SL {sl} / TP {tp}',
  },
  'tpsl.fail': { zh: '止盈止损更新失败：{reason}', en: 'TP/SL update failed: {reason}' },
  'order.canceled.all': {
    zh: '已撤销 {count} 个委托（{symbol}）',
    en: 'Canceled {count} orders ({symbol})',
  },
};

export function renderNotif(
  code: string,
  params: Record<string, string | number> | undefined,
  locale: NotifLocale,
): string {
  const tpl = TEMPLATES[code];
  let text = tpl ? tpl[locale === 'zh-CN' ? 'zh' : 'en'] : code;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export const LEVEL_RANK: Record<EventLevel, number> = { info: 0, success: 1, warning: 2, error: 3 };
type EventLevel = 'info' | 'success' | 'warning' | 'error';
