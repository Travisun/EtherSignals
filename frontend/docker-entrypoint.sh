#!/bin/sh
set -e

# Migrations are applied at image build time (Dockerfile → prisma migrate
# deploy, idempotent). Schema changes always ship with a new image, so boot
# stays fast and dependency-free.

# GeoLite2-Country database for region blocking: download when missing or
# stale (the mounted volume keeps it across restarts). Failure is non-fatal —
# the site serves fail-open with blocking inactive until a database lands.
if [ "${GEOIP_BLOCK:-true}" != "false" ] && [ -f /app/scripts/geoip-download.mjs ]; then
  node /app/scripts/geoip-download.mjs || \
    echo "[entrypoint] geoip download failed — starting anyway (region blocking inactive)"
fi

exec "$@"
