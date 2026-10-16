#!/bin/sh
set -e

# Migrations are applied at image build time (Dockerfile → prisma migrate
# deploy, idempotent). Schema changes always ship with a new image, so boot
# stays fast and dependency-free. exec the container command.
exec "$@"
