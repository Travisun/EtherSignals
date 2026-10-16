import { botsRepo, settingsRepo } from '@/server/store/repos';
import { candleService, isPaperMode, windowKey } from './candleService';
import { executeOrderAction, precisionFields } from './executor';
import { evaluateConditions, requiredWindows } from './evaluator';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import { bus } from '@/server/events/bus';
import type { Candle, GridBot, GridFill, MarketType, Timeframe } from '@/core/types';

const TAKER_FEE = 0.0006;

interface RunningBot {
  bot: GridBot;
  keys: string[];
  gateKeys: string[];
}

function botKeys(bot: GridBot): { keys: string[]; gateKeys: string[] } {
  // the bot trades off its 1m base series; gates may reference any window
  const base = { symbol: bot.symbol, marketType: bot.marketType, timeframe: '1m' as Timeframe };
  const gateKeys = [...new Set(
    [...requiredWindows(bot.entryConditions, base), ...requiredWindows(bot.stopConditions, base)]
      .map((w) => windowKey(w.marketType, w.symbol, w.tf)),
  )];
  return { keys: [windowKey(bot.marketType, bot.symbol, '1m'), ...gateKeys], gateKeys };
}

function buildLevels(bot: GridBot): { price: number; hasInventory: boolean }[] {
  const step = (bot.upperPrice - bot.lowerPrice) / bot.grids;
  return Array.from({ length: bot.grids + 1 }, (_, i) => ({
    price: Number((bot.lowerPrice + i * step).toFixed(8)),
    hasInventory: false,
  }));
}

/**
 * Grid trading engine — touch-execution model: when price crosses a grid
 * level downward it buys one unit (accumulates); crossing a level upward
 * releases the nearest lower inventory unit (realizes step profit).
 * Supports optional cross-chart entry/stop gates, paper & live (market
 * orders on touch), multi-account fan-out, full fill ledger.
 */
export class GridEngine {
  private running = new Map<string, RunningBot>();
  private ticking = new Set<string>();

  get runningCount() {
    return this.running.size;
  }

  get runningIds() {
    return [...this.running.keys()];
  }

  isRunning(id: string) {
    return this.running.has(id);
  }

  async startBot(bot: GridBot) {
    const { keys } = botKeys(bot);
    for (const key of keys) {
      const [marketType, symbol, tf] = key.split(':') as [MarketType, string, Timeframe];
      await candleService.acquire(marketType, symbol, tf, 200).catch((e) => {
        notify('engine.error', { reason: `grid ${bot.name}: ${(e as Error).message}` }, { level: 'error' });
      });
    }
    // (re)build level state when the grid definition changed
    const stale = !bot.levels?.length
      || bot.levels.length !== bot.grids + 1
      || Math.abs(bot.levels[0].price - bot.lowerPrice) > 1e-9
      || Math.abs(bot.levels.at(-1)!.price - bot.upperPrice) > 1e-9;
    if (stale) bot.levels = buildLevels(bot);
    bot.lastPrice = undefined;
    if (!bot.stopLogic) bot.stopLogic = 'any'; // migrate legacy bots
    this.running.set(bot.id, { bot, keys, gateKeys: keys.slice(1) });

    if (bot.initialBuy) {
      const price = candleService.lastPrice(bot.marketType, bot.symbol);
      if (price > 0) {
        for (const level of bot.levels) {
          if (level.price < price && !level.hasInventory) {
            const fills = await this.execFill(bot, 'buy', level.price, bot.quantityPerGrid);
            if (fills.length) {
              level.hasInventory = true;
              bot.buyStack.push({ price: level.price, qty: bot.quantityPerGrid, ts: Date.now() });
            }
          }
        }
      }
    }
    botsRepo.update(bot.id, { status: 'running', levels: bot.levels, buyStack: bot.buyStack, stats: { ...bot.stats, startedAt: Date.now() } });
    notify('grid.started', { name: bot.name, symbol: bot.symbol }, { level: 'success', channel: 'grid' });
    logAudit({ category: 'grid', action: 'grid.started', strategyId: bot.id, symbol: bot.symbol, payload: { name: bot.name, lower: bot.lowerPrice, upper: bot.upperPrice, grids: bot.grids, paper: bot.paper || isPaperMode(), accounts: bot.accountIds } });
  }

  stopBot(id: string, reason: 'manual' | 'gate' = 'manual') {
    const entry = this.running.get(id);
    if (!entry) return;
    this.running.delete(id);
    // per-window refcount keeps shared windows alive for other bots/strategies
    for (const key of entry.keys) {
      const [marketType, symbol, tf] = key.split(':') as [MarketType, string, Timeframe];
      const stillUsed = [...this.running.values()].some((o) => o.keys.includes(key));
      if (!stillUsed) candleService.release(marketType, symbol, tf);
    }
    botsRepo.update(id, { status: 'stopped' });
    notify('grid.stopped', { name: entry.bot.name }, { level: 'info', channel: 'grid' });
    logAudit({ category: 'grid', action: 'grid.stopped', strategyId: id, symbol: entry.bot.symbol, payload: { reason, stats: entry.bot.stats } });
  }

  async restart() {
    const all = botsRepo.list();
    const toRun = all.filter((b) => b.status === 'running');
    for (const id of [...this.running.keys()]) {
      if (!toRun.some((b) => b.id === id)) this.stopBot(id);
    }
    for (const b of toRun) {
      if (!this.running.has(b.id)) await this.startBot(b);
      else this.running.get(b.id)!.bot = b;
    }
  }

  bind() {
    bus.on('market.candle.updated', (payload) => {
      const key = (payload as { key?: string })?.key;
      if (!key) return;
      void this.onTick(key);
    });
  }

  private async onTick(key: string) {
    for (const entry of this.running.values()) {
      const baseKey = windowKey(entry.bot.marketType, entry.bot.symbol, '1m');
      if (baseKey !== key) continue;
      if (this.ticking.has(entry.bot.id)) continue;
      this.ticking.add(entry.bot.id);
      try {
        await this.tick(entry);
      } catch (e) {
        console.error(`[grid] tick ${entry.bot.name}:`, e);
      } finally {
        this.ticking.delete(entry.bot.id);
      }
    }
  }

  private async tick(entry: RunningBot) {
    const bot = entry.bot;
    const candles = candleService.peek(bot.marketType, bot.symbol, '1m');
    if (candles.length < 2) return;
    const price = candleService.lastPrice(bot.marketType, bot.symbol) || candles.at(-1)!.close;
    const prev = bot.lastPrice;
    bot.lastPrice = price;
    if (prev == null || price <= 0) return;

    // stop gate (cross-chart): auto-stop when matched (own logic, default any)
    if (bot.stopConditions.length) {
      const stopLogic = bot.stopLogic ?? 'any';
      if (this.gateMatched(bot, bot.stopConditions, entry.gateKeys, stopLogic)) {
        logAudit({ category: 'grid', action: 'grid.stop_gate', strategyId: bot.id, symbol: bot.symbol, payload: { stopConditions: bot.stopConditions } });
        // persist the stop even when no fill happened this tick
        botsRepo.update(bot.id, { levels: bot.levels, buyStack: bot.buyStack, lastPrice: price, stats: bot.stats });
        this.stopBot(bot.id, 'gate');
        return;
      }
    }

    // entry gate: grid only trades while matched (empty = always)
    if (bot.entryConditions.length && !this.gateMatched(bot, bot.entryConditions, entry.gateKeys, bot.entryLogic)) {
      return;
    }

    // process level crossings between prev and current price.
    // INVARIANT: exchange fills FIRST, local inventory state second — a failed
    // order must never release inventory or book phantom profit.
    let dirty = false;
    for (const level of bot.levels) {
      const down = prev > level.price && price <= level.price;
      const up = prev < level.price && price >= level.price;
      if (down && !level.hasInventory) {
        const fills = await this.execFill(bot, 'buy', level.price, bot.quantityPerGrid);
        if (fills.length) {
          level.hasInventory = true;
          bot.buyStack.push({ price: level.price, qty: bot.quantityPerGrid, ts: Date.now() });
          dirty = true;
          this.recordFills(bot, fills);
        }
      } else if (up) {
        const idx = bot.buyStack.findIndex((b) => b.price < level.price);
        if (idx >= 0) {
          const open = bot.buyStack[idx]; // not removed until the sell fills
          const fills = await this.execFill(bot, 'sell', level.price, bot.quantityPerGrid);
          if (fills.length) {
            bot.buyStack.splice(idx, 1);
            const sourceLevel = bot.levels.find((l) => Math.abs(l.price - open.price) < 1e-9);
            if (sourceLevel) sourceLevel.hasInventory = false;
            dirty = true;
            this.recordFills(bot, fills, open.price);
          }
        }
      }
    }
    if (dirty) {
      botsRepo.update(bot.id, {
        levels: bot.levels, buyStack: bot.buyStack, lastPrice: price, fills: bot.fills, stats: bot.stats,
      });
    } else {
      bot.lastPrice = price; // advance even without fills so crossings stay correct
    }
  }

  private gateMatched(bot: GridBot, conditions: GridBot['entryConditions'], gateKeys: string[], logic: 'all' | 'any'): boolean {
    void gateKeys;
    const base = candleService.peek(bot.marketType, bot.symbol, '1m');
    if (base.length < 25) return false;
    const getWindow = (sel: { tf?: Timeframe; symbol?: string; marketType?: MarketType }) => {
      const arr = candleService.peek(sel.marketType ?? bot.marketType, (sel.symbol ?? bot.symbol).toUpperCase(), sel.tf ?? '1m');
      return arr.length >= 2 ? arr : undefined;
    };
    return evaluateConditions(conditions, logic, {
      candles: base,
      price: candleService.lastPrice(bot.marketType, bot.symbol) || base.at(-1)!.close,
      getWindow,
    }).matched;
  }

  private async execFill(bot: GridBot, side: 'buy' | 'sell', price: number, qty: number): Promise<GridFill[]> {
    const instrument = await candleService.instrument(bot.marketType, bot.symbol).catch(() => undefined);
    const paper = bot.paper || isPaperMode();
    const accounts = paper ? [undefined as string | undefined] : (bot.accountIds.length ? bot.accountIds : [undefined]);
    const fills: GridFill[] = [];
    await Promise.all(
      accounts.map(async (accountId) => {
        const res = await executeOrderAction({
          symbol: bot.symbol,
          marketType: bot.marketType,
          order: {
            type: 'order', orderType: 'market', side,
            size: qty, price,
            // hedge-mode contracts: sells release previously bought inventory,
            // they must not open a fresh short
            tradeSide: bot.marketType === 'futures' ? (side === 'sell' ? 'close' : 'open') : undefined,
            leverage: bot.leverage > 1 ? bot.leverage : undefined,
          },
          paper,
          accountId,
          category: 'grid',
          strategyId: `grid_${bot.id.replace(/-/g, '').slice(0, 10)}`,
          ...precisionFields(instrument),
        });
        if (res.ok) {
          fills.push({ ts: Date.now(), side, levelPrice: price, price, qty, accountId, paper });
        }
      }),
    );
    return fills;
  }

  /** Book stats from ACTUAL fills: multi-account fan-outs realize N times,
   *  failures realize nothing (buy/sell asymmetry fixed). */
  private recordFills(bot: GridBot, fills: GridFill[], openPrice?: number) {
    for (const f of fills) {
      if (f.side === 'buy') {
        bot.stats.buyFills += 1;
        bot.stats.fees += TAKER_FEE * f.price * f.qty;
        bot.fills.unshift(f);
      } else {
        const open = openPrice ?? f.levelPrice;
        const gross = (f.price - open) * f.qty;
        const fees = TAKER_FEE * (f.price + open) * f.qty;
        const pnl = gross - fees;
        f.pnl = pnl;
        bot.stats.sellFills += 1;
        bot.stats.realizedPnl += pnl;
        bot.stats.fees += fees;
        bot.fills.unshift({ ...f, pnl });
      }
      notify('grid.fill', {
        name: bot.name, symbol: bot.symbol, side: f.side, qty: f.qty, price: f.price,
      }, { level: f.side === 'buy' ? 'info' : 'success', channel: 'grid' });
    }
    if (bot.fills.length > 200) bot.fills.length = 200;
    logAudit({
      category: 'grid', action: `grid.${fills[0]?.side ?? 'fill'}`,
      accountId: fills[0]?.accountId ?? null, strategyId: bot.id, symbol: bot.symbol,
      payload: { levelPrice: fills[0]?.levelPrice, price: fills[0]?.price, qty: fills[0]?.qty, openPrice, fills: fills.length, accounts: fills.map((f) => f.accountId ?? 'paper') },
      result: 'ok',
    });
  }
}

export const gridEngine = new GridEngine();
