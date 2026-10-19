/**
 * Region blocking: decision policy + the "not available in your region" UI.
 *
 * Pure functions only (no fs, no Next runtime) so the whole policy is
 * unit-testable; `src/proxy.ts` wires them onto the request stream.
 *
 * Block semantics are fail-open by design: an unknown country, a private or
 * unresolvable client address, or a missing/unreadable GeoLite2 database all
 * serve the site. Availability of the public feed outranks completeness of
 * the block; the health endpoint exposes whether the database is actually
 * loaded so an inert blocker is visible in monitoring.
 */

export const DEFAULT_BLOCKED_COUNTRIES = "CN";

/** ISO-3166 alpha-2 codes (uppercased). Empty/undefined → the default list. */
export function parseBlockedCountries(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
  return list.length > 0 ? list : [DEFAULT_BLOCKED_COUNTRIES];
}

/** `null` (unknown country) is deliberately NOT blocked — fail-open. */
export function isRegionBlocked(
  countryCode: string | null,
  blocked: string[],
): boolean {
  return countryCode !== null && blocked.includes(countryCode.toUpperCase());
}

/**
 * Paths that must always answer regardless of region:
 * - `/api/health`: uptime monitors and the Docker HEALTHCHECK;
 * - `/api/webhooks/*`: server-to-server signal ingest from the backend
 *   (Bearer-authenticated; it has no region of its own worth trusting).
 */
export function isGeoExemptPath(pathname: string): boolean {
  if (pathname === "/api/health") return true;
  return pathname === "/api/webhooks" || pathname.startsWith("/api/webhooks/");
}

/** API consumers get a machine-readable 403; browsers get the block page. */
export function wantsJson(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/**
 * Addresses the GeoLite2 lookup must never see: loopback/RFC1918/CGNAT and
 * IPv6 ULA/link-local are our own proxies or local tooling, not visitors.
 * Unknown ("unknown" from the resolver) is filtered by the caller.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1] ?? ip;
  const octets = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (octets) {
    const [a, b] = [Number(octets[1]), Number(octets[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  return /^(f[cd]|fe[89ab])/.test(v6);
}

/** Minimal HTML escaping — the region code comes from our own database. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * The blocked-visitor page. Fully self-contained: inline CSS + inline SVG,
 * zero external requests (it must render even with hostile networking),
 * dark theme matching the site, bilingual zh/en.
 */
export function renderBlockedPage(countryCode: string): string {
  const cc = esc(countryCode.toUpperCase());
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="robots" content="noindex,nofollow"/>
<title>当前地区暂不可用 · Not available in your region — EtherSignals</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
      "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #050a14; color: #e8eefb; min-height: 100dvh;
    display: flex; align-items: center; justify-content: center;
    padding: 24px; -webkit-font-smoothing: antialiased;
  }
  .card {
    max-width: 520px; width: 100%; text-align: center;
    border: 1px solid rgba(232,238,251,.1); border-radius: 16px;
    background: rgba(232,238,251,.03); padding: 48px 32px 40px;
  }
  .shield { width: 52px; height: 52px; margin: 0 auto 22px; display: block; color: #8aa0c4; }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: .02em; margin-bottom: 10px; }
  .en { font-size: 14px; line-height: 1.6; color: rgba(232,238,251,.6); margin-bottom: 28px; }
  .region { font-size: 12px; color: rgba(232,238,251,.45); margin-bottom: 30px; }
  .region code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: rgba(232,238,251,.08); border: 1px solid rgba(232,238,251,.1);
    border-radius: 6px; padding: 2px 8px; color: #e8eefb; margin-left: 6px;
  }
  .rule { height: 1px; background: rgba(232,238,251,.08); margin-bottom: 22px; }
  .brand {
    font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
    color: rgba(232,238,251,.35);
  }
</style>
</head>
<body>
<main class="card">
  <svg class="shield" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
    <line x1="12" x2="12" y1="8" y2="12"/>
    <line x1="12" x2="12.01" y1="16" y2="16"/>
  </svg>
  <h1>本站点在您所在的地区暂不可用</h1>
  <p class="en">This site is not available in your region.</p>
  <p class="region">检测地区 / Detected region <code>${cc}</code></p>
  <div class="rule"></div>
  <div class="brand">EtherSignals</div>
</main>
</body>
</html>`;
}

export function regionBlockedResponse(
  countryCode: string,
  pathname: string,
): Response {
  const commonHeaders: Record<string, string> = {
    // Per-IP decision — a shared cache must never serve it to another visitor.
    "Cache-Control": "no-store, private",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Region-Blocked": countryCode.toUpperCase(),
  };
  if (wantsJson(pathname)) {
    return Response.json(
      { error: { code: "region_blocked", region: countryCode.toUpperCase() } },
      { status: 403, headers: commonHeaders },
    );
  }
  return new Response(renderBlockedPage(countryCode), {
    status: 403,
    headers: { ...commonHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}
