import { NextRequest } from 'next/server';
import { BitgetRest } from '@/server/bitget/rest';
import { settingsRepo, paperRepo } from '@/server/store/repos';
import { ok, fail, errorResponse, withEngine } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import { isPaperMode } from '@/server/engine/candleService';
import { floorTo, toNum } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function resolveRest(accountId?: string) {
  const accounts = settingsRepo.get().accounts;
  const account = accountId ? accounts.find((a) => a.id === accountId) : accounts.find((a) => a.active);
  if (!account) throw new Error('no active exchange account');
  return new BitgetRest(account);
}

/**
 * POST /api/trade/tpsl — modify a position's stop-loss / take-profit.
 * paper: rewrites the position's slPct/tpPct in the paper ledger.
 * live: cancels existing TP/SL plans on the symbol and places new trigger
 * orders (mark-price, market execution) for the given absolute prices.
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req, { pin: true });
  if (denied) return denied;
  return withEngine(async () => {
    try {
      const body = await req.json();
      const symbol = String(body.symbol ?? '').toUpperCase();
      if (!/^[A-Z0-9]{4,20}$/.test(symbol)) return fail('invalid symbol', 400);
      const side = body.side === 'short' ? 'short' : 'long';
      const slPrice = body.slPrice != null ? Number(body.slPrice) : undefined;
      const tpPrice = body.tpPrice != null ? Number(body.tpPrice) : undefined;
      if (slPrice != null && !(slPrice > 0)) return fail('invalid stop-loss price', 400);
      if (tpPrice != null && !(tpPrice > 0)) return fail('invalid take-profit price', 400);
      const paper = body.paper ?? isPaperMode();

      if (paper) {
        // store as percent relative to the entry price (paper model)
        const st = paperRepo.get();
        const p = st.positions.find((x) => x.symbol === symbol && x.side === side);
        if (!p) return fail('position not found', 404);
        const pctOf = (price: number) =>
          Math.abs((price - p.openPriceAvg) / p.openPriceAvg) * 100;
        p.slPct = slPrice != null ? pctOf(slPrice) : undefined;
        p.tpPct = tpPrice != null ? pctOf(tpPrice) : undefined;
        p.uTime = Date.now();
        paperRepo.save(st);
        logAudit({ category: 'manual', action: 'tpsl.paper', symbol, payload: { side, slPct: p.slPct, tpPct: p.tpPct }, result: 'ok' });
        return ok({ ok: true, slPct: p.slPct, tpPct: p.tpPct });
      }

      const rest = resolveRest(body.accountId ? String(body.accountId) : undefined);
      // 1. wipe the position's existing plans
      const plans = await rest.pendingPlanOrders(symbol).catch(() => []);
      let holdSide: 'buy' | 'sell' | undefined;
      // hedge mode: holdSide is the OPEN side of the position (long → buy)
      const plansForSide = plans.filter((r) => {
        const hs = r.holdSide != null ? String(r.holdSide) : undefined;
        if (hs) {
          const isLongPlan = hs === 'buy';
          return isLongPlan === (side === 'long');
        }
        return true;
      });
      for (const plan of plansForSide) {
        const orderId = String(plan.orderId ?? '');
        if (orderId) await rest.cancelPlanOrder(orderId, symbol).catch(() => undefined);
        if (plan.holdSide != null) holdSide = String(plan.holdSide) as 'buy' | 'sell';
      }
      // 2. fetch live position for size + holdSide
      const positions = await rest.positions(symbol).catch(() => []);
      const row = positions.find((r) => (String(r.holdSide ?? 'long') === 'long') === (side === 'long'));
      if (!row) return fail('position not found', 404);
      const size = toNum(row.available) || toNum(row.total);
      if (!size) return fail('position has no available size', 400);
      holdSide = String(row.holdSide ?? 'long') === 'long' ? 'buy' : 'sell';
      const instrument = await import('@/server/engine/candleService').then(({ candleService }) =>
        candleService.instrument('futures', symbol).catch(() => undefined),
      );
      const pPrec = instrument?.pricePrecision ?? 2;
      const fmt = (v: number) => String(floorTo(v, pPrec));

      // 3. place the new plans
      if (slPrice != null) {
        await rest.placeTpSlPlan({ symbol, kind: 'loss', triggerPrice: fmt(slPrice), holdSide, size: String(size) });
      }
      if (tpPrice != null) {
        await rest.placeTpSlPlan({ symbol, kind: 'profit', triggerPrice: fmt(tpPrice), holdSide, size: String(size) });
      }
      notify('tpsl.updated', {
        symbol,
        sl: slPrice != null ? fmt(slPrice) : '—',
        tp: tpPrice != null ? fmt(tpPrice) : '—',
      }, { level: 'success', channel: 'trade' });
      logAudit({ category: 'manual', action: 'tpsl.set', symbol, payload: { side, slPrice, tpPrice, size, holdSide }, result: 'ok' });
      return ok({ ok: true });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      notify('tpsl.fail', { reason: msg }, { level: 'error', channel: 'trade' });
      return errorResponse(e);
    }
  });
}
