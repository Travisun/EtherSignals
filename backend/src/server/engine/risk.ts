import { settingsRepo, equityRepo } from '@/server/store/repos';
import { candleService } from './candleService';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import type { ActionOrder, MarketType } from '@/core/types';

/**
 * Pre-trade risk layer — every order path (manual / strategy / grid / agent)
 * funnels through `preTradeCheck` before touching the exchange. Institutional
 * minimum: kill switch, per-order notional cap, aggregate exposure cap,
 * abnormal-move guard and an equity-based daily-loss circuit breaker.
 */

export interface RiskDecision {
  ok: boolean;
  reason?: string;
  code?: string;
}

/** equity (USD) snapshot at the start of the current UTC day, for the daily-loss breaker */
let dayKey = '';
let dayStartEquity = 0;
let lastEquity = 0;

function utcDayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function refreshDayAnchor(equityUsd: number) {
  const key = utcDayKey();
  if (key !== dayKey) {
    dayKey = key;
    dayStartEquity = equityUsd > 0 ? equityUsd : dayStartEquity;
  }
  if (equityUsd > 0) lastEquity = equityUsd;
}

/** Called by the runtime account timer (~15s): feeds the daily-loss breaker. */
export function feedEquity(equityUsd: number) {
  refreshDayAnchor(equityUsd);
  const { risk } = settingsRepo.get();
  if (!risk.halted && risk.maxDailyLossUsd && risk.maxDailyLossUsd > 0 && dayStartEquity > 0) {
    const dayPnl = equityUsd - dayStartEquity;
    if (dayPnl < -risk.maxDailyLossUsd) {
      void trip(
        'daily_loss',
        `daily loss $${Math.abs(dayPnl).toFixed(2)} exceeded limit $${risk.maxDailyLossUsd}`,
      );
    }
  }
}

/** Trip the kill switch (persisted so a restart cannot silently clear it). */
export async function trip(kind: 'kill_switch' | 'daily_loss' | 'exposure' | 'manual', reason: string) {
  const { risk } = settingsRepo.get();
  if (risk.halted) return; // already tripped
  settingsRepo.update({
    risk: { ...risk, killSwitch: true, halted: { reason, ts: Date.now(), kind } },
  });
  notify('risk.halted', { reason }, { level: 'error', channel: 'system' });
  logAudit({ category: 'system', action: 'risk.halted', level: 'error', payload: { kind, reason } });
}

/** Clear the kill switch (explicit operator action). */
export function resume() {
  const { risk } = settingsRepo.get();
  settingsRepo.update({ risk: { ...risk, killSwitch: false, halted: undefined } });
  notify('risk.resumed', undefined, { level: 'success', channel: 'system' });
  logAudit({ category: 'system', action: 'risk.resumed', level: 'warning' });
}

/** Aggregate open notional across paper + live positions (cached 10s). */
let exposureCache: { ts: number; usd: number } | null = null;

export async function totalExposureUsd(): Promise<number> {
  if (exposureCache && Date.now() - exposureCache.ts < 10_000) return exposureCache.usd;
  let usd = 0;
  try {
    const { getPositions } = await import('./accountService');
    const positions = await getPositions().catch(() => []);
    for (const p of positions) {
      const mark = p.markPrice || p.openPriceAvg;
      if (mark > 0) usd += p.size * mark;
    }
  } catch {
    // exposure unknown — fail-closed is too disruptive for a cache miss;
    // return the last known value instead
    return exposureCache?.usd ?? 0;
  }
  exposureCache = { ts: Date.now(), usd };
  return usd;
}

/**
 * The single pre-trade gate. `isClosing` orders (reduce-only semantics) bypass
 * the entry-oriented guards (exposure cap, abnormal move) but never the kill
 * switch — getting OUT must always stay possible.
 */
export async function preTradeCheck(params: {
  symbol: string;
  marketType: MarketType;
  order: Pick<ActionOrder, 'side' | 'orderType' | 'tradeSide' | 'size' | 'leverage'>;
  refPrice: number;
  size: number;
}): Promise<RiskDecision> {
  const { risk } = settingsRepo.get();
  const closing = params.order.tradeSide === 'close';

  if (risk.killSwitch || risk.halted) {
    return { ok: false, code: 'HALTED', reason: `risk engine halted: ${risk.halted?.reason ?? 'kill switch'}` };
  }

  // per-order notional cap (all paths, paper included)
  const notional = params.size * params.refPrice;
  if (risk.maxOrderUsd > 0 && notional > risk.maxOrderUsd) {
    return {
      ok: false,
      code: 'MAX_ORDER',
      reason: `order notional $${notional.toFixed(2)} exceeds maxOrderUsd $${risk.maxOrderUsd}`,
    };
  }

  if (closing) return { ok: true };

  // abnormal 24h move guard: refuse fresh entries into vertical moves
  if (risk.maxDailyMovePct && risk.maxDailyMovePct > 0) {
    const t = candleService.ticker(params.marketType, params.symbol);
    if (t && Math.abs(t.change24h) * 100 > risk.maxDailyMovePct) {
      return {
        ok: false,
        code: 'VOLATILITY',
        reason: `${params.symbol} moved ${(t.change24h * 100).toFixed(1)}% in 24h (> ${risk.maxDailyMovePct}%) — entry refused`,
      };
    }
  }

  // aggregate open-notional cap
  if (risk.maxTotalExposureUsd && risk.maxTotalExposureUsd > 0) {
    const exposure = await totalExposureUsd();
    if (exposure + notional > risk.maxTotalExposureUsd) {
      return {
        ok: false,
        code: 'MAX_EXPOSURE',
        reason: `total exposure $${(exposure + notional).toFixed(2)} would exceed cap $${risk.maxTotalExposureUsd}`,
      };
    }
  }

  return { ok: true };
}

/** current halt state for the UI */
export function riskState() {
  const { risk } = settingsRepo.get();
  return {
    killSwitch: risk.killSwitch,
    halted: risk.halted ?? null,
    dayStartEquity,
    lastEquity,
    dayPnl: dayStartEquity > 0 ? lastEquity - dayStartEquity : 0,
  };
}
