import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/health, the container/Docker HEALTHCHECK probe. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok" },
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
