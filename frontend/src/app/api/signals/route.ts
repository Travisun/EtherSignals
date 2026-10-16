import { env } from "@/lib/env";
import { ERR, jsonOk } from "@/lib/api/respond";
import { checkIpRateLimit, clientIpFromHeaders } from "@/lib/security/ip";
import { RateLimitError } from "@/lib/security/rate-limit";
import { getFeed, getFeedStats } from "@/lib/signals/dto";

export const dynamic = "force-dynamic";

/**
 * GET /api/signals: public feed.
 * Rate limit: 4 requests / minute / IP (the page polls every 20s = 3/min).
 * `sinceId` narrows the payload to strictly-newer signals.
 */
export async function GET(request: Request) {
  const ip = clientIpFromHeaders(request.headers, env.trustProxy);
  try {
    checkIpRateLimit("signalsApi", ip);
  } catch (err) {
    if (err instanceof RateLimitError) return ERR.rateLimited(err.retryAfterSec);
    throw err;
  }

  try {
    const url = new URL(request.url);
    const sinceId = url.searchParams.get("sinceId");
    const limit = url.searchParams.get("limit");

    const feed = await getFeed({ limit, sinceId });

    // Cursor polls that return nothing new skip the stats queries entirely,
    // the client keeps its previous stats, so idle 20s cycles are near-free.
    const stats =
      !sinceId || feed.signals.length > 0 ? await getFeedStats() : null;

    return jsonOk({ signals: feed.signals, stats, hasMore: feed.hasMore });
  } catch (err) {
    console.error("[api/signals] failed", err);
    return ERR.server();
  }
}
