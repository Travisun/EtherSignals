import { env } from "@/lib/env";
import { ERR, jsonOk } from "@/lib/api/respond";
import { checkIpRateLimit, clientIpFromHeaders } from "@/lib/security/ip";
import { RateLimitError } from "@/lib/security/rate-limit";
import { CHART_TFS, fetchCandles, getCached } from "@/lib/market-cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/candles — public ETHUSDT candles for the chart page.
 *
 * Two protection layers so browser fleets never reach the exchange:
 *  1. per-IP: 1 request / 10s (sliding window, same infra as webhook ingest)
 *  2. process-wide 10s memory cache with single-flight: all IPs share one
 *     upstream Bitget fetch per window
 */
export async function GET(request: Request) {
  const ip = clientIpFromHeaders(request.headers, env.trustProxy);
  try {
    checkIpRateLimit("marketCandles", ip);
  } catch (err) {
    if (err instanceof RateLimitError) return ERR.rateLimited(err.retryAfterSec);
    throw err;
  }

  const url = new URL(request.url);
  const tf = url.searchParams.get("tf") ?? "5m";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 300) || 300, 50), 500);
  if (!CHART_TFS.includes(tf)) {
    return ERR.badRequest(`unsupported tf (expected one of ${CHART_TFS.join(", ")})`);
  }

  try {
    const candles = await getCached(`candles:${tf}:${limit}`, () => fetchCandles(tf, limit));
    return jsonOk({ candles, tf, serverTime: new Date().toISOString() });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("unsupported")) {
      return ERR.badRequest(err.message);
    }
    console.error("[api/market/candles] failed", err);
    return ERR.server();
  }
}
