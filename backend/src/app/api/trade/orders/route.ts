import { NextRequest, NextResponse } from 'next/server';
import { placeOrder, cancelOrder } from '@/server/services/ordersService';
import { ok, errorResponse, withEngine } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return withEngine(async () => {
    const denied = await guard(req, { pin: true });
    if (denied) return denied;
    try {
      const body = await req.json();
      // strict input validation — a NaN size would poison the paper ledger
      const size = Number(body.size);
      if (!Number.isFinite(size) || size <= 0) {
        return NextResponse.json({ ok: false, error: `invalid size: ${body.size}` }, { status: 400 });
      }
      if (body.orderType === 'limit' && !(Number(body.price) > 0)) {
        return NextResponse.json({ ok: false, error: 'limit orders require price > 0' }, { status: 400 });
      }
      // optional preset TP/SL (futures): positive percent, < 100
      const pct = (v: unknown): number | undefined => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 && n < 100 ? n : undefined;
      };
      // notifications + audit are raised centrally by the executor
      const result = await placeOrder({
        symbol: String(body.symbol ?? '').toUpperCase(),
        marketType: body.marketType === 'spot' ? 'spot' : 'futures',
        side: body.side === 'sell' ? 'sell' : 'buy',
        orderType: body.orderType === 'limit' ? 'limit' : 'market',
        size,
        price: body.price != null ? Number(body.price) : undefined,
        leverage: body.leverage != null ? Number(body.leverage) : undefined,
        tradeSide: body.tradeSide === 'close' ? 'close' : body.tradeSide === 'open' ? 'open' : undefined,
        stopLossPct: pct(body.stopLossPct),
        takeProfitPct: pct(body.takeProfitPct),
        paper: body.paper,
        accountId: body.accountId ? String(body.accountId) : undefined,
      });
      return ok(result);
    } catch (e) {
      return errorResponse(e);
    }
  });
}

export async function DELETE(req: NextRequest) {
  return withEngine(async () => {
    const denied = await guard(req, { pin: true });
    if (denied) return denied;
    try {
      const body = await req.json();
      const result = await cancelOrder(
        String(body.orderId), String(body.symbol).toUpperCase(),
        body.marketType === 'spot' ? 'spot' : 'futures',
        body.accountId ? String(body.accountId) : undefined,
      );
      return ok(result);
    } catch (e) {
      return errorResponse(e);
    }
  });
}
