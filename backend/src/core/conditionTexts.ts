/** Human-readable condition templates — shared by the UI, mail channel and MCP. */
import type { Condition } from '@/core/types';

const T: Record<string, { zh: string; en: string }> = {
  price_above: { zh: '价格 > {value}', en: 'Price > {value}' },
  price_below: { zh: '价格 < {value}', en: 'Price < {value}' },
  price_cross_up: { zh: '价格上穿 {value}', en: 'Price crosses above {value}' },
  price_cross_down: { zh: '价格下穿 {value}', en: 'Price crosses below {value}' },
  price_change_pct: { zh: '{bars}根K线涨跌幅 {pct}%', en: '{bars}-bar change {pct}%' },
  price_new_high: { zh: '创本K新高', en: 'New high of forming bar' },
  price_new_low: { zh: '创本K新低', en: 'New low of forming bar' },
  donchian_break_up: { zh: '突破{bars}根K线新高', en: 'Breaks {bars}-bar high' },
  donchian_break_down: { zh: '跌破{bars}根K线新低', en: 'Breaks {bars}-bar low' },
  rsi_above: { zh: 'RSI({period}) > {value}', en: 'RSI({period}) > {value}' },
  rsi_below: { zh: 'RSI({period}) < {value}', en: 'RSI({period}) < {value}' },
  macd_golden: { zh: 'MACD 金叉', en: 'MACD golden cross' },
  macd_death: { zh: 'MACD 死叉', en: 'MACD death cross' },
  ma_cross_up: { zh: 'MA({fast}) 上穿 MA({slow})', en: 'MA({fast}) crosses above MA({slow})' },
  ma_cross_down: { zh: 'MA({fast}) 下穿 MA({slow})', en: 'MA({fast}) crosses below MA({slow})' },
  volume_spike: { zh: '成交量 > {ratio}× 均量', en: 'Volume > {ratio}× average' },
  boll_break_up: { zh: '突破布林上轨({period},{mult})', en: 'Bollinger upper break ({period},{mult})' },
  boll_break_down: { zh: '跌破布林下轨({period},{mult})', en: 'Bollinger lower break ({period},{mult})' },
  llm_bias: { zh: 'LLM 判定为 {bias}（置信度≥{minConfidence}）', en: 'LLM bias {bias} (conf ≥ {minConfidence})' },
};

export function describeCondition(cond: Condition, locale: 'zh-CN' | 'en'): string {
  const tpl = T[cond.type];
  if (!tpl) return cond.type;
  let text = tpl[locale === 'zh-CN' ? 'zh' : 'en'];
  if (cond.params) {
    for (const [k, v] of Object.entries(cond.params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  // cross-symbol / cross-timeframe scope prefix
  const scope: string[] = [];
  if (cond.symbol) scope.push(cond.symbol);
  if (cond.tf) scope.push(cond.tf.toUpperCase());
  if (cond.marketType) scope.push(cond.marketType === 'spot' ? (locale === 'zh-CN' ? '现货' : 'spot') : locale === 'zh-CN' ? '合约' : 'futures');
  return scope.length ? `${scope.join('·')} ${text}` : text;
}

export const CONDITION_META: Record<string, { params: { key: string; label: string; def: number | string }[] }> = {
  price_above: { params: [{ key: 'value', label: '价格', def: 0 }] },
  price_below: { params: [{ key: 'value', label: '价格', def: 0 }] },
  price_cross_up: { params: [{ key: 'value', label: '价格', def: 0 }] },
  price_cross_down: { params: [{ key: 'value', label: '价格', def: 0 }] },
  price_change_pct: {
    params: [
      { key: 'bars', label: 'K线数量', def: 5 },
      { key: 'pct', label: '涨跌幅%', def: 3 },
    ],
  },
  price_new_high: { params: [] },
  price_new_low: { params: [] },
  donchian_break_up: { params: [{ key: 'bars', label: 'K线数量', def: 20 }] },
  donchian_break_down: { params: [{ key: 'bars', label: 'K线数量', def: 20 }] },
  rsi_above: {
    params: [
      { key: 'period', label: '周期', def: 14 },
      { key: 'value', label: '阈值', def: 70 },
    ],
  },
  rsi_below: {
    params: [
      { key: 'period', label: '周期', def: 14 },
      { key: 'value', label: '阈值', def: 30 },
    ],
  },
  macd_golden: { params: [] },
  macd_death: { params: [] },
  ma_cross_up: {
    params: [
      { key: 'fast', label: '快线', def: 5 },
      { key: 'slow', label: '慢线', def: 20 },
    ],
  },
  ma_cross_down: {
    params: [
      { key: 'fast', label: '快线', def: 5 },
      { key: 'slow', label: '慢线', def: 20 },
    ],
  },
  volume_spike: { params: [{ key: 'ratio', label: '倍数', def: 3 }] },
  boll_break_up: {
    params: [
      { key: 'period', label: '周期', def: 20 },
      { key: 'mult', label: '倍数', def: 2 },
    ],
  },
  boll_break_down: {
    params: [
      { key: 'period', label: '周期', def: 20 },
      { key: 'mult', label: '倍数', def: 2 },
    ],
  },
  llm_bias: {
    params: [
      { key: 'bias', label: '方向', def: 'long' },
      { key: 'minConfidence', label: '最低置信度', def: 60 },
    ],
  },
};
