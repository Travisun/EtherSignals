import { NextRequest } from 'next/server';
import { getRuntime } from '@/server/engine/runtime';
import { eventsRepo, settingsRepo } from '@/server/store/repos';
import { ok, fail, errorResponse, withEngine } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';
import { logAudit } from '@/server/store/pg';
import { riskState, resume, trip } from '@/server/engine/risk';
import { buildMarketContext, contextToPrompt } from '@/server/llm/advice';
import type { MarketType, Timeframe } from '@/core/types';

export const dynamic = 'force-dynamic';

/** internal-only: graceful shutdown handshake from server.mjs (same process) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const secret = (globalThis as { __gtBootSecret?: string }).__gtBootSecret;
    if (body.action === 'shutdown') {
      if (!secret || req.headers.get('x-gt-internal') !== secret) {
        return fail('forbidden', 403);
      }
      await getRuntime().stop();
      return ok({ ok: true });
    }
    if (body.action === 'risk.pause') {
      const denied = await guard(req, { pin: true });
      if (denied) return denied;
      await trip('manual', String(body.reason ?? 'manual kill switch'));
      return ok({ risk: riskState() });
    }
    if (body.action === 'risk.resume') {
      const denied = await guard(req, { pin: true });
      if (denied) return denied;
      resume();
      return ok({ risk: riskState() });
    }
    return fail(`unknown action: ${String(body.action ?? '')}`, 400);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: NextRequest) {
  {
    const denied = await guard(req);
    if (denied) return denied;
  }
  return withEngine(async () => {
    try {
      const sp = req.nextUrl.searchParams;
      if (sp.get('view') === 'context') {
        const ctx = await buildMarketContext(
          (sp.get('symbol') ?? 'BTCUSDT').toUpperCase(),
          (sp.get('marketType') as MarketType) ?? 'futures',
          (sp.get('tf') as Timeframe) ?? '15m',
        );
        return ok({
          context: {
            symbol: ctx.symbol,
            marketType: ctx.marketType,
            timeframe: ctx.timeframe,
            price: ctx.price,
            positions: ctx.positions,
          },
          prompt: contextToPrompt(ctx),
        });
      }
      const status = getRuntime().status();
      return ok({ status, risk: riskState() });
    } catch (e) {
      return errorResponse(e);
    }
  });
}

export async function DELETE(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    if (req.nextUrl.searchParams.get('events') === '1') {
      eventsRepo.clear();
      logAudit({ category: 'system', action: 'events.cleared', level: 'warning' });
      return ok({ ok: true });
    }
    return errorResponse(new Error('nothing to delete'));
  } catch (e) {
    return errorResponse(e);
  }
}
