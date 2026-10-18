import type { Signal } from "@prisma/client";
import { FEED_LIMIT } from "@/lib/site";
import { db } from "@/lib/db";
import { clampInt } from "@/lib/utils";

/** Wire types for the five-timeframe board and key levels. */
export type PatternDTO = { key: string; prob: number | null };

export type BoardEntryDTO = {
  tf: string;
  regime: string;
  score: number;
  prob: number | null;
  patterns: PatternDTO[];
};

export type LevelsDTO = {
  resistance?: string;
  pivot?: string;
  support?: string;
  donchianHigh?: string;
  donchianLow?: string;
  breakout: string;
};

export type NhnlRowDTO = {
  tf: string; // case-sensitive: 1m (minute) vs 1M (month)
  barTime: number;
  barHigh: string;
  barLow: string;
  nh: boolean;
  nl: boolean;
  prevHigh: string | null;
  prevLow: string | null;
  brkUp: boolean;
  brkDown: boolean;
  donHigh: string | null;
  donLow: string | null;
  donUp: boolean;
  donDown: boolean;
  distHighPct: number | null;
  distLowPct: number | null;
};

export type NhnlDTO = {
  price?: string;
  donN: number;
  rows: NhnlRowDTO[];
};

/**
 * Wire format for signals. Prices are decimal strings (JSON numbers lose
 * precision beyond 2^53 and Prisma Decimal is not JSON-serializable);
 * model scores/probabilities are plain numbers.
 */
export type SignalDTO = {
  id: string;
  type: string;
  symbol: string;
  marketType: string;
  price: string | null;
  timeframe: string;
  regime: string;
  score: number;
  message: string | null;
  board: BoardEntryDTO[] | null;
  levels: LevelsDTO | null;
  nhnl: NhnlDTO | null;
  pushedAt: string;
  receivedAt: string;
};

export type FeedStatsDTO = {
  total: number;
  last24h: number;
  lastSignalAt: string | null;
  serverTime: string;
};

export type FeedResponse = {
  signals: SignalDTO[];
  /** null when the sinceId cursor returned nothing new; the client keeps its previous stats */
  stats: FeedStatsDTO | null;
  hasMore: boolean;
};

export function serializeSignal(s: Signal): SignalDTO {
  const board = Array.isArray(s.board) ? s.board.map(serializeBoardEntry) : null;
  const levels =
    s.levels && typeof s.levels === "object" && !Array.isArray(s.levels)
      ? serializeLevels(s.levels as Record<string, unknown>)
      : null;
  const nhnl =
    s.nhnl && typeof s.nhnl === "object" && !Array.isArray(s.nhnl)
      ? serializeNhnl(s.nhnl as Record<string, unknown>)
      : null;
  return {
    id: s.id,
    type: s.type,
    symbol: s.symbol,
    marketType: s.marketType,
    price: s.price ? s.price.toString() : null,
    timeframe: s.timeframe,
    regime: s.regime,
    score: s.score,
    message: s.message,
    board: board && board.length > 0 ? board : null,
    levels,
    nhnl,
    pushedAt: s.pushedAt.toISOString(),
    receivedAt: s.receivedAt.toISOString(),
  };
}

function serializeBoardEntry(entry: unknown): BoardEntryDTO {
  const e = (entry ?? {}) as Record<string, unknown>;
  return {
    tf: typeof e.tf === "string" ? e.tf : "?",
    regime: typeof e.regime === "string" ? e.regime : "neutral",
    score: typeof e.score === "number" ? e.score : 0,
    prob: typeof e.prob === "number" ? e.prob : null,
    patterns: Array.isArray(e.patterns)
      ? e.patterns.slice(0, 12).map((p) => {
          const pat = (p ?? {}) as Record<string, unknown>;
          return {
            key: typeof pat.key === "string" ? pat.key : "unknown",
            prob: typeof pat.prob === "number" ? pat.prob : null,
          };
        })
      : [],
  };
}

function serializeLevels(l: Record<string, unknown>): LevelsDTO {
  const num = (v: unknown): string | undefined =>
    typeof v === "number" || typeof v === "string" ? String(v) : undefined;
  return {
    resistance: num(l.resistance),
    pivot: num(l.pivot),
    support: num(l.support),
    donchianHigh: num(l.donchianHigh),
    donchianLow: num(l.donchianLow),
    breakout: typeof l.breakout === "string" ? l.breakout : "inside",
  };
}

function serializeNhnl(n: Record<string, unknown>): NhnlDTO | null {
  const rawRows = Array.isArray(n.rows) ? n.rows : [];
  const rows = rawRows.slice(0, 12).map((r): NhnlRowDTO => {
    const row = (r ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | null =>
      typeof v === "number" || typeof v === "string" ? String(v) : null;
    const numOrNull = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const bool = (v: unknown): boolean => v === true;
    return {
      tf: typeof row.tf === "string" ? row.tf : "?",
      barTime: typeof row.barTime === "number" ? row.barTime : 0,
      barHigh: str(row.barHigh) ?? "0",
      barLow: str(row.barLow) ?? "0",
      nh: bool(row.nh),
      nl: bool(row.nl),
      prevHigh: str(row.prevHigh),
      prevLow: str(row.prevLow),
      brkUp: bool(row.brkUp),
      brkDown: bool(row.brkDown),
      donHigh: str(row.donHigh),
      donLow: str(row.donLow),
      donUp: bool(row.donUp),
      donDown: bool(row.donDown),
      distHighPct: numOrNull(row.distHighPct),
      distLowPct: numOrNull(row.distLowPct),
    };
  });
  if (!rows.length) return null;
  return {
    price: typeof n.price === "number" || typeof n.price === "string" ? String(n.price) : undefined,
    donN: typeof n.donN === "number" ? n.donN : 20,
    rows,
  };
}

export function serializeStats(
  total: number,
  last24h: number,
  lastSignalAt: Date | null,
): FeedStatsDTO {
  return {
    total,
    last24h,
    lastSignalAt: lastSignalAt ? lastSignalAt.toISOString() : null,
    serverTime: new Date().toISOString(),
  };
}

/**
 * Latest feed page, newest first. `sinceId` returns only signals strictly
 * newer than the given id. Used by the 20s poller so repeat fetches stay
 * tiny when nothing changed (empty array + null stats).
 */
export async function getFeed(options: {
  limit?: unknown;
  sinceId?: string | null;
}): Promise<{ signals: SignalDTO[]; hasMore: boolean; lastSignalAt: Date | null }> {
  const limit = clampInt(options.limit, 1, FEED_LIMIT, FEED_LIMIT);

  const anchor = options.sinceId
    ? await db.signal.findUnique({
        where: { id: options.sinceId },
        select: { receivedAt: true },
      })
    : null;

  // Fetch the latest window (at most 100 rows) and slice in memory; index-friendly.
  const rows = await db.signal.findMany({
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  let sliced = rows;
  if (anchor) {
    const anchorMs = anchor.receivedAt.getTime();
    sliced = rows.filter(
      (r) =>
        r.receivedAt.getTime() > anchorMs ||
        (r.receivedAt.getTime() === anchorMs && r.id > (options.sinceId ?? "")),
    );
  }

  return {
    signals: sliced.map(serializeSignal),
    hasMore: rows.length === limit,
    lastSignalAt: rows[0]?.receivedAt ?? null,
  };
}

export async function getFeedStats(): Promise<FeedStatsDTO> {
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const [total, last24h, newest] = await Promise.all([
    db.signal.count(),
    db.signal.count({ where: { receivedAt: { gte: dayAgo } } }),
    db.signal.findFirst({
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      select: { receivedAt: true },
    }),
  ]);
  return serializeStats(total, last24h, newest?.receivedAt ?? null);
}
