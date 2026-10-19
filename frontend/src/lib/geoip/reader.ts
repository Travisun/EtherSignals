/**
 * GeoLite2-Country reader: lazy singleton with mtime-based hot reload.
 *
 * The .mmdb file is provisioned out-of-band (entrypoint download script or a
 * manually mounted volume) because MaxMind credentials never live in the
 * image. Behaviour when the file is missing/corrupt is fail-open: lookups
 * return null and the proxy serves everyone, with a single loud warning per
 * state change so an inert blocker is noticeable in logs.
 *
 * Reload: the file's mtime is re-stat'ed at most once a minute — dropping a
 * fresh database into `geoip/` swaps the reader without a restart.
 */
import { Reader, type ReaderModel } from "@maxmind/geoip2-node";
import { stat } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

const MTIME_CHECK_INTERVAL_MS = 60_000;
/** A failed open is retried on this cadence so a late-arriving database
 * (e.g. the entrypoint download finishing after boot) is picked up. */
const OPEN_RETRY_MS = 30_000;

export type GeoipStatus = {
  enabled: boolean;
  /** A database is open and answering lookups. */
  loaded: boolean;
  /** `true` once we've logged that the database is missing — for tests. */
  missing: boolean;
  path: string;
};

let reader: ReaderModel | null = null;
let opening: Promise<ReaderModel | null> | null = null;
let loadedMtimeMs = 0;
let lastStatAt = 0;
let lastAttemptAt = 0;
let warnedMissing = false;

export function mmdbPath(): string {
  return (
    process.env.GEOIP_MMDB_PATH ||
    path.join(process.cwd(), "geoip", "GeoLite2-Country.mmdb")
  );
}

/** Introspection for /api/health and tests. */
export function geoipStatus(): GeoipStatus {
  return {
    enabled: env.geoipEnabled,
    loaded: reader !== null,
    missing: warnedMissing,
    path: mmdbPath(),
  };
}

async function openReader(): Promise<ReaderModel | null> {
  const file = mmdbPath();
  try {
    // turbopackIgnore: the database is a runtime-provisioned volume, never a
    // build-time asset — output tracing must not try to include its path.
    const [info, opened] = await Promise.all([
      stat(/* turbopackIgnore: true */ file),
      Reader.open(file),
    ]);
    reader = opened;
    loadedMtimeMs = info.mtimeMs;
    if (warnedMissing) console.log(`[geoip] database now available: ${file}`);
    warnedMissing = false;
    return opened;
  } catch (err) {
    reader = null;
    if (!warnedMissing) {
      warnedMissing = true;
      // Fail-open: the site serves; only the block stays inactive.
      console.warn(
        `[geoip] database unavailable at ${file} — region blocking inactive` +
          ` (run scripts/geoip-download.mjs or set GEOIP_MMDB_PATH):`,
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

async function ensureReader(): Promise<ReaderModel | null> {
  if (reader) {
    const now = Date.now();
    if (now - lastStatAt > MTIME_CHECK_INTERVAL_MS) {
      lastStatAt = now;
      try {
        const info = await stat(/* turbopackIgnore: true */ mmdbPath());
        if (info.mtimeMs !== loadedMtimeMs) {
          console.log("[geoip] database changed on disk — reloading");
          opening = openReader();
        }
      } catch {
        // vanished between checks — keep serving with the open reader
      }
    }
    return reader;
  }
  if (!reader) {
    const now = Date.now();
    if (!opening || now - lastAttemptAt >= OPEN_RETRY_MS) {
      lastAttemptAt = now;
      opening = openReader();
    }
    return opening;
  }
  return reader;
}

/**
 * Eager variant for the health probe: actually opens the database so
 * `loaded` reflects reality instead of "nobody asked yet".
 */
export async function geoipReady(): Promise<GeoipStatus> {
  await ensureReader();
  return geoipStatus();
}

/**
 * ISO-3166 alpha-2 country code for `ip`, or null when unknown/missing DB.
 * Never throws — every failure mode collapses to null (fail-open).
 */
export async function lookupCountry(ip: string): Promise<string | null> {
  if (!env.geoipEnabled) return null;
  const db = await ensureReader();
  if (!db) return null;
  try {
    const res = await db.country(ip);
    return res.country?.isoCode ?? res.registeredCountry?.isoCode ?? null;
  } catch (err) {
    // AddressNotFoundError = IP not in DB (private/reserved ranges) — normal.
    if ((err as Error).name !== "AddressNotFoundError") {
      console.warn(
        `[geoip] lookup failed for ${ip}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}
