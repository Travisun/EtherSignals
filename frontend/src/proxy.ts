/**
 * Region gate (Next 16 proxy — the renamed middleware, Node.js runtime).
 *
 * Every incoming request is resolved to its real client address through the
 * production chain Client → Cloudflare → nginx → Next (`clientIpFromHeaders`,
 * same trust model as rate limiting: CF-Connecting-IP first, left-most XFF
 * when TRUST_PROXY). The address is checked against GeoLite2-Country and
 * blocked regions get the self-contained "not available in your region" page
 * (403) — or a JSON error for /api/* consumers.
 *
 * Fail-open everywhere: unknown/private addresses, a missing database or any
 * lookup error serve the request; exemptions keep health probes and the
 * backend webhook ingest region-independent. Docs: docs/GEO-BLOCK.md.
 */
import { NextResponse, type NextRequest } from "next/server";
import { clientIpFromHeaders } from "@/lib/security/ip";
import { env } from "@/lib/env";
import { lookupCountry } from "@/lib/geoip/reader";
import {
  isGeoExemptPath,
  isPrivateAddress,
  isRegionBlocked,
  regionBlockedResponse,
} from "@/lib/geoip/geo";

export const config = {
  // Hot path only: immutable build assets and image optimization never need
  // a region decision (a blocked browser never reaches them — its document
  // request 403s first). Exemptions for health/webhooks live in the handler
  // so the policy stays in tested code, not matcher regexes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function proxy(request: NextRequest): Promise<Response> {
  const { pathname } = request.nextUrl;
  try {
    if (isGeoExemptPath(pathname)) return NextResponse.next();
    if (!env.geoipEnabled) return NextResponse.next();

    const ip = clientIpFromHeaders(request.headers, env.trustProxy);
    if (ip === "unknown" || isPrivateAddress(ip)) return NextResponse.next();

    const country = await lookupCountry(ip);
    if (country && isRegionBlocked(country, env.blockedCountries)) {
      return regionBlockedResponse(country, pathname);
    }
    // Expose the resolved region upstream; set() overwrites anything a
    // client-supplied header may have claimed.
    if (country) {
      const headers = new Headers(request.headers);
      headers.set("x-es-region", country);
      return NextResponse.next({ request: { headers } });
    }
  } catch (err) {
    console.error(`[proxy] region check failed for ${pathname} — failing open`, err);
  }
  return NextResponse.next();
}
