import { BitgetRest, normalizePosition } from '@/server/bitget/rest';
import { settingsRepo, paperRepo } from '@/server/store/repos';
import { paperBroker } from './paper';
import { candleService, isPaperMode } from './candleService';
import { cacheHoldMode } from './executor';
import type { AccountSummary, AssetBalance, PositionRecord } from '@/core/types';

function resolveAccount(accountId?: string) {
  const accounts = settingsRepo.get().accounts;
  return accountId ? accounts.find((a) => a.id === accountId) : accounts.find((a) => a.active);
}

/**
 * Unified account view — routes to the paper broker in paper mode,
 * otherwise aggregates spot + futures balances over the signed REST API.
 */
export async function getAccountSummary(accountId?: string): Promise<AccountSummary> {
  if (isPaperMode()) {
    const st = paperRepo.get();
    const marks: Record<string, number> = {};
    for (const p of st.positions) {
      marks[p.symbol] =
        candleService.lastPrice(p.marketType ?? 'futures', p.symbol) || p.openPriceAvg;
    }
    return paperBroker.summary(marks);
  }

  const account = resolveAccount(accountId);
  if (!account) {
    return { paper: false, spot: [], futures: [], totals: { equityUsd: 0, availableUsd: 0, unrealizedPnl: 0 }, ts: Date.now() };
  }
  const rest = new BitgetRest(account);
  try {
    const [spotRows, futuresRows] = await Promise.all([
      rest.spotAssets().catch(() => [] as Record<string, unknown>[]),
      rest.futuresAccounts().catch(() => [] as Record<string, unknown>[]),
    ]);
    const btc = candleService.ticker('spot', 'BTCUSDT')?.last ?? 0;
    const toN = (v: unknown) => {
      const x = parseFloat(String(v));
      return Number.isFinite(x) ? x : 0;
    };
    const spot: AssetBalance[] = spotRows
      .map((r) => ({
        coin: String(r.coin ?? ''),
        available: toN(r.available),
        frozen: toN(r.frozen),
        total: toN(r.available) + toN(r.frozen),
      }))
      .filter((a) => a.total > 0);
    const futures = futuresRows.map((r) => ({
      marginCoin: String(r.marginCoin ?? 'USDT'),
      equity: toN(r.accountEquity),
      available: toN(r.available),
      unrealizedPL: toN(r.unrealizedPL),
      marginUsed: toN(r.locked) + toN(r.marginUsed ?? 0),
    }));
    const usdtRate = (coin: string) =>
      coin === 'USDT' ? 1 : coin === 'BTC' && btc ? btc : 0;
    const equityUsd =
      spot.reduce((s, a) => s + a.total * (usdtRate(a.coin) || 0), 0) +
      futures.reduce((s, f) => s + (f.marginCoin === 'USDT' ? f.equity : 0), 0);
    const availableUsd =
      spot.reduce((s, a) => s + a.available * (usdtRate(a.coin) || 0), 0) +
      futures.reduce((s, f) => s + (f.marginCoin === 'USDT' ? f.available : 0), 0);
    const unrealizedPnl = futures.reduce((s, f) => s + f.unrealizedPL, 0);
    return {
      paper: false,
      spot,
      futures,
      totals: { equityUsd, availableUsd, unrealizedPnl },
      ts: Date.now(),
    };
  } catch {
    return { paper: false, spot: [], futures: [], totals: { equityUsd: 0, availableUsd: 0, unrealizedPnl: 0 }, ts: Date.now() };
  }
}

export async function getPositions(accountId?: string): Promise<PositionRecord[]> {
  if (isPaperMode()) {
    return paperBroker.state().positions.map((p) => ({ ...p, paper: true }));
  }
  const account = resolveAccount(accountId);
  if (!account) return [];
  const rest = new BitgetRest(account);
  try {
    const rows = await rest.positions();
    const positions = rows.map(normalizePosition);
    // remember the account's hold-side mode so order placement omits
    // tradeSide for one-way accounts
    if (positions[0]) cacheHoldMode(account.id, positions[0].holdMode);
    return positions;
  } catch {
    return [];
  }
}

export async function testAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  const account = settingsRepo.get().accounts.find((a) => a.id === accountId);
  if (!account) return { ok: false, error: 'account not found' };
  const rest = new BitgetRest(account);
  try {
    await rest.futuresAccounts();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}
