import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  BOARD_SIZE,
  MAX_MESSAGE_LENGTH,
  breakoutSchema,
  marketTypeSchema,
  regimeSchema,
} from "@/lib/constants";

/**
 * Ingest contract for POST /api/webhooks/signals, one GTrading
 * "signal.trend" push per request (full five-timeframe snapshot).
 *
 * Producer semantics (GTrading docs/webhook.md):
 *  - `ts` (unix ms) identifies the push; the same state may arrive twice at
 *    merge-window boundaries → dedupe on ts.
 *  - `prob`, `levels.resistance`, `levels.support`, `patterns[].prob` may be
 *    null (insufficient history); all nullable here.
 *  - `levels` is null during daily-data warmup.
 *  - `resistance`/`support` are omitted entirely when price is beyond all
 *    levels → optional fields.
 *  - 10s timeout, failed deliveries retried once.
 */

const finiteNumber = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "string" ? v.trim() : v))
  .refine((v) => v !== "" && Number.isFinite(Number(v)), "must be a finite number")
  .transform((v) => Number(v));

const priceSchema = finiteNumber
  .refine((v) => Math.abs(v) < 1e15, "price out of range")
  .transform((v) => v.toString());

const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[A-Za-z0-9:\-_/-]+$/, "invalid symbol characters")
  .transform((v) => v.toUpperCase());

const timeframeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(8)
  .regex(/^\d{1,4}[smhd]$/, "invalid timeframe (expected like 5m, 2h, 1d)");

const patternSchema = z.object({
  key: z.string().trim().min(1).max(48),
  prob: z.number().min(0).max(1).nullable().optional(),
});

const boardEntrySchema = z.object({
  tf: timeframeSchema,
  regime: regimeSchema,
  score: z.number().min(-1).max(1),
  prob: z.number().min(0).max(1).nullable().optional(),
  patterns: z.array(patternSchema).max(12).optional().default([]),
});

const levelsSchema = z
  .object({
    resistance: priceSchema.optional(),
    pivot: priceSchema.optional(),
    support: priceSchema.optional(),
    donchianHigh: priceSchema.optional(),
    donchianLow: priceSchema.optional(),
    breakout: breakoutSchema,
  })
  .nullable()
  .optional();

// NHNL ladder timeframes keep case: "1m" (minute) vs "1M" (month) are distinct.
const nhnlTfSchema = z
  .string()
  .trim()
  .max(4)
  .regex(/^\d{1,3}[smhdwM]$/, "invalid ladder timeframe (expected like 1m, 4h, 2d, 1M)");

const nhnlRowSchema = z.object({
  tf: nhnlTfSchema,
  barTime: z.number().int().nonnegative(),
  // prices normalize to decimal strings (same convention as `levels`)
  barHigh: priceSchema,
  barLow: priceSchema,
  nh: z.boolean(),
  nl: z.boolean(),
  prevHigh: priceSchema.nullable(),
  prevLow: priceSchema.nullable(),
  brkUp: z.boolean(),
  brkDown: z.boolean(),
  donHigh: priceSchema.nullable(),
  donLow: priceSchema.nullable(),
  donUp: z.boolean(),
  donDown: z.boolean(),
  distHighPct: z.number().finite().nullable(),
  distLowPct: z.number().finite().nullable(),
});

const nhnlSchema = z
  .object({
    price: priceSchema.optional(),
    donN: z.number().int().min(1).max(200).optional().default(20),
    rows: z.array(nhnlRowSchema).max(12),
  })
  .nullable()
  .optional();

export const signalTrendSchema = z
  .object({
    type: z.literal("signal.trend"),
    ts: z
      .number()
      .int()
      .positive()
      .refine((v) => v <= Date.now() + 5 * 60_000, "ts is in the future"),
    message: z.string().max(MAX_MESSAGE_LENGTH).optional(),
    symbol: symbolSchema,
    marketType: marketTypeSchema.optional().default("futures"),
    price: priceSchema.optional(),
    timeframe: timeframeSchema,
    regime: regimeSchema,
    score: z.number().min(-1).max(1),
    signals: z.array(boardEntrySchema).min(1).max(BOARD_SIZE).optional(),
    levels: levelsSchema,
    nhnl: nhnlSchema,
  })
  .transform((data) => ({
    ...data,
    // Defensive: present the board in canonical 2m→5m→30m→2h→1d order.
    signals: data.signals
      ? [...data.signals].sort(
          (a, b) => tfRank(a.tf) - tfRank(b.tf),
        )
      : undefined,
  }));

function tfRank(tf: string): number {
  const unit = tf.at(-1) ?? "m";
  const size = Number(tf.slice(0, -1)) || 0;
  const unitRank: Record<string, number> = { s: 0, m: 1, h: 2, d: 3, w: 4 };
  return (unitRank[unit] ?? 9) * 10_000 + size;
}

export type WebhookSignal = z.infer<typeof signalTrendSchema>;

/**
 * Single narrowing point for the route: validates one signal.trend push.
 */
export function parseSignalTrend(
  data: unknown,
): { ok: true; data: WebhookSignal } | { ok: false; error: z.ZodError } {
  const result = signalTrendSchema.safeParse(data);
  if (!result.success) return { ok: false, error: result.error };
  return { ok: true, data: result.data };
}

/** Normalize zod output into Prisma create input (pure, testable). */
export function toSignalInput(
  s: WebhookSignal,
  raw: unknown,
): Prisma.SignalUncheckedCreateInput {
  return {
    pushedAt: new Date(s.ts),
    type: s.type,
    symbol: s.symbol,
    marketType: s.marketType,
    price: s.price ?? null,
    timeframe: s.timeframe,
    regime: s.regime,
    score: s.score,
    message: s.message ?? null,
    board: s.signals ? (s.signals as Prisma.InputJsonValue) : Prisma.DbNull,
    levels: (s.levels ?? Prisma.DbNull) as Prisma.NullableJsonNullValueInput,
    nhnl: (s.nhnl ?? Prisma.DbNull) as Prisma.NullableJsonNullValueInput,
    raw: compactRaw(raw) as Prisma.InputJsonValue,
  };
}

/** Keep the audit payload bounded, so a hostile body cannot bloat the DB. */
function compactRaw(raw: unknown): unknown {
  try {
    const json = JSON.stringify(raw);
    if (json.length <= 16 * 1024) return JSON.parse(json);
    return { truncated: true, preview: json.slice(0, 2048) };
  } catch {
    return null;
  }
}
