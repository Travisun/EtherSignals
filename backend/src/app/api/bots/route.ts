import { NextRequest } from 'next/server';
import { botsRepo } from '@/server/store/repos';
import { gridEngine } from '@/server/engine/grid';
import { ok, fail, errorResponse, withEngine } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';
import { uid } from '@/lib/utils';
import type { GridBot } from '@/core/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    return ok({ bots: botsRepo.list(), runningIds: botsRepo.list().filter((b) => b.status === 'running').map((b) => b.id) });
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
      if (body.action === 'toggle') {
        const bot = botsRepo.get(String(body.id));
        if (!bot) return fail('bot not found', 404);
        const next = bot.status === 'running' ? 'stopped' : 'running';
        botsRepo.update(bot.id, { status: next });
        if (next === 'running') await gridEngine.startBot({ ...bot, status: 'running' });
        else gridEngine.stopBot(bot.id);
        return ok({ bot: botsRepo.get(bot.id) });
      }
      if (body.action === 'reset-stats') {
        const bot = botsRepo.get(String(body.id));
        if (!bot) return fail('bot not found', 404);
        botsRepo.update(bot.id, {
          fills: [], buyStack: [], lastPrice: undefined,
          levels: bot.levels.map((l) => ({ ...l, hasInventory: false })),
          stats: { ...bot.stats, buyFills: 0, sellFills: 0, realizedPnl: 0, fees: 0 },
        });
        return ok({ bot: botsRepo.get(bot.id) });
      }

      const now = Date.now();
      const bot: GridBot = {
        id: uid('gb_'),
        name: String(body.name ?? 'Grid'),
        symbol: String(body.symbol ?? 'BTCUSDT').toUpperCase(),
        marketType: body.marketType === 'spot' ? 'spot' : 'futures',
        status: 'stopped',
        paper: body.paper ?? true,
        accountIds: Array.isArray(body.accountIds) ? body.accountIds.map(String) : [],
        leverage: Number(body.leverage ?? 1),
        lowerPrice: Number(body.lowerPrice),
        upperPrice: Number(body.upperPrice),
        grids: Math.max(2, Math.min(Number(body.grids ?? 10), 200)),
        quantityPerGrid: Number(body.quantityPerGrid),
        initialBuy: Boolean(body.initialBuy),
        entryLogic: body.entryLogic === 'any' ? 'any' : 'all',
        entryConditions: Array.isArray(body.entryConditions) ? body.entryConditions : [],
        stopLogic: body.stopLogic === 'all' ? 'all' : 'any',
        stopConditions: Array.isArray(body.stopConditions) ? body.stopConditions : [],
        levels: [],
        buyStack: [],
        fills: [],
        stats: { buyFills: 0, sellFills: 0, realizedPnl: 0, fees: 0, createdAt: now, updatedAt: now },
      };
      if (!(bot.lowerPrice > 0 && bot.upperPrice > bot.lowerPrice)) return fail('invalid price range');
      if (!(bot.quantityPerGrid > 0)) return fail('invalid quantity per grid');
      botsRepo.save(bot);
      return ok({ bot });
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
      const existing = botsRepo.get(id);
      if (!existing) return fail('bot not found', 404);
      const patch: Partial<GridBot> = {};
      if (body.name != null) patch.name = String(body.name);
      if (body.paper != null) patch.paper = Boolean(body.paper);
      if (Array.isArray(body.accountIds)) patch.accountIds = body.accountIds.map(String);
      if (body.leverage != null) patch.leverage = Number(body.leverage);
      if (body.quantityPerGrid != null) patch.quantityPerGrid = Number(body.quantityPerGrid);
      if (body.initialBuy != null) patch.initialBuy = Boolean(body.initialBuy);
      if (body.lowerPrice != null) patch.lowerPrice = Number(body.lowerPrice);
      if (body.upperPrice != null) patch.upperPrice = Number(body.upperPrice);
      if (body.grids != null) patch.grids = Math.max(2, Math.min(Number(body.grids), 200));
      if (Array.isArray(body.entryConditions)) patch.entryConditions = body.entryConditions;
      if (body.entryLogic != null) patch.entryLogic = body.entryLogic === 'any' ? 'any' : 'all';
      if (Array.isArray(body.stopConditions)) patch.stopConditions = body.stopConditions;
      if (body.stopLogic != null) patch.stopLogic = body.stopLogic === 'all' ? 'all' : 'any';
      const updated = botsRepo.update(id, patch);
      if (existing.status === 'running') {
        // stop first so the candle-window refcount doesn't leak on re-acquire
        gridEngine.stopBot(id, 'manual');
        await gridEngine.startBot({ ...updated!, status: 'running' });
      }
      return ok({ bot: updated });
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
    gridEngine.stopBot(id);
    botsRepo.remove(id);
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
