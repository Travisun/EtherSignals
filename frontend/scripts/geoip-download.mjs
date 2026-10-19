#!/usr/bin/env node
/**
 * GeoLite2-Country bootstrap/updater — zero-dependency, Node >= 22.
 *
 * Sources (first match wins):
 *   1. GEOIP_MMDB_URL      — direct download of a raw .mmdb file (mirror or
 *                            pre-provisioned bucket; skips the MaxMind API)
 *   2. GEOIP_ACCOUNT_ID +
 *      GEOIP_LICENSE_KEY   — official MaxMind download API (GeoLite2 is free,
 *                            sign up: https://www.maxmind.com/en/geolite2/signup)
 *
 * Writes <target>.mmdb atomically (temp dir next to the target, then rename).
 * Skips when the existing file is younger than GEOIP_REFRESH_DAYS (default 4)
 * unless --force is passed. Validation: size floor + MaxMind metadata marker.
 *
 * Behind a proxy: Node's fetch honours HTTP(S)_PROXY only with
 * NODE_USE_ENV_PROXY=1 (Node 24+).
 *
 * Exit codes: 0 ok / skipped, 1 misconfigured, 2 download/extract/validate
 * failed. Callers that must not fail the boot (docker-entrypoint.sh) treat
 * any failure as "geo-block stays inactive until the database lands".
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORCE = process.argv.includes("--force");
const REFRESH_DAYS = Number(process.env.GEOIP_REFRESH_DAYS || 4);
const TARGET =
  process.env.GEOIP_MMDB_PATH ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "geoip", "GeoLite2-Country.mmdb");
const DOWNLOAD_URL = "https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz";
/** GeoLite2-Country is ~6 MB compressed; anything smaller is a broken body. */
const MIN_MMDB_BYTES = 400_000;

function log(msg) {
  console.log(`[geoip-download] ${msg}`);
}

function fail(msg, code) {
  console.error(`[geoip-download] ERROR: ${msg}`);
  process.exit(code);
}

function ageDays(file) {
  try {
    return (Date.now() - fs.statSync(file).mtimeMs) / 86_400_000;
  } catch {
    return Infinity;
  }
}

/** MMDB files carry `\xAB\xCD\xEFMaxMind.com` in the trailing metadata. */
async function looksLikeMmdb(buf) {
  if (buf.length < MIN_MMDB_BYTES) return false;
  const tail = buf.subarray(Math.max(0, buf.length - 131_072));
  return tail.includes("MaxMind.com");
}

async function fetchToBuffer(url, headers = {}) {
  const res = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function extractFirstMmdb(tarGz, workDir) {
  fs.writeFileSync(path.join(workDir, "db.tar.gz"), tarGz);
  execFileSync("tar", ["-xzf", "db.tar.gz"], { cwd: workDir, stdio: "pipe" });
  const found = fs
    .readdirSync(workDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".mmdb"))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
  if (found.length === 0) throw new Error("archive contains no .mmdb file");
  return fs.readFileSync(found[0]);
}

async function main() {
  if (!FORCE && ageDays(TARGET) < REFRESH_DAYS) {
    log(`fresh copy at ${TARGET} (< ${REFRESH_DAYS}d) — skipping`);
    return;
  }

  let mmdb;
  if (process.env.GEOIP_MMDB_URL) {
    log(`downloading raw database from GEOIP_MMDB_URL…`);
    mmdb = await fetchToBuffer(process.env.GEOIP_MMDB_URL);
  } else if (process.env.GEOIP_ACCOUNT_ID && process.env.GEOIP_LICENSE_KEY) {
    const auth = Buffer.from(
      `${process.env.GEOIP_ACCOUNT_ID}:${process.env.GEOIP_LICENSE_KEY}`,
    ).toString("base64");
    log("downloading GeoLite2-Country from download.maxmind.com…");
    const tarGz = await fetchToBuffer(DOWNLOAD_URL, { Authorization: `Basic ${auth}` });
    const workDir = fs.mkdtempSync(path.join(path.dirname(TARGET), ".geoip-"));
    try {
      mmdb = extractFirstMmdb(tarGz, workDir);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  } else {
    fail(
      "no source configured — set GEOIP_ACCOUNT_ID + GEOIP_LICENSE_KEY " +
        "(free MaxMind GeoLite2 account) or GEOIP_MMDB_URL",
      1,
    );
  }

  if (!(await looksLikeMmdb(mmdb))) {
    fail(`downloaded payload failed validation (size=${mmdb.length})`, 2);
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  const tmp = `${TARGET}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, mmdb);
  fs.renameSync(tmp, TARGET);
  log(`wrote ${TARGET} (${(mmdb.length / 1_000_000).toFixed(1)} MB)`);
}

main().catch((err) => fail(err?.message ?? String(err), 2));
