import { NextRequest } from 'next/server';
import { backtestRepo } from '@/server/store/repos';
import { getRuntime } from '@/server/engine/runtime';
import { ok, fail, errorResponse, withEngine } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';
import { logAudit } from '@/server/store/pg';
import { uid } from '@/lib/utils';
import type { BacktestConfig, BacktestRun } from '@/core/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (id) {
      const run = backtestRepo.get(id);
      if (!run) return fail('run not found', 404);
      return ok({ run });
    }
    // list view: strip the bulky equity/trade series — fetch via ?id=
    return ok({ runs: backtestRepo.list().map((r) => ({ ...r, result: undefined })) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return withEngine(async () => {
    try {
      const body = await req.json();
      const config: BacktestConfig = {
        symbol: String(body.symbol ?? 'BTCUSDT').toUpperCase(),
        marketType: body.marketType === 'spot' ? 'spot' : 'futures',
        timeframe: body.timeframe ?? '15m',
        start: body.start != null ? Number(body.start) : undefined,
        end: body.end != null ? Number(body.end) : undefined,
        maxCandles: Math.min(Number(body.maxCandles ?? 5000), 20000),
        initialCapital: Number(body.initialCapital ?? 10_000),
        feeBps: Number(body.feeBps ?? 6),
        slippageBps: Number(body.slippageBps ?? 2),
        direction: body.direction ?? 'both',
        logic: body.logic === 'any' ? 'any' : 'all',
        conditions: Array.isArray(body.conditions) ? body.conditions : [],
        stopLossPct: body.stopLossPct != null ? Number(body.stopLossPct) : undefined,
        takeProfitPct: body.takeProfitPct != null ? Number(body.takeProfitPct) : undefined,
        allowLeverage: Number(body.allowLeverage ?? 1),
      };
      if (!config.conditions.length) return fail('at least one condition required');
      const run: BacktestRun = {
        id: uid('bt_'),
        config,
        status: 'pending',
        progress: 0,
        createdAt: Date.now(),
      };
      getRuntime().queueBacktest(run);
      return ok({ run });
    } catch (e) {
      return errorResponse(e);
    }
  });
}

export async function DELETE(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const id = req.nextUrl.searchParams.get('id') ?? '';
    backtestRepo.remove(id);
    logAudit({ category: 'backtest', action: 'backtest.deleted', payload: { id } });
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
