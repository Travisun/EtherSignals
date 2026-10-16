import { NextRequest } from 'next/server';
import { strategiesRepo } from '@/server/store/repos';
import { ruleEngine } from '@/server/engine/ruleEngine';
import { candleService, isPaperMode } from '@/server/engine/candleService';
import { evaluateConditions } from '@/server/engine/evaluator';
import { ok, fail, errorResponse, withEngine } from '@/server/api/helpers';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import { uid } from '@/lib/utils';
import { describeCondition } from '@/core/conditionTexts';
import { settingsRepo } from '@/server/store/repos';
import { guard } from '@/server/security/guard';
import type { Strategy } from '@/core/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    return ok({ strategies: strategiesRepo.list(), runningIds: ruleEngine.runningIds });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  return withEngine(async () => {
    const denied = await guard(req, { pin: true });
    if (denied) return denied;
    try {
      const body = await req.json();
      if (body.action === 'test') {
        const s = strategiesRepo.get(String(body.id));
        if (!s) return fail('strategy not found', 404);
        // don't disturb the rule engine's refcounted window: snapshot only
        const candles = await candleService.snapshot(s.marketType, s.symbol, s.timeframe, 200);
        const price = candleService.lastPrice(s.marketType, s.symbol) || candles.at(-1)?.close || 0;
        const result = evaluateConditions(s.conditions, s.logic, { candles, price });
        return ok({ matched: result.matched, matchedDetails: result.matchedDetails, price });
      }

      const now = Date.now();
      const strategy: Strategy = {
        id: uid('st_'),
        name: String(body.name ?? 'Strategy'),
        symbol: String(body.symbol ?? 'BTCUSDT').toUpperCase(),
        marketType: body.marketType === 'spot' ? 'spot' : 'futures',
        timeframe: body.timeframe ?? '15m',
        status: 'stopped',
        paper: body.paper ?? true,
        accountIds: Array.isArray(body.accountIds) ? body.accountIds.map(String) : [],
        logic: body.logic === 'any' ? 'any' : 'all',
        conditions: Array.isArray(body.conditions) ? body.conditions : [],
        actions: Array.isArray(body.actions) && body.actions.length ? body.actions : [{ type: 'notify' }],
        cooldownSec: Number(body.cooldownSec ?? 300),
        repeat: body.repeat ?? true,
        note: body.note,
        stats: { triggerCount: 0, createdAt: now, updatedAt: now },
      };
      if (!strategy.conditions.length) return fail('at least one condition required');
      strategiesRepo.save(strategy);
      logAudit({ category: 'strategy', action: 'strategy.create', strategyId: strategy.id, symbol: strategy.symbol, payload: { name: strategy.name, conditions: strategy.conditions, actions: strategy.actions, accountIds: strategy.accountIds, paper: strategy.paper } });
      return ok({ strategy });
    } catch (e) {
      return errorResponse(e);
    }
  });
}

export async function PUT(req: NextRequest) {
  return withEngine(async () => {
    const denied = await guard(req, { pin: true });
    if (denied) return denied;
    try {
      const body = await req.json();
      const id = String(body.id ?? '');
      const existing = strategiesRepo.get(id);
      if (!existing) return fail('strategy not found', 404);

      if (body.action === 'toggle') {
        const nextStatus = existing.status === 'running' ? 'stopped' : 'running';
        strategiesRepo.update(id, { status: nextStatus });
        if (nextStatus === 'running') {
          await ruleEngine.startStrategy({ ...existing, status: 'running' });
        } else {
          ruleEngine.stopStrategy(id);
        }
        notify(nextStatus === 'running' ? 'strategy.started' : 'strategy.stopped', { name: existing.name }, { level: 'info', strategyId: id });
        logAudit({ category: 'strategy', action: nextStatus === 'running' ? 'strategy.start' : 'strategy.stop', strategyId: id, symbol: existing.symbol, payload: { name: existing.name } });
        return ok({ strategy: strategiesRepo.get(id) });
      }

      const patch: Partial<Strategy> = {};
      if (body.name != null) patch.name = String(body.name);
      if (body.symbol != null) patch.symbol = String(body.symbol).toUpperCase();
      if (body.marketType != null) patch.marketType = body.marketType === 'spot' ? 'spot' : 'futures';
      if (body.timeframe != null) patch.timeframe = body.timeframe;
      if (body.paper != null) patch.paper = Boolean(body.paper);
      if (body.logic != null) patch.logic = body.logic === 'any' ? 'any' : 'all';
      if (Array.isArray(body.conditions)) patch.conditions = body.conditions;
      if (Array.isArray(body.actions) && body.actions.length) patch.actions = body.actions;
      if (body.cooldownSec != null) patch.cooldownSec = Number(body.cooldownSec);
      if (body.repeat != null) patch.repeat = Boolean(body.repeat);
      if (body.note !== undefined) patch.note = body.note;
      if (Array.isArray(body.accountIds)) patch.accountIds = body.accountIds.map(String);

      const updated = strategiesRepo.update(id, patch);
      if (existing.status === 'running') {
        // only re-acquires when the symbol/market/timeframe actually changed
        await ruleEngine.refreshStrategy(updated!);
      }
      logAudit({ category: 'strategy', action: 'strategy.update', strategyId: id, symbol: updated?.symbol, payload: patch });
      const locale = settingsRepo.get().general.locale;
      return ok({
        strategy: updated,
        describe: updated?.conditions.map((c) => describeCondition(c, locale)).join(' / '),
      });
    } catch (e) {
      return errorResponse(e);
    }
  });
}

export async function DELETE(req: NextRequest) {
  const denied = await guard(req, { pin: true });
  if (denied) return denied;
  try {
    const id = req.nextUrl.searchParams.get('id') ?? '';
    const existing = strategiesRepo.get(id);
    ruleEngine.stopStrategy(id);
    strategiesRepo.remove(id);
    logAudit({ category: 'strategy', action: 'strategy.delete', strategyId: id, symbol: existing?.symbol, payload: { name: existing?.name } });
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return ok({ paperMode: isPaperMode() });
}
