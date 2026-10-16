/**
 * Seeds the database with realistic demo signals (dev and demo only).
 * Never run against production data: it inserts fake model outputs.
 *
 * Run: npm run db:seed
 */
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();

const TFS = ["2m", "5m", "30m", "2h", "1d"] as const;
type Regime = "strong_up" | "up" | "neutral" | "down" | "strong_down";
const PATTERN_KEYS = [
  "ema_align_bull",
  "macd_golden",
  "st_flip_bull",
  "rsi_recovery",
  "ema_align_bear",
  "macd_dead",
  "st_flip_bear",
  "donchian_break_up",
  "bb_squeeze",
] as const;

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function regimeFor(score: number): Regime {
  if (score >= 0.55) return "strong_up";
  if (score >= 0.2) return "up";
  if (score <= -0.55) return "strong_down";
  if (score <= -0.2) return "down";
  return "neutral";
}

/** Correlated random score around a base. */
function correlated(base: number): number {
  const drift = base + rand(-0.3, 0.3);
  return Math.max(-1, Math.min(1, Number(drift.toFixed(3))));
}

function makeSignal(i: number): Prisma.SignalCreateManyInput {
  const price = 3100 + rand(-160, 160);
  // Slow drift so the board evolves believably over the seed series.
  const triggerScore = Number(rand(-1, 1).toFixed(3));
  const triggerTf = pick(TFS);
  const board = TFS.map((tf) => {
    const base = tf === triggerTf ? triggerScore : correlated(triggerScore * 0.6);
    const score = Number(Math.max(-1, Math.min(1, base)).toFixed(3));
    const enoughHistory = Math.random() > 0.15;
    const patterns: { key: string; prob: number | null }[] = [];
    if (Math.random() > 0.55) {
      const bull = score >= 0;
      const key = pick(bull ? PATTERN_KEYS.slice(0, 4) : PATTERN_KEYS.slice(4));
      patterns.push({
        key,
        prob: Math.random() > 0.2 ? Number(rand(0.3, 0.7).toFixed(2)) : null,
      });
    }
    return {
      tf,
      regime: regimeFor(score),
      score,
      prob: enoughHistory ? Number(rand(0.3, 0.72).toFixed(2)) : null,
      patterns,
    };
  });

  const trigger = board.find((b) => b.tf === triggerTf)!;
  const regime = trigger.regime;
  const warmup = Math.random() < 0.12;
  const levels: {
    pivot: string;
    resistance?: string;
    support?: string;
    donchianHigh: string;
    donchianLow: string;
    breakout: "up" | "down" | "inside";
  } | null = warmup
    ? null
    : {
        pivot: (price * rand(0.985, 1.015)).toFixed(2),
        ...(Math.random() > 0.2
          ? { resistance: (price * rand(1.005, 1.04)).toFixed(2) }
          : {}),
        ...(Math.random() > 0.2
          ? { support: (price * rand(0.96, 0.995)).toFixed(2) }
          : {}),
        donchianHigh: (price * rand(1.03, 1.12)).toFixed(2),
        donchianLow: (price * rand(0.9, 0.97)).toFixed(2),
        breakout: pick(["up", "inside", "inside", "down"] as const),
      };

  const label: Record<string, string> = {
    strong_up: "Strong Up",
    up: "Up",
    neutral: "Range",
    down: "Down",
    strong_down: "Strong Down",
  };
  const score = trigger.score;
  const arrow = score > 0.2 ? "▲" : score < -0.2 ? "▼" : "→";
  const message = [
    `[ETHUSDT] ${triggerTf} 趋势档位更新`,
    ``,
    `${arrow} ${label[regime]}  (score ${score >= 0 ? "+" : ""}${score.toFixed(3)})`,
    board.map((b) => `${b.tf}:${b.score >= 0 ? "+" : ""}${b.score.toFixed(2)}`).join("  "),
    ``,
    `延续概率: ${trigger.prob === null ? "样本不足" : `${Math.round(trigger.prob * 100)}%`}`,
    levels
      ? `阻力 ${levels.resistance ?? "n/a"} · PP ${levels.pivot} · 支撑 ${levels.support ?? "n/a"}`
      : `关键价位: 日线预热中`,
  ].join("\n");

  const pushedAt = new Date(Date.now() - i * rand(4, 40) * 60_000);

  return {
    pushedAt,
    type: "signal.trend",
    symbol: "ETHUSDT",
    marketType: i % 9 === 0 ? "spot" : "futures",
    price: price.toFixed(2),
    timeframe: triggerTf,
    regime,
    score,
    message,
    board,
    levels: levels === null ? Prisma.DbNull : levels,
    raw: { seeded: true, note: "demo data, do not trade" },
  };
}

async function main() {
  const existing = await db.signal.count();
  if (existing > 0) {
    console.log(`Signals table already has ${existing} rows, skipping seed.`);
    return;
  }
  const count = Number(process.argv[2] ?? 24);
  const signals = Array.from({ length: count }, (_, i) => makeSignal(i));
  await db.signal.createMany({ data: signals });
  console.log(`Seeded ${signals.length} demo signals.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
