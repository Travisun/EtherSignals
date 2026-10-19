#!/usr/bin/env bash
# Remote upgrade for the two production hosts. Idempotent; safe to re-run.
#
#   scripts/upgrade-remote.sh frontend [--dry-run]   → oracle-a1   (/opt/ethersignals)
#   scripts/upgrade-remote.sh backend  [--dry-run]   → opptrix-mail (/opt/ethersignals)
#
# What it does per host:
#   1. rsync the monorepo subtree over the deployed copy — runtime data
#      (`data/`), `.env`, node_modules, .next and .git are NEVER touched.
#   2. backend: keep a rollback image tag, then `docker compose build` +
#      `up -d`. No database to migrate (audit store degrades to JSON by design).
#      frontend: `docker compose -f docker-compose.prod.yml build` — Prisma
#      migrations apply INSIDE the build (idempotent, needs DATABASE_URL build
#      arg + host network, both wired in the compose file) — then `up -d`.
#   3. Health check (backend /api/engine via container health status,
#      frontend http://127.0.0.1:3021/api/health) and rollback hint.
#
# Both hosts are file-copy deployments (no git on the server): the rsync IS
# the code update. Run from the monorepo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"
DRY="${2:-}"

case "$TARGET" in
  frontend)
    HOST=oracle-a1
    REMOTE_DIR=/opt/ethersignals
    SRC="$ROOT/frontend"
    COMPOSE="docker-compose.prod.yml"
    SERVICE=app
    ;;
  backend)
    HOST=opptrix-mail
    REMOTE_DIR=/opt/ethersignals
    SRC="$ROOT/backend"
    COMPOSE="docker-compose.yml"
    SERVICE=ethersignals
    ;;
  *)
    echo "usage: $0 <frontend|backend> [--dry-run]" >&2
    exit 1
    ;;
esac

RSYNC_FLAGS=(-az --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude '.next/' \
  --exclude '.env' --exclude 'data/' --exclude '*.log' \
  --exclude '/geoip/' \
  --exclude 'docker-compose.yml' --exclude 'docker-compose.prod.yml' \
  --exclude 'docker-compose.override.yml')
# Compose files are HOST-OWNED environment config (ports, services, build args
# differ per deployment) — they are never overwritten by the repo default.
# Learned the hard way 2026-10-18: the repo's full-stack compose briefly
# replaced opptrix-mail's single-service file and its postgres tried to bind a
# busy host port. Server compose files are restorable from the deploy record.

echo "== $TARGET → $HOST:$REMOTE_DIR ${DRY:0:-0}"
if [ "$DRY" = "--dry-run" ]; then
  RSYNC_FLAGS+=(-n -v --stats)
  rsync "${RSYNC_FLAGS[@]}" "$SRC/" "$HOST:$REMOTE_DIR/"
  echo "(dry-run: nothing written, no containers touched)"
  exit 0
fi

# 1. sync code (runtime data and secrets on the host are excluded above)
rsync "${RSYNC_FLAGS[@]}" "$SRC/" "$HOST:$REMOTE_DIR/"

if [ "$TARGET" = "backend" ]; then
  # 2. rollback tag before the rebuild overwrites :latest
  ssh "$HOST" "cd $REMOTE_DIR && \
    docker image inspect ethersignals:latest >/dev/null 2>&1 && \
    docker tag ethersignals:latest ethersignals:rollback-$(date +%Y%m%d-%H%M) || true && \
    docker compose -f $COMPOSE build && \
    docker compose -f $COMPOSE up -d"
  # 3. health: container healthcheck hits /api/engine internally
  echo "-- waiting for health…"
  for _ in $(seq 1 24); do
    st=$(ssh "$HOST" "docker inspect $SERVICE --format '{{.State.Health.Status}}'")
    [ "$st" = "healthy" ] && { echo "backend healthy ✓"; exit 0; }
    sleep 5
  done
  echo "✗ backend not healthy after 2min — rollback hint:" >&2
  echo "  ssh $HOST 'cd $REMOTE_DIR && docker compose down && docker tag ethersignals:rollback-<ts> ethersignals:latest && docker compose up -d'" >&2
  exit 1
else
  # 2. build applies prisma migrations (build-time, idempotent) — a schema
  #    migration failing the build aborts BEFORE the running container moves
  ssh "$HOST" "cd $REMOTE_DIR && \
    docker image inspect ethersignals-app:latest >/dev/null 2>&1 && \
    docker tag ethersignals-app:latest ethersignals-app:rollback-$(date +%Y%m%d-%H%M) || true && \
    docker compose -f $COMPOSE build && \
    docker compose -f $COMPOSE up -d"
  echo "-- waiting for health…"
  for _ in $(seq 1 24); do
    code=$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3021/api/health")
    [ "$code" = "200" ] && { echo "frontend healthy ✓"; exit 0; }
    sleep 5
  done
  echo "✗ frontend not healthy after 2min — rollback hint:" >&2
  echo "  ssh $HOST 'cd $REMOTE_DIR && docker compose -f $COMPOSE down && docker tag ethersignals-app:rollback-<ts> ethersignals-app:latest && docker compose -f $COMPOSE up -d'" >&2
  exit 1
fi
