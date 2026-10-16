import { NextRequest } from 'next/server';
import { BitgetRest, normalizeOrder } from '@/server/bitget/rest';
import { settingsRepo, paperRepo } from '@/server/store/repos';
import { ok, fail, errorResponse, withEngine } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import { isPaperMode } from '@/server/engine/candleService';
import type { MarketType } from '@/core/types';

export const dynamic = 'force-dynamic';

function resolveRest(accountId?: string) {
  const accounts = settingsRepo.get().accounts;
  const account = accountId ? accounts.find((a) => a.id === accountId) : accounts.find((a) => a.active);
  if (!account) throw new Error('no active exchange account');
  return new BitgetRest(account);
}

/**
 * POST /api/trade/cancel-all — batch cancel. symbol omitted = cancel EVERY
 * open order on the account (both markets). Paper mode clears paper orders.
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req, { pin: true });
  if (denied) return denied;
  return withEngine(async () => {
    try {
      const body = await req.json().catch(() => ({}) as Record<string, unknown>);
      const symbol = body.symbol ? String(body.symbol).toUpperCase() : undefined;
      const paper = body.paper ?? isPaperMode();

      if (paper) {
        const st = paperRepo.get();
        const before = st.orders.length;
        st.orders = symbol ? st.orders.filter((o) => o.symbol !== symbol) : [];
        paperRepo.save(st);
        return ok({ canceled: before - st.orders.length });
      }

      const rest = resolveRest(body.accountId ? String(body.accountId) : undefined);
      let canceled = 0;
      const targets: { marketType: MarketType; symbol: string }[] = [];
      if (symbol) {
        targets.push({ marketType: 'futures', symbol });
      } else {
        const [futs, spots] = await Promise.all([
          rest.pendingFuturesOrders().catch(() => []),
          rest.pendingSpotOrders().catch(() => []),
        ]);
        for (const r of futs) targets.push({ marketType: 'futures', symbol: String(r.symbol) });
        for (const r of spots) targets.push({ marketType: 'spot', symbol: String(r.symbol) });
      }
      for (const t of targets) {
        try {
          if (t.marketType === 'futures') {
            const open = await rest.pendingFuturesOrders(t.symbol).catch(() => []);
            for (const o of open) {
              await rest.cancelFuturesOrder(String(o.orderId), t.symbol).catch(() => undefined);
              canceled += 1;
            }
          } else {
            const open = await rest.pendingSpotOrders(t.symbol).catch(() => []);
            for (const o of open) {
              await rest.cancelSpotOrder(String(o.orderId), t.symbol).catch(() => undefined);
              canceled += 1;
            }
          }
        } catch {
          // continue with remaining symbols
        }
      }
      notify('order.canceled.all', { count: canceled, symbol: symbol ?? '*' }, { level: 'info', channel: 'trade' });
      logAudit({ category: 'manual', action: 'order.cancel_all', payload: { symbol, canceled }, result: 'ok' });
      return ok({ canceled });
    } catch (e) {
      return errorResponse(e);
    }
  });
}

/** GET /api/trade/cancel-all?count=1 — count open orders without canceling (confirm dialog). */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return withEngine(async () => {
    try {
      const sp = req.nextUrl.searchParams;
      const symbol = sp.get('symbol')?.toUpperCase() || undefined;
      if (isPaperMode()) {
        const st = paperRepo.get();
        return ok({ count: symbol ? st.orders.filter((o) => o.symbol === symbol).length : st.orders.length });
      }
      const rest = resolveRest(sp.get('accountId') ?? undefined);
      const [futs, spots] = await Promise.all([
        rest.pendingFuturesOrders(symbol).catch(() => [] as Record<string, unknown>[]),
        symbol ? Promise.resolve([] as Record<string, unknown>[]) : rest.pendingSpotOrders().catch(() => [] as Record<string, unknown>[]),
      ]);
      return ok({ count: futs.map((r) => normalizeOrder(r, 'futures').orderId).length + spots.length });
    } catch (e) {
      return errorResponse(e);
    }
  });
}
