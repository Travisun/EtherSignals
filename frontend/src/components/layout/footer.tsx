import { Send } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { TrackedLink } from "@/components/analytics/tracked-link";
import { fetchRepoMeta, formatStars } from "@/lib/github";
import { site } from "@/lib/site";

export async function Footer() {
  const repo = await fetchRepoMeta();
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card/40 pb-16 md:pb-0">
      <div className="grid grid-cols-2 gap-6 px-4 py-8 sm:grid-cols-[1.4fr_1fr_1fr] sm:gap-8 sm:px-6 sm:py-10 xl:px-8">
        <div className="col-span-2 space-y-3 sm:col-span-1">
          <div className="flex items-center gap-2">
            <Logo size={26} />
            <span className="text-sm font-bold tracking-tight">
              Ether<span className="text-primary">Signals</span>
            </span>
          </div>
          <p className="hidden max-w-md text-xs leading-relaxed text-muted-foreground sm:block">
            Independent AI signal research for Ethereum markets. Every signal
            is the latest output of an automated real-time feedback model,
            published for study and reference. It is never a trading
            recommendation.
          </p>
          <TrackedLink
            href={site.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            event="telegram.click"
            data={{ source: "footer" }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Send className="size-3.5" />
            Get signals on Telegram
          </TrackedLink>
        </div>

        <nav aria-label="Legal" className="space-y-2 text-xs">
          <p className="font-semibold uppercase tracking-wider text-foreground">Legal</p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li><TrackedLink className="hover:text-foreground" href="/privacy" event="footer.privacy">Privacy Policy</TrackedLink></li>
            <li><TrackedLink className="hover:text-foreground" href="/terms" event="footer.terms">Terms of Service</TrackedLink></li>
            <li><TrackedLink className="hover:text-foreground" href="/disclaimer" event="footer.disclaimer">Disclaimer</TrackedLink></li>
          </ul>
        </nav>

        <nav aria-label="Resources" className="space-y-2 text-xs">
          <p className="font-semibold uppercase tracking-wider text-foreground">Resources</p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li><TrackedLink className="hover:text-foreground" href="/guide" event="footer.guide">How to read a report</TrackedLink></li>
            <li><TrackedLink className="hover:text-foreground" href="/api/signals" event="footer.api">Feed API</TrackedLink></li>
            <li><TrackedLink className="hover:text-foreground" href="/api/health" event="footer.status">Status</TrackedLink></li>
            <li>
              <TrackedLink
                className="hover:text-foreground"
                href={site.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                event="telegram.click"
                data={{ source: "footer_resources" }}
              >
                Telegram
              </TrackedLink>
            </li>
            <li>
              <TrackedLink
                className="inline-flex items-center gap-1.5 hover:text-foreground"
                href={repo.url}
                target="_blank"
                rel="noopener noreferrer"
                event="github.click"
                data={{ source: "footer" }}
              >
                GitHub
                {repo.stars !== null ? (
                  <span className="tnum inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                    ★ {formatStars(repo.stars)}
                  </span>
                ) : null}
              </TrackedLink>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="container-page flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
            <p>© {year} EtherSignals · Built for research, run with care.</p>
            <p className="font-medium text-warning">
              Not financial advice. Trading involves substantial risk of loss.
            </p>
          </div>
          <TrackedLink
            href="https://www.producthunt.com/products/ether-signals?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-ether-signals"
            target="_blank"
            rel="noopener noreferrer"
            event="producthunt.click"
            data={{ source: "footer_badge" }}
            className="shrink-0"
            aria-label="Ether Signals on Product Hunt"
          >
            <img
              src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1286330&theme=dark&t=1792482262855"
              alt="Ether Signals - AI based real-time crypto trend signals, graded in public | Product Hunt"
              width={250}
              height={54}
              loading="lazy"
            />
          </TrackedLink>
        </div>
      </div>
    </footer>
  );
}
