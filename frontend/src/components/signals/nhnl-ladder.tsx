"use client";

import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/utils";
import type { NhnlDTO, NhnlRowDTO } from "@/lib/signals/dto";

/** One window's plain-language state — no cryptic abbreviations. */
function describeRow(r: NhnlRowDTO, donN: number): { text: string; tone: string; hint: string } {
  const bull = "text-success";
  const bear = "text-destructive";
  const mixed = "text-amber-500";
  if (r.nh && r.nl)
    return { text: "at both high & low", tone: mixed, hint: "window just opened — one print so far" };
  if (r.nh)
    return { text: "at a new HIGH", tone: bull, hint: "the live price is the highest since this window opened" };
  if (r.nl)
    return { text: "at a new LOW", tone: bear, hint: "the live price is the lowest since this window opened" };
  if (r.brkUp)
    return { text: "broke prev. high", tone: bull, hint: `price moved above the previous closed ${r.tf} candle's high` };
  if (r.brkDown)
    return { text: "broke prev. low", tone: bear, hint: `price moved below the previous closed ${r.tf} candle's low` };
  if (r.donUp)
    return { text: `${donN}-window high broken`, tone: bull, hint: `price is above the highest of the last ${donN} closed candles` };
  if (r.donDown)
    return { text: `${donN}-window low broken`, tone: bear, hint: `price is below the lowest of the last ${donN} closed candles` };
  return { text: "inside range", tone: "text-muted-foreground", hint: "no break on this window" };
}

/**
 * Multi-timeframe new-high/new-low ladder from the producer's `nhnl` block.
 * Each row answers, in plain language: is the live price at a new high/low
 * of that window's forming candle, did it break the previous closed candle,
 * and did it break the Donchian-N channel — plus how far it is from the
 * window's current high/low. Shared by the drawer, feed detail and /chart.
 */
export function NhnlLadder({ nhnl, className }: { nhnl: NhnlDTO; className?: string }) {
  return (
    <div className={cn("mt-3.5", className)}>
      <div className="overflow-hidden rounded-lg bg-muted/60">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-1.5 text-left font-semibold">Window</th>
              <th className="px-1 py-1.5 text-left font-semibold">What happened</th>
              <th className="px-2 py-1.5 text-right font-semibold">To high / to low</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {nhnl.rows.map((r) => {
              const d = describeRow(r, nhnl.donN);
              return (
                <tr key={r.tf} className="border-t border-border/50" title={d.hint}>
                  <td className="px-2 py-1.5 font-semibold">{r.tf}</td>
                  <td className={cn("px-1 py-1.5 font-semibold", d.tone)}>{d.text}</td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">
                    {(r.distHighPct ?? 0).toFixed(2)}% / {(r.distLowPct ?? 0).toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        Each row is one window (1h = the current hour, 1d = today, …).
        &quot;To high / to low&quot; = how far the price is (in %) from this window&apos;s running high and
        low — 0.00 means the price IS that extreme right now. A window&apos;s extremes update
        live with every trade.
      </p>
    </div>
  );
}
