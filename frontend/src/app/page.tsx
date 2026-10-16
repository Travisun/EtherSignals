import { SignalFeed } from "@/components/signals/signal-feed";
import { TelegramCTA } from "@/components/telegram/telegram-cta";
import { getFeed, getFeedStats } from "@/lib/signals/dto";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Initial render reads PostgreSQL directly (no API round-trip, no rate-limit
  // cost); the client feed then takes over with its 20s polling cycle.
  const [{ signals }, stats] = await Promise.all([getFeed({ limit: 100 }), getFeedStats()]);

  return (
    <div className="space-y-6">
      <section className="hidden max-w-2xl md:block">
        <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="live-dot" aria-hidden={true} />
          AI trend model · live
        </p>
        <h1 className="mt-3 text-[26px] font-bold leading-8 tracking-tight sm:text-2xl">
          Ethereum trends, read by AI across five timeframes at once
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <span className="md:hidden">
            The AI model watches ETH from 2m to 1d and publishes every trend
            shift here within seconds. Free to follow, no account needed.
          </span>
          <span className="hidden md:inline">
            Our real-time feedback model watches ETH from the 2-minute chart
            all the way to the daily. The moment a trend changes on any
            timeframe, it gets scored, framed against key levels and published
            here within seconds, the same signal our Telegram channel
            receives. Free to follow, no account needed.
          </span>
        </p>
      </section>

      <div className="hidden md:block">
        <TelegramCTA />
      </div>

      <SignalFeed initialSignals={signals} initialStats={stats} />
    </div>
  );
}
