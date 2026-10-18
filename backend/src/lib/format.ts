import type { Timeframe } from '@/core/types';

export type Locale = 'zh-CN' | 'en';

/** Locale-aware number formatting with adaptive precision for prices. */
export function fmtPrice(v: number | undefined | null, locale: Locale = 'en'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  let min = 2;
  let max = 2;
  if (abs < 0.0001) { min = 8; max = 8; }
  else if (abs < 0.01) { min = 6; max = 6; }
  else if (abs < 1) { min = 4; max = 5; }
  else if (abs < 100) { min = 2; max = 3; }
  else if (abs < 10000) { min = 1; max = 2; }
  else { min = 2; max = 2; }
  return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(v);
}

export function fmtAmount(v: number | undefined | null, locale: Locale = 'en'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const max = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits: max,
  }).format(v);
}

export function fmtCompact(v: number | undefined | null, locale: Locale = 'en'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(v);
}

export function fmtPct(v: number | undefined | null, locale: Locale = 'en', digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v * 100);
}

export function fmtSignedPct(v: number | undefined | null, locale: Locale = 'en', digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = fmtPct(v, locale, digits);
  return v > 0 ? `+${s}%` : `${s}%`;
}

export function fmtUsd(v: number | undefined | null, locale: Locale = 'en'): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${fmtAmount(v, locale)}`;
}

export function fmtTime(ts: number | undefined | null, locale: Locale = 'en', withDate = true): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = withDate
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  return d.toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', opts);
}

export function fmtDate(ts: number | undefined | null, locale: Locale = 'en'): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

/** Format a number for order-form inputs: fixed notation, trimmed zeros. */
export function fmtQty(v: number | undefined | null, maxDecimals = 8): string {
  if (v == null || !Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  const decimals = abs >= 1 ? Math.min(maxDecimals, 6) : maxDecimals;
  return v.toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function tfSeconds(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    '1m': 60, '2m': 120, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200,
    '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400, '2d': 172800,
    '3d': 259200, '1w': 604800, '1M': 2592000,
  };
  return map[tf];
}

/**
 * Bitget REST candle granularity (synthetic TFs resolve to their base).
 * The v2 API uses two incompatible vocabularies: spot endpoints keep the
 * legacy style (1min/1day/1week) while mix (futures) endpoints use the
 * compact style (1m/1D/1W) — verified against the live API 2026-10.
 */
export function tfToGranularity(tf: Timeframe, marketType: 'spot' | 'futures'): string {
  if (marketType === 'futures') {
    const map: Record<Timeframe, string> = {
      '1m': '1m', '2m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
      '1h': '1H', '2h': '1H', '4h': '4H', '6h': '6H', '8h': '1H', '12h': '12H', '1d': '1D',
      '2d': '1D', '3d': '3D', '1w': '1W', '1M': '1M',
    };
    return map[tf];
  }
  const map: Record<Timeframe, string> = {
    '1m': '1min', '2m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
    '1h': '1h', '2h': '1h', '4h': '4h', '6h': '6h', '8h': '1h', '12h': '12h', '1d': '1day',
    '2d': '1day', '3d': '3day', '1w': '1week', '1M': '1M',
  };
  return map[tf];
}

/** Bitget WS candle channel (synthetic TFs subscribe to their base channel). */
export function tfToWsChannel(tf: Timeframe): string {
  const map: Record<Timeframe, string> = {
    '1m': 'candle1m', '2m': 'candle1m', '5m': 'candle5m', '15m': 'candle15m', '30m': 'candle30m',
    '1h': 'candle1H', '2h': 'candle1H', '4h': 'candle4H', '6h': 'candle6H', '8h': 'candle1H',
    '12h': 'candle12H', '1d': 'candle1D', '2d': 'candle1D', '3d': 'candle3D', '1w': 'candle1W', '1M': 'candle1M',
  };
  return map[tf];
}

export function wsInstType(marketType: 'spot' | 'futures'): string {
  return marketType === 'spot' ? 'SP' : 'USDT-FUTURES';
}

export function restProductType(marketType: 'spot' | 'futures'): string {
  return marketType === 'spot' ? '' : 'usdt-futures';
}

export function parseSymbolPair(symbol: string): { base: string; quote: string } {
  for (const q of ['USDT', 'USDC', 'BTC', 'ETH', 'USD']) {
    if (symbol.endsWith(q)) return { base: symbol.slice(0, -q.length), quote: q };
  }
  return { base: symbol, quote: '' };
}
