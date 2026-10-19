import { describe, expect, it } from "vitest";
import {
  DEFAULT_BLOCKED_COUNTRIES,
  isGeoExemptPath,
  isPrivateAddress,
  isRegionBlocked,
  parseBlockedCountries,
  regionBlockedResponse,
  renderBlockedPage,
  wantsJson,
} from "@/lib/geoip/geo";

describe("parseBlockedCountries", () => {
  it("defaults to CN when unset or empty", () => {
    expect(parseBlockedCountries(undefined)).toEqual([
      DEFAULT_BLOCKED_COUNTRIES,
    ]);
    expect(parseBlockedCountries("")).toEqual([DEFAULT_BLOCKED_COUNTRIES]);
    expect(parseBlockedCountries(" , ")).toEqual([DEFAULT_BLOCKED_COUNTRIES]);
  });

  it("parses comma/space separated codes, uppercased and validated", () => {
    expect(parseBlockedCountries("cn, hk tw")).toEqual(["CN", "HK", "TW"]);
    expect(parseBlockedCountries("us")).toEqual(["US"]);
  });

  it("drops junk tokens and falls back to the default when nothing valid remains", () => {
    expect(parseBlockedCountries("china, C, ABC, 12")).toEqual([
      DEFAULT_BLOCKED_COUNTRIES,
    ]);
  });
});

describe("isRegionBlocked", () => {
  const blocked = ["CN"];

  it("never blocks an unknown country (fail-open)", () => {
    expect(isRegionBlocked(null, blocked)).toBe(false);
  });

  it("matches case-insensitively and ignores non-listed countries", () => {
    expect(isRegionBlocked("CN", blocked)).toBe(true);
    expect(isRegionBlocked("cn", blocked)).toBe(true);
    expect(isRegionBlocked("HK", blocked)).toBe(false);
    expect(isRegionBlocked("US", blocked)).toBe(false);
  });
});

describe("isGeoExemptPath", () => {
  it("exempts health probes and webhook ingest only", () => {
    expect(isGeoExemptPath("/api/health")).toBe(true);
    expect(isGeoExemptPath("/api/webhooks/signals")).toBe(true);
    expect(isGeoExemptPath("/api/webhooks")).toBe(true);
    expect(isGeoExemptPath("/api/signals")).toBe(false);
    expect(isGeoExemptPath("/")).toBe(false);
    expect(isGeoExemptPath("/chart")).toBe(false);
  });

  it("does not treat webhook-prefix lookalikes as exempt", () => {
    expect(isGeoExemptPath("/api/webhooksfoo")).toBe(false);
    expect(isGeoExemptPath("/api/healthz")).toBe(false);
  });
});

describe("wantsJson", () => {
  it("sends API consumers JSON, browsers the HTML page", () => {
    expect(wantsJson("/api/signals")).toBe(true);
    expect(wantsJson("/api/market/candles")).toBe(true);
    expect(wantsJson("/")).toBe(false);
    expect(wantsJson("/chart")).toBe(false);
  });
});

describe("isPrivateAddress", () => {
  it("recognizes RFC1918/loopback/CGNAT/link-local IPv4", () => {
    for (const ip of [
      "10.1.2.3",
      "127.0.0.1",
      "0.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.10.10",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("keeps public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.2.4.8", "172.32.0.1", "100.128.0.1", "9.9.9.9"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("recognizes loopback/ULA/link-local IPv6 and unwraps v4-mapped forms", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:192.168.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});

describe("renderBlockedPage", () => {
  const html = renderBlockedPage("cn");

  it("is bilingual, names the detected region and is noindex", () => {
    expect(html).toContain("本站点在您所在的地区暂不可用");
    expect(html).toContain("This site is not available in your region.");
    expect(html).toContain("CN</code>");
    expect(html).toContain("noindex");
  });

  it("is fully self-contained — no external requests", () => {
    // The SVG xmlns is a namespace identifier, never fetched — exempt it.
    const withoutXmlns = html.replace(' xmlns="http://www.w3.org/2000/svg"', "");
    expect(withoutXmlns).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\s(src|href)=/);
    expect(html).not.toMatch(/url\(/);
  });

  it("escapes the region code", () => {
    expect(renderBlockedPage("<script>")).toContain("&lt;SCRIPT&gt;");
  });
});

describe("regionBlockedResponse", () => {
  it("serves browsers a 403 HTML page with no-store headers", () => {
    const res = regionBlockedResponse("CN", "/");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-region-blocked")).toBe("CN");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("serves API consumers a machine-readable JSON error", async () => {
    const res = regionBlockedResponse("CN", "/api/signals");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as {
      error: { code: string; region: string };
    };
    expect(body.error.code).toBe("region_blocked");
    expect(body.error.region).toBe("CN");
  });
});
