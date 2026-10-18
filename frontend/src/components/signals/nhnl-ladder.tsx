"use client";

import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/utils";
import type { NhnlDTO } from "@/lib/signals/dto";

/**
 * Multi-timeframe new-high/new-low ladder from the producer's `nhnl` block:
 * per timeframe, whether the live price is at the forming bar's running
 * high/low (NH/NL), broke the previous closed bar (prev), or broke the
 * Donchian-N channel — plus the distance to the current bar's extremes.
 * Shared by the signal drawer and the feed's expanded detail view.
 */
export function NhnlLadder({ nhnl, className }: { nhnl: NhnlDTO; className?: string }) {
  return (
    <div className={cn("mt-3.5", className)}>
      <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
        New high / low ladder · Donchian-{nhnl.donN}
      </p>
      <div className="overflow-hidden rounded-lg bg-muted/60">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-2 py-1 text-left font-semibold">TF</th>
              <th className="px-1 py-1 text-left font-semibold">State</th>
              <th className="px-2 py-1 text-right font-semibold">Bar H / L</th>
              <th className="px-2 py-1 text-right font-semibold">To H / L %</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {nhnl.rows.map((r) => {
              const bull = r.nh || r.brkUp || r.donUp;
              const bear = r.nl || r.brkDown || r.donDown;
              const tone =
                bull && bear
                  ? "text-amber-500"
                  : bull
                    ? "text-success"
                    : bear
                      ? "text-destructive"
                      : "text-muted-foreground";
              const state =
                [
                  r.nh ? "NH" : r.nl ? "NL" : null,
                  r.brkUp ? "prev↑" : r.brkDown ? "prev↓" : null,
                  r.donUp ? `D${nhnl.donN}↑` : r.donDown ? `D${nhnl.donN}↓` : null,
                ]
                  .filter(Boolean)
                  .join(" ") || "·";
              return (
                <tr key={r.tf} className="border-t border-border/50">
                  <td className="px-2 py-1 font-semibold">{r.tf}</td>
                  <td className={cn("px-1 py-1 font-semibold", tone)}>{state}</td>
                  <td className="px-2 py-1 text-right text-muted-foreground">
                    {formatPrice(r.barHigh)} / {formatPrice(r.barLow)}
                  </td>
                  <td className="px-2 py-1 text-right text-muted-foreground">
                    {r.distHighPct?.toFixed(2) ?? "—"} / {r.distLowPct?.toFixed(2) ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
