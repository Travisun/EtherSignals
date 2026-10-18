"use client";

import { ChevronDown } from "lucide-react";
import type { LevelsDTO, SignalDTO } from "@/lib/signals/dto";
import { NhnlLadder } from "@/components/signals/nhnl-ladder";
import { patternLabel } from "@/lib/constants";
import { formatClock, formatDateTime, formatPrice } from "@/lib/utils";
import {
  BreakoutBadge,
  MarketChip,
  RegimeBadge,
  TrendBoard,
  formatScore,
  regimeMeta,
} from "@/components/signals/regime";
import { cn } from "@/lib/utils";

/** Marks the newest record in the window (expanded by default). */
function LatestChip() {
  return (
    <span className="inline-flex h-[16px] items-center rounded bg-primary/12 px-1 text-[9px] font-bold uppercase tracking-wider text-primary">
      Latest
    </span>
  );
}

/** Probability readout; null means the model lacks history (fewer than 15 samples). */
function Prob({ prob }: { prob: number | null }) {
  if (prob === null || prob === undefined) {
    return <span className="text-muted-foreground">n/a</span>;
  }
  return (
    <span className="tnum">
      {Math.round(prob * 100)}%
      <span className="ml-1 text-[10px] text-muted-foreground">win</span>
    </span>
  );
}

function LevelLine({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string | null;
  tone?: "up" | "down";
}) {  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "tnum font-medium",
          tone === "up" && "text-destructive",
          tone === "down" && "text-success",
        )}
      >
        {value ? formatPrice(value) : "n/a"}
      </span>
    </div>
  );
}

/** Expanded detail: model breakdown + key levels + the channel message. */
function SignalDetail({ signal }: { signal: SignalDTO }) {
  return (
    <div className="grid gap-4 border-t border-border bg-muted/25 px-3 py-3 md:grid-cols-2 md:gap-5 md:px-5 md:py-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          AI trend model · five-timeframe breakdown
        </p>
        <table className="mt-1.5 w-full text-left text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-1 font-medium">TF</th>
              <th className="py-1 font-medium">Trend</th>
              <th className="py-1 font-medium">Score</th>
              <th className="py-1 font-medium">Continuation</th>
            </tr>
          </thead>
          <tbody>
            {(signal.board ?? []).map((entry) => (
              <tr key={entry.tf} className="border-t border-border/60">
                <td className="py-1.5 font-semibold">{entry.tf}</td>
                <td className="py-1">
                  <span
                    className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      regimeMeta(entry.regime).badge,
                    )}
                  >
                    {regimeMeta(entry.regime).label}
                  </span>
                </td>
                <td
                  className={cn(
                    "tnum py-1.5 font-semibold",
                    regimeMeta(entry.regime).text,
                  )}
                >
                  {formatScore(entry.score, 3)}
                </td>
                <td className="tnum py-1.5">
                  <Prob prob={entry.prob} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {signal.board?.some((e) => e.patterns.length > 0) ? (
          <div className="mt-3">
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Patterns on the latest candle
            </p>
            <ul className="mt-1 space-y-0.5">
              {signal.board
                .filter((e) => e.patterns.length > 0)
                .map((e) =>
                  e.patterns.map((p, i) => (
                    <li
                      key={`${e.tf}-${p.key}-${i}`}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-muted-foreground">
                        <span className="font-semibold text-foreground">{e.tf}</span>{" "}
                        {patternLabel(p.key)}
                      </span>
                      <span className="tnum">
                        <Prob prob={p.prob ?? null} />
                      </span>
                    </li>
                  )),
                )}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Key levels
          </p>
          {signal.levels ? (
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              <LevelLine label="Resistance" value={signal.levels.resistance} tone="up" />
              <LevelLine label="Support" value={signal.levels.support} tone="down" />
              <LevelLine label="Pivot (PP)" value={signal.levels.pivot} />
              <LevelLine label="Breakout" value={signal.levels.breakout === "up" ? "above 20d" : signal.levels.breakout === "down" ? "below 20d" : "inside"} />
              <LevelLine label="20d high" value={signal.levels.donchianHigh} />
              <LevelLine label="20d low" value={signal.levels.donchianLow} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Levels are warming up: the daily history module needs a few more
              candles before levels become available.
            </p>
          )}
          {signal.nhnl ? <NhnlLadder nhnl={signal.nhnl} /> : null}
        </div>

        {signal.message ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              As published on Telegram
            </p>
            <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground md:max-h-56 md:p-3 md:text-[11px]">
              {signal.message}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Desktop table row with expandable model breakdown. `timeLocal` gates the
 * clock: SSR renders a placeholder so the first paint never leaks the
 * server timezone; after hydration the browser locale takes over.
 */
export function SignalRow({
  signal,
  isNew,
  isLatest,
  expanded,
  onToggle,
  timeLocal,
}: {
  signal: SignalDTO;
  isNew: boolean;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
  timeLocal: boolean;
}) {
  return (
    <>
      <tr
        className={`cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40 ${
          isNew ? "signal-flash" : ""
        }`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
          <time
            dateTime={signal.pushedAt}
            title={timeLocal ? formatDateTime(signal.pushedAt) : undefined}
            suppressHydrationWarning
            className="tnum"
          >
            {timeLocal ? formatClock(signal.pushedAt) : "…"}
          </time>
        </td>
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-1.5">
            <span className="text-sm font-semibold tracking-tight">{signal.symbol}</span>
            <MarketChip marketType={signal.marketType} />
            {isLatest ? <LatestChip /> : null}
          </span>
        </td>
        <td className="tnum px-3 py-2.5 text-sm font-semibold">
          {formatPrice(signal.price)}
        </td>
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-1.5">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
              {signal.timeframe}
            </span>
            <RegimeBadge regime={signal.regime} />
            <span className={cn("tnum text-xs font-semibold", regimeMeta(signal.regime).text)}>
              {formatScore(signal.score)}
            </span>
          </span>
        </td>
        <td className="px-3 py-2.5">
          <TrendBoard board={signal.board} highlightTf={signal.timeframe} />
        </td>
        <td className="px-3 py-2.5 text-right">
          <ChevronDown
            className={cn(
              "ml-auto size-4 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border/60 last:border-0">
          <td colSpan={6} className="p-0">
            <SignalDetail signal={signal} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Mobile card, same time-localization gating as the desktop row. */
export function SignalCard({
  signal,
  isNew,
  isLatest,
  expanded,
  onToggle,
  timeLocal,
}: {
  signal: SignalDTO;
  isNew: boolean;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
  timeLocal: boolean;
}) {
  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        isNew && "signal-flash",
      )}
    >
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full cursor-pointer px-3 py-2.5 text-left"
      >
        <header className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <span className="text-sm font-bold tracking-tight">{signal.symbol}</span>
            <MarketChip marketType={signal.marketType} />
            {isLatest ? <LatestChip /> : null}
          </span>
          <span className="flex items-center gap-2">
            <time
              dateTime={signal.pushedAt}
              title={timeLocal ? formatDateTime(signal.pushedAt) : undefined}
              suppressHydrationWarning
              className="tnum text-[10px] text-muted-foreground"
            >
              {timeLocal ? formatClock(signal.pushedAt) : "…"}
            </time>
          </span>
        </header>

        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
            {signal.timeframe}
          </span>
          <RegimeBadge regime={signal.regime} />
          <span className={cn("tnum text-xs font-semibold", regimeMeta(signal.regime).text)}>
            {formatScore(signal.score)}
          </span>
          <span className="tnum ml-auto text-sm font-bold">
            {formatPrice(signal.price)}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <TrendBoard board={signal.board} highlightTf={signal.timeframe} showScores={false} />
          {signal.levels?.resistance ? (
            <span className="tnum shrink-0 text-right text-[10px] leading-tight text-muted-foreground">
              R {formatPrice(signal.levels.resistance)}
              <br />S {formatPrice(signal.levels.support ?? null)}
            </span>
          ) : null}
        </div>

        <p className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-primary">
          <span>{expanded ? "Hide analysis" : "View analysis"}</span>
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </p>
      </button>

      {expanded ? (
        <div className="border-t border-border">
          <SignalDetail signal={signal} />
        </div>
      ) : null}
    </article>
  );
}

export type { LevelsDTO };
