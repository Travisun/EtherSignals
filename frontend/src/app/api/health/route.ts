import { db } from "@/lib/db";
import { geoipReady } from "@/lib/geoip/reader";

export const dynamic = "force-dynamic";

/** GET /api/health, the container/Docker HEALTHCHECK probe. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    // `geoip.loaded: false` means region blocking is inert (missing database)
    // — the site serves fail-open, monitoring should notice the discrepancy.
    return Response.json(
      { status: "ok", geoip: await geoipReady() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[health] db check failed", err);
    return Response.json(
      { status: "degraded" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
