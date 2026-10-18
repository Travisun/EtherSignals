/** Static site identity & external links (single source of truth). */

export const site = {
  name: "EtherSignals",
  shortName: "EtherSignals",
  tagline: "AI-powered Ethereum trend signals",
  description:
    "Live Ethereum trend signals from an AI real-time feedback model. Five timeframes, one clear picture: every regime shift is analyzed, scored and published within seconds. Follow free on the web or Telegram. A research and education project, never financial advice.",
  // Overridable at build time for self-hosted deployments.
  telegramUrl:
    process.env.NEXT_PUBLIC_TELEGRAM_URL || "https://t.me/EtherSignals",
} as const;

export const REFRESH_INTERVAL_MS = 4_000;
export const FEED_LIMIT = 100;
