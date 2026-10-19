/**
 * Environment variable access layer.
 *
 * Lazy getters so `next build` never crashes on missing env; production
 * correctness is enforced at runtime by `assertProductionEnv()` which runs
 * in instrumentation (server boot), never at import time.
 */

import { parseBlockedCountries } from "@/lib/geoip/geo";

function readSecretList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  get webhookSecrets(): string[] {
    return readSecretList(process.env.WEBHOOK_SECRETS);
  },
  get webhookTimestampTolerance(): number {
    const n = Number(process.env.WEBHOOK_TIMESTAMP_TOLERANCE ?? 300);
    return Number.isFinite(n) && n > 0 && n <= 3600 ? n : 300;
  },
  get vapid(): { publicKey: string; privateKey: string; subject: string } | null {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return null;
    return {
      publicKey,
      privateKey,
      subject: process.env.VAPID_SUBJECT || "mailto:admin@ethersignals.example",
    };
  },
  get trustProxy(): boolean {
    return process.env.TRUST_PROXY !== "false";
  },
  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },
  // ── region blocking (GeoLite2) ─────────────────────────────────────────
  /** Kill switch: GEOIP_BLOCK="false" serves everyone (incident escape hatch). */
  get geoipEnabled(): boolean {
    return process.env.GEOIP_BLOCK !== "false";
  },
  /** ISO country codes to block; empty/undefined falls back to ["CN"]. */
  get blockedCountries(): string[] {
    return parseBlockedCountries(process.env.GEOIP_BLOCKED_COUNTRIES);
  },
};

/** Hard requirements for serving production traffic. Called once at boot. */
export function assertProductionEnv(): string[] {
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push("DATABASE_URL is required");
  if (env.webhookSecrets.length === 0)
    problems.push(
      "WEBHOOK_SECRETS is required in production: the ingest endpoint refuses unsigned pushes",
    );
  return problems;
}
