import type { Metadata } from "next";
import { BookOpen, Info, TriangleAlert } from "lucide-react";
import { site } from "@/lib/site";
import { REGIME_LABELS } from "@/lib/constants";
import { regimeMeta } from "@/components/signals/regime";
import { cn } from "@/lib/utils";
import { TrackedLink } from "@/components/analytics/tracked-link";

export const metadata: Metadata = {
  title: "How to read a signal report",
  description:
    "A field guide to every number in an EtherSignals report: trend regimes, model scores, continuation probability (Win%), patterns and key levels, all explained honestly.",
};

function Callout({
  kind = "info",
  title,
  children,
}: {
  kind?: "info" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  const isWarn = kind === "warn";
  return (
    <div
      className={cn(
        "my-4 rounded-lg border p-4 text-sm",
        isWarn
          ? "border-warning/40 bg-warning/8"
          : "border-primary/30 bg-primary/6",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 font-semibold",
          isWarn ? "text-warning" : "text-primary",
        )}
      >
        {isWarn ? <TriangleAlert className="size-4" /> : <Info className="size-4" />}
        {title}
      </p>
      <div className="mt-1.5 space-y-1.5 leading-relaxed text-muted-foreground [&_strong]:text-foreground">
        {children}
      </div>
    </div>
  );
}

function Marker({ n }: { n: number }) {
  return (
    <span className="tnum inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
      {n}
    </span>
  );
}

const REPORT_LINES: { marker: number; text: string }[] = [
  { marker: 1, text: "[ETHUSDT] 5m regime update · price 2,440.54" },
  { marker: 2, text: "▼ Strong Down  (score −0.510)" },
  { marker: 3, text: "2m −0.40  ·  5m −0.51  ·  30m −0.30  ·  2h +0.10  ·  1d +0.25" },
  { marker: 4, text: "Continuation (Win%): 58%" },
  { marker: 5, text: "Patterns on close: MACD death cross 52%" },
  { marker: 6, text: "R 2,489.7 (+2.0%) · PP 2,402.3 · S 2,405.7" },
  { marker: 6, text: "20d range 2,405.7 – 2,778.0 · BREAKOUT: inside" },
];

const REGIME_TIERS = [
  { regime: "strong_up", icon: "↑↑", rule: "score ≥ +0.42 and ADX ≥ 20" },
  { regime: "up", icon: "↑", rule: "score ≥ +0.16" },
  { regime: "neutral", icon: "→", rule: "score between −0.16 and +0.16" },
  { regime: "down", icon: "↓", rule: "score ≤ −0.16" },
  { regime: "strong_down", icon: "↓↓", rule: "score ≤ −0.42 and ADX ≥ 20" },
];

const INDICATORS = [
  { name: "EMA stack", weight: "1.4", looks: "Price vs EMA20/50/200 alignment" },
  { name: "ADX / DMI", weight: "1.4", looks: "Trend direction × strength (weak trends barely vote)" },
  { name: "MACD", weight: "1.2", looks: "Histogram momentum, ATR-normalised" },
  { name: "SuperTrend", weight: "1.2", looks: "SuperTrend(10,3) direction, full vote on fresh flips" },
  { name: "LinReg drift", weight: "1.1", looks: "20-bar least-squares slope" },
  { name: "Volume flow", weight: "0.8", looks: "Buy vs sell volume over the last 10 bars" },
  { name: "RSI", weight: "0.7", looks: "Momentum position, capped when overbought/oversold" },
  { name: "Bollinger %B", weight: "0.6", looks: "Position within the bands, discounted outside them" },
  { name: "KDJ", weight: "0.6", looks: "Stochastic K−D cross" },
];

const PATTERNS = [
  { key: "ema_align_bull", label: "EMA bullish alignment", trigger: "EMA20 > EMA50 > EMA200", dir: "Bullish" },
  { key: "ema_align_bear", label: "EMA bearish alignment", trigger: "EMA20 < EMA50 < EMA200", dir: "Bearish" },
  { key: "macd_golden", label: "MACD golden cross", trigger: "Histogram crosses above zero", dir: "Bullish" },
  { key: "macd_dead", label: "MACD death cross", trigger: "Histogram crosses below zero", dir: "Bearish" },
  { key: "st_flip_bull", label: "SuperTrend flips bullish", trigger: "SuperTrend flips to long", dir: "Bullish" },
  { key: "st_flip_bear", label: "SuperTrend flips bearish", trigger: "SuperTrend flips to short", dir: "Bearish" },
  { key: "rsi_recovery", label: "RSI recovery", trigger: "Previous bar < 30, current ≥ 30", dir: "Bullish" },
  { key: "rsi_fade", label: "RSI fading", trigger: "Previous bar > 70, current ≤ 70", dir: "Bearish" },
  { key: "donchian_break_up", label: "Donchian breakout", trigger: "Close > highest of prior 20 bars", dir: "Bullish" },
  { key: "donchian_break_down", label: "Donchian breakdown", trigger: "Close < lowest of prior 20 bars", dir: "Bearish" },
  { key: "bb_squeeze", label: "Bollinger squeeze", trigger: "Bandwidth in lowest 15% of last 120 bars", dir: "Neutral (bets on expansion, not direction)" },
];

export default function GuidePage() {
  return (
    <article className="legal mx-auto max-w-3xl pb-12">
      <header className="mb-8 border-b border-border pb-6">
        <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <BookOpen className="size-4" />
          Field guide
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          How to read a signal report
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Every EtherSignals report, whether on Telegram, in the live feed or as a
          desktop alert, is the output of the same AI trend model. This guide
          explains where each number comes from and, more importantly, how to
          read it honestly. Five minutes here will save you from the most
          common misreadings.
        </p>
      </header>

      <nav aria-label="Contents" className="mb-10 rounded-lg border border-border bg-card p-4 text-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contents</p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {[
            ["#anatomy", "1. Anatomy of a report"],
            ["#regimes", "2. Trend regimes"],
            ["#score", "3. The model score"],
            ["#winrate", "4. Win%, read it right"],
            ["#patterns", "5. Patterns"],
            ["#levels", "6. Key levels"],
            ["#learning", "7. How the model improves"],
            ["#feed", "8. Reading this site's feed"],
            ["#limits", "9. Honest limitations"],
          ].map(([href, label]) => (
            <li key={href}>
              <TrackedLink
                href={href}
                event="guide.toc"
                data={{ anchor: href.replace("#", "") }}
                className="text-primary hover:underline"
              >
                {label}
              </TrackedLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* 1. Anatomy */}
      <section>
        <h2 id="anatomy">1. Anatomy of a report</h2>
        <p>
          A report is a full snapshot of the model&apos;s view right now, so you
          never need earlier reports to interpret it. A typical Telegram push
          looks like this (illustrative values):
        </p>
        <div className="my-4 overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Telegram push · illustrative</span>
            <span>@ethersignals</span>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed">
            {REPORT_LINES.map((line) => (
              <span key={line.marker + line.text} className="flex items-start gap-2.5 py-0.5">
                <Marker n={line.marker} />
                <span>{line.text}</span>
              </span>
            ))}
          </pre>
        </div>
        <ol className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <li className="flex gap-2.5"><Marker n={1} /><span><strong className="text-foreground">Header</strong>: market (here ETHUSDT), the timeframe that triggered this report, and the current price.</span></li>
          <li className="flex gap-2.5"><Marker n={2} /><span><strong className="text-foreground">Signal line</strong>: the trend regime on the triggering timeframe, with its composite score. This is the headline.</span></li>
          <li className="flex gap-2.5"><Marker n={3} /><span><strong className="text-foreground">Five-timeframe board</strong>: the regime score on every tracked timeframe (2m, 5m, 30m, 2h, 1d). This is where confluence shows.</span></li>
          <li className="flex gap-2.5"><Marker n={4} /><span><strong className="text-foreground">Win%</strong>: how often this exact state continued historically. It is the most misread number in the report (see §4).</span></li>
          <li className="flex gap-2.5"><Marker n={5} /><span><strong className="text-foreground">Patterns</strong>: events that fired on the candle that just closed, each with its own hit-rate.</span></li>
          <li className="flex gap-2.5"><Marker n={6} /><span><strong className="text-foreground">Key levels</strong>: objective price levels, namely the pivot set and the 20-day Donchian range, plus whether price has broken out.</span></li>
        </ol>
      </section>

      {/* 2. Regimes */}
      <section>
        <h2 id="regimes">2. Trend regimes</h2>
        <p>
          The model classifies every timeframe into one of five regimes using
          the composite score (§3) plus a trend-strength gate (ADX):
        </p>
        <table>
          <thead>
            <tr>
              <th>Regime</th>
              <th>Icon</th>
              <th>Condition</th>
            </tr>
          </thead>
          <tbody>
            {REGIME_TIERS.map((tier) => (
              <tr key={tier.regime}>
                <td>
                  <span
                    className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold",
                      regimeMeta(tier.regime).badge,
                    )}
                  >
                    {tier.icon} {REGIME_LABELS[tier.regime]}
                  </span>
                </td>
                <td className="tnum">{tier.icon}</td>
                <td className="tnum">{tier.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          You will notice that regimes never flip-flicker, and that is by design. Two
          dampers keep signals calm:
        </p>
        <ul>
          <li><strong className="text-foreground">Hysteresis band.</strong> Once a trend is established, it takes a <em>narrower</em> score move (past ±0.08 rather than ±0.16) to drop back to Range, so trends survive minor pullbacks.</li>
          <li><strong className="text-foreground">Confirmation candles.</strong> On the 2m and 5m charts a new regime must hold for <strong className="text-foreground">two consecutive closed candles</strong> before it is confirmed (30m/2h/1d confirm on one).</li>
        </ul>
        <Callout kind="info" title="Closed candles only">
          All analysis runs on candles that have <strong>finished printing</strong>.
          The forming candle never influences a signal, so reports never repaint.
        </Callout>
      </section>

      {/* 3. Score */}
      <section>
        <h2 id="score">3. The model score</h2>
        <p>
          The score is a weighted average of nine indicator &quot;votes&quot;,
          each ranging from −1 (bearish) to +1 (bullish):
        </p>
        <pre className="tnum my-3 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs">
          score = Σ(weight × vote) / Σ(weight)   ∈ [−1, +1]
        </pre>
        <table>
          <thead>
            <tr>
              <th>Indicator</th>
              <th>Weight</th>
              <th>What it looks at</th>
            </tr>
          </thead>
          <tbody>
            {INDICATORS.map((ind) => (
              <tr key={ind.name}>
                <td className="font-medium">{ind.name}</td>
                <td className="tnum">{ind.weight}</td>
                <td>{ind.looks}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Read the <strong className="text-foreground">magnitude</strong>, not
          just the sign: |score| beyond ±0.4 marks conviction; values loitering
          near zero mean the timeframe genuinely has no edge right now. Weights
          are not fixed (see §7), and they are clamped so no single indicator
          can dominate.
        </p>
      </section>

      {/* 4. Win% */}
      <section>
        <h2 id="winrate">4. Win%, read it right</h2>
        <p>
          <strong className="text-foreground">Definition.</strong> The model
          replays roughly the last 300 closed candles. Each time the same
          regime appeared on this timeframe, it checked: did price actually
          move more than 0.5×ATR <em>in the regime&apos;s direction</em> within
          the next 3 candles? The decay-weighted share of hits (recent history
          counts more) is the Win%.
        </p>
        <Callout kind="warn" title="It is not a next-move probability">
          `1d ↓↓ Strong Down 36%` does <strong>not</strong> mean &quot;36%
          chance of falling tomorrow&quot;. It means: historically, when this
          exact state appeared, 36% of the time the decline continued past the
          threshold within 3 candles. It is a base rate for the state, not
          a forecast for the next bar.
        </Callout>
        <p>Three reading habits that keep you honest:</p>
        <ul>
          <li><strong className="text-foreground">Below 50% is normal.</strong> The denominator includes &quot;no directional move within 3 candles&quot; noise samples (~23%). In ranging markets every regime&apos;s Win% sinks together, which is the model honestly reporting that momentum has no edge.</li>
          <li><strong className="text-foreground">Compare longitudinally.</strong> Strong Down climbing from 25% → 45% tells you recent down-moves are following through more often. The trend of the number matters more than the level.</li>
          <li><strong className="text-foreground">Multi-timeframe confluence beats single rows.</strong> The 2m chart is close to noise by nature; the model&apos;s real value is Strong-tier filtering and alignment across 2m→1d.</li>
        </ul>
        <Callout kind="info" title="Why you sometimes see “n/a”">
          If a state has fewer than 15 historical samples, the model refuses to
          print a number and shows <strong>n/a</strong>. A missing figure is
          honesty, not a bug. The same rule applies to pattern probabilities.
        </Callout>
      </section>

      {/* 5. Patterns */}
      <section>
        <h2 id="patterns">5. Patterns</h2>
        <p>
          Patterns are events that fired on the candle that just closed; they
          appear and disappear as candles roll. Each carries its own historical
          hit-rate under the same 3-candle, 0.5×ATR rule.
        </p>
        <table>
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Trigger</th>
              <th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {PATTERNS.map((p) => (
              <tr key={p.key}>
                <td className="font-medium">{p.label}</td>
                <td>{p.trigger}</td>
                <td>{p.dir}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Callout kind="info" title="The squeeze is different">
          `bb_squeeze` is direction-neutral: it flags compressed volatility that
          tends to resolve in a large move (hit = any move beyond 1.2×ATR within
          3 candles). Treat it as &quot;get ready&quot;, not &quot;which way&quot;.
        </Callout>
      </section>

      {/* 6. Levels */}
      <section>
        <h2 id="levels">6. Key levels</h2>
        <p>
          Levels come from two objective, formula-based methods, and nothing is
          fitted or hand-picked:
        </p>
        <ul>
          <li><strong className="text-foreground">Classic pivots</strong>: computed from the previous <em>completed</em> trading day&apos;s High/Low/Close, <span className="tnum">PP = (H+L+C)/3</span>, with R1 to R3 and S1 to S3 derived from it. Best suited to intraday reference.</li>
          <li><strong className="text-foreground">Donchian-20</strong>: the highest high and lowest low of the last 20 <em>closed</em> daily candles. This is the key gate for day-level breakouts.</li>
        </ul>
        <p>How to read the block:</p>
        <ul>
          <li><strong className="text-foreground">Resistance / Support</strong>: the nearest merged level above or below the current price. The percentage in parentheses is the distance to it.</li>
          <li><strong className="text-foreground">BREAKOUT / BREAKDOWN</strong>: price has moved beyond the 20-day high or low (a daily-level breakout in progress). <strong className="text-foreground">inside</strong> means price is still within the range.</li>
        </ul>
        <Callout kind="info" title="Pro tip">
          Pivot levels and Donchian levels that coincide at the same price form
          the strongest confluence zones. And during the model&apos;s warm-up on
          a new market the levels block may be absent entirely, because daily history
          simply isn&apos;t long enough yet.
        </Callout>
      </section>

      {/* 7. Learning */}
      <section>
        <h2 id="learning">7. How the model improves itself</h2>
        <p>
          The nine indicator weights are not hand-tuned constants. Every trend
          call is later graded against what price actually did, and the weights
          learn from the outcomes at two speeds: a small online update per
          graded call, and a fuller replay-based adjustment every 15 minutes.
          It is a multiplicative &quot;expert&quot; scheme: indicators that
          were right get louder, wrong ones get quieter.
        </p>
        <p>Six guardrails keep the learning scientific rather than lucky:</p>
        <ul>
          <li><strong className="text-foreground">Shrinkage prior</strong>: after every update, weights are pulled a little back toward their baseline, so they can&apos;t drift into over-fitted corners.</li>
          <li><strong className="text-foreground">Hard clamps</strong>: every weight stays within [0.3, 2.2], so no indicator can monopolise the score.</li>
          <li><strong className="text-foreground">Normalisation</strong>: average weight returns to 1.0 each round, so scores stay comparable across months.</li>
          <li><strong className="text-foreground">Sample thresholds</strong>: batch updates need at least 120 decisive samples per indicator, otherwise they are skipped.</li>
          <li><strong className="text-foreground">Time decay</strong>: statistics weight recent history exponentially more (half-life about 250 candles).</li>
          <li><strong className="text-foreground">Version library with rollback</strong>: every weight change is archived as a version with its own live track record. If the current version underperforms a historical one decisively, the model rolls itself back automatically.</li>
        </ul>
      </section>

      {/* 8. Feed mapping */}
      <section>
        <h2 id="feed">8. Reading this site&apos;s feed</h2>
        <p>The live feed shows the same snapshot, structured. Field mapping:</p>
        <table>
          <thead>
            <tr>
              <th>On this site</th>
              <th>Report field</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Time</td><td className="tnum">ts</td><td>When the model published the snapshot (shown in your local time)</td></tr>
            <tr><td>Market</td><td className="tnum">symbol + marketType</td><td>Pair and venue type (Perp or Spot)</td></tr>
            <tr><td>Price</td><td className="tnum">price</td><td>Latest price at push time</td></tr>
            <tr><td>AI signal</td><td className="tnum">timeframe + regime + score</td><td>The triggering timeframe, its regime, and composite score</td></tr>
            <tr><td>2m → 1d board</td><td className="tnum">signals[]</td><td>All five timeframes&apos; scores; the ring marks the trigger</td></tr>
            <tr><td>Continuation</td><td className="tnum">prob</td><td>Win% from §4, shown as “n/a” when samples are thin</td></tr>
            <tr><td>Patterns</td><td className="tnum">patterns[]</td><td>Events on the last closed candle (§5)</td></tr>
            <tr><td>Key levels</td><td className="tnum">levels</td><td>Resistance / PP / Support / 20-day range / breakout (§6)</td></tr>
            <tr><td>As published on Telegram</td><td className="tnum">message</td><td>The exact channel text, verbatim</td></tr>
          </tbody>
        </table>
        <p>
          Open any row in the{" "}
          <TrackedLink href="/" event="guide.feed">
            live feed
          </TrackedLink>{" "}
          to see the full breakdown for that signal.
        </p>
      </section>

      {/* 9. Limitations */}
      <section>
        <h2 id="limits">9. Honest limitations</h2>
        <p>We&apos;d rather publish the caveats than hide them:</p>
        <ul>
          <li><strong className="text-foreground">Samples correlate.</strong> Consecutive candles are highly related, so treat a stated sample of 100 more like 30 when judging confidence.</li>
          <li><strong className="text-foreground">Fitted to one market.</strong> The model learns on ETHUSDT perpetuals; behaviour on other symbols is not calibrated.</li>
          <li><strong className="text-foreground">The 2m chart is noise-limited.</strong> Direction on ultra-short timeframes is near-random; the value there is Strong-tier filtering and multi-timeframe confluence.</li>
          <li><strong className="text-foreground">Win% is history, not destiny.</strong> Markets change distribution, which is exactly why the statistics decay over time.</li>
          <li><strong className="text-foreground">And the standing one:</strong> EtherSignals is a research and educational project. Nothing here is financial advice, and signals can be plainly wrong. Never trade on them.</li>
        </ul>
        <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
          Questions about a specific field? The{" "}
          <TrackedLink href="/" event="guide.feed">
            live feed
          </TrackedLink>{" "}
          exposes the same data via the public{" "}
          <TrackedLink href="/api/signals" event="guide.api">
            feed API
          </TrackedLink>
          , and the community discusses reports daily on{" "}
          <TrackedLink
            href={site.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            event="guide.telegram"
          >
            Telegram
          </TrackedLink>.
        </p>
      </section>
    </article>
  );
}
