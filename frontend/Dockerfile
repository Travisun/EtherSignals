# ── deps ──────────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ── build ─────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are baked into the client bundle at build time —
# pass them as build args (docker-compose.prod.yml wires them from .env).
ARG NEXT_PUBLIC_SITE_URL=""
ARG NEXT_PUBLIC_TELEGRAM_URL=""
ARG NEXT_PUBLIC_GITHUB_REPO=""
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_TELEGRAM_URL=$NEXT_PUBLIC_TELEGRAM_URL \
    NEXT_PUBLIC_GITHUB_REPO=$NEXT_PUBLIC_GITHUB_REPO \
    NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ── migrations (build time) ───────────────────────────
# Apply pending migrations while the full prisma CLI is available. Requires
# DATABASE_URL as a build arg and a network that can reach PostgreSQL
# (docker-compose.prod.yml wires both; build.network: host). Idempotent —
# safe on every build; skipped silently when DATABASE_URL is empty (e.g.
# local dev builds).
ARG DATABASE_URL=""
RUN if [ -n "$DATABASE_URL" ]; then \
      echo "[build] applying prisma migrations..."; \
      npx prisma migrate deploy; \
    else \
      echo "[build] DATABASE_URL empty — skipping migrations"; \
    fi

# ── runner ────────────────────────────────────────────
FROM node:24-slim AS runner
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/* \
 && groupadd -r nodejs && useradd -r -g nodejs nodejs
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Prisma engine (standalone tracing fallback) + schema (introspection/debug).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
# GeoLite2 updater: the entrypoint keeps /app/geoip fresh (mounted volume).
COPY scripts/geoip-download.mjs ./scripts/geoip-download.mjs
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/public /app/geoip && chown -R nodejs:nodejs /app
USER nodejs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
