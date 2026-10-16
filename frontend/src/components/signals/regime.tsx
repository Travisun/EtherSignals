import { cn } from "@/lib/utils";
import type { Regime } from "@/lib/constants";

export const REGIME_META: Record<
  string,
  { label: string; short: string; cell: string; badge: string; text: string }
> = {
  strong_up: {
    label: "Strong Up",
    short: "S.Up",
    cell: "bg-success text-success-foreground",
    badge: "bg-success/15 text-success",
    text: "text-success",
  },
  up: {
    label: "Up",
    short: "Up",
    cell: "bg-success/15 text-success",
    badge: "bg-success/10 text-success",
    text: "text-success",
  },
  neutral: {
    label: "Range",
    short: "Flat",
    cell: "bg-muted text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
  },
  down: {
    label: "Down",
    short: "Down",
    cell: "bg-destructive/15 text-destructive",
    badge: "bg-destructive/10 text-destructive",
    text: "text-destructive",
  },
  strong_down: {
    label: "Strong Down",
    short: "S.Down",
    cell: "bg-destructive text-destructive-foreground",
    badge: "bg-destructive/15 text-destructive",
    text: "text-destructive",
  },
};

export function regimeMeta(regime: string) {
  return REGIME_META[regime] ?? REGIME_META.neutral;
}

export function RegimeBadge({
  regime,
  className,
}: {
  regime: string;
  className?: string;
}) {
  const meta = regimeMeta(regime);
  const arrow =
    regime === "strong_up" || regime === "up"
      ? "↑"
      : regime === "down" || regime === "strong_down"
        ? "↓"
        : "↔";
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-[11px] font-semibold uppercase tracking-wide",
        meta.badge,
        className,
      )}
    >
      {arrow}
      {meta.label}
    </span>
  );
}

/** +0.34 / -0.51, signed and rounded for compact display. */
export function formatScore(score: number, digits = 2): string {
  if (!Number.isFinite(score)) return "n/a";
  return `${score >= 0 ? "+" : ""}${score.toFixed(digits)}`;
}

/**
 * The five-timeframe trend board. `highlightTf` marks the timeframe that
 * triggered the push (ring accent).
 */
export function TrendBoard({
  board,
  highlightTf,
  showScores = true,
  className,
}: {
  board: { tf: string; regime: string; score: number }[] | null;
  highlightTf?: string;
  showScores?: boolean;
  className?: string;
}) {
  if (!board || board.length === 0) {
    return <span className="text-xs text-muted-foreground">n/a</span>;
  }
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {board.map((entry) => {
        const meta = regimeMeta(entry.regime);
        const isTrigger = entry.tf === highlightTf;
        return (
          <span
            key={entry.tf}
            title={`${entry.tf} · ${meta.label} · score ${formatScore(entry.score)}`}
            className={cn(
              "flex min-w-[38px] flex-col items-center gap-0.5 rounded-md px-1.5 py-1 text-[10px] font-semibold leading-none",
              meta.cell,
              isTrigger && "ring-2 ring-primary ring-offset-1 ring-offset-card",
            )}
          >
            <span className="opacity-80">{entry.tf}</span>
            {showScores ? (
              <span className="tnum text-[9px] font-bold">
                {formatScore(entry.score)}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

export function BreakoutBadge({ breakout }: { breakout: string }) {
  const map: Record<string, { label: string; className: string }> = {
    up: { label: "↑ 20d high broken", className: "bg-success/12 text-success" },
    down: { label: "↓ 20d low broken", className: "bg-destructive/12 text-destructive" },
    inside: { label: "In 20d range", className: "bg-muted text-muted-foreground" },
  };
  const meta = map[breakout] ?? map.inside;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded-md px-2 text-[11px] font-semibold",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

export function MarketChip({ marketType }: { marketType: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[16px] items-center rounded px-1 text-[9px] font-bold uppercase tracking-wider",
        marketType === "spot"
          ? "bg-info/12 text-info"
          : "bg-accent text-accent-foreground",
      )}
    >
      {marketType === "spot" ? "Spot" : "Perp"}
    </span>
  );
}

export type { Regime };
