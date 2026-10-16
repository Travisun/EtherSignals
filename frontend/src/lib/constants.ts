/** Canonical enumerations from the GTrading signal.trend contract. */
import { z } from "zod";

export const REGIMES = ["strong_up", "up", "neutral", "down", "strong_down"] as const;
export const MARKET_TYPES = ["futures", "spot"] as const;
export const BREAKOUTS = ["up", "down", "inside"] as const;

/// Canonical board order. The producer guarantees 2m→5m→30m→2h→1d; we sort
/// defensively so display never depends on wire order.
export const TIMEFRAME_ORDER = ["2m", "5m", "30m", "2h", "1d"] as const;

export const regimeSchema = z.enum(REGIMES);
export const marketTypeSchema = z.enum(MARKET_TYPES);
export const breakoutSchema = z.enum(BREAKOUTS);

export type Regime = (typeof REGIMES)[number];
export type MarketType = (typeof MARKET_TYPES)[number];
export type Breakout = (typeof BREAKOUTS)[number];

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_RAW_PAYLOAD_BYTES = 16 * 1024;
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
export const BOARD_SIZE = 5;

/** Friendly labels for pattern keys from the GTrading model. */
export const PATTERN_LABELS: Record<string, string> = {
  ema_align_bull: "EMA bullish alignment",
  ema_align_bear: "EMA bearish alignment",
  macd_golden: "MACD golden cross",
  macd_dead: "MACD death cross",
  st_flip_bull: "Supertrend flips bullish",
  st_flip_bear: "Supertrend flips bearish",
  rsi_recovery: "RSI recovery",
  rsi_fade: "RSI fading",
  donchian_break_up: "Donchian breakout ↑",
  donchian_break_down: "Donchian breakdown ↓",
  bb_squeeze: "Bollinger squeeze",
};

export function patternLabel(key: string): string {
  return PATTERN_LABELS[key] ?? key.replaceAll("_", " ");
}

/** Human-readable regime names (client-safe, no server imports). */
export const REGIME_LABELS: Record<string, string> = {
  strong_up: "Strong Up",
  up: "Up",
  neutral: "Range",
  down: "Down",
  strong_down: "Strong Down",
};
