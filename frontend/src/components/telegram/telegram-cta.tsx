import { Timer, Zap } from "lucide-react";
import { TelegramBadge } from "@/components/telegram/telegram-logo";
import { TelegramButton } from "@/components/telegram/telegram-button";
import { cn } from "@/lib/utils";

/**
 * "Telegram is real-time, the web lags a little" notice with a channel CTA.
 * Rendered above the live feed so visitors understand the delivery
 * difference between the two surfaces before they start reading.
 */
export function TelegramCTA({ className }: { className?: string }) {
  return (
    <aside
      aria-label="Telegram channel: real-time delivery"
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      {/* brand accent edge */}
      <div
        className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#37AEE2] to-[#1E96C8]"
        aria-hidden={true}
      />

      <div className="flex flex-col gap-3 py-3.5 pl-5 pr-4 sm:flex-row sm:items-center sm:justify-between sm:py-4">
        <div className="flex items-start gap-3.5">
          <TelegramBadge size={44} />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              Telegram is always real-time
              <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
                <Zap className="size-3" />
                Instant
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <Timer className="size-3" />
                Web 20s
              </span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              <span className="sm:hidden">Channel pushes are instant. The web refreshes every 20s.</span>
              <span className="hidden sm:inline">
                Every signal reaches the channel the second the model publishes
                it. This page refreshes on a 20-second cycle, so the web view
                can trail slightly behind. For the fastest delivery, follow us
                on Telegram.
              </span>
            </p>
          </div>
        </div>

        <div className="shrink-0 sm:pl-2">
          <TelegramButton label="Open Telegram Channel" source="cta_strip" />
        </div>
      </div>
    </aside>
  );
}
