# GTrading — production image (custom server + Socket.IO)
# node:24 — undici v8 requires util.markAsUncloneable (Node >= 22.10)
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# IPv4-first DNS: container bridges commonly return AAAA records the network
# cannot honor (no real v6 egress), so v6-first connects stall until timeout
ENV NODE_OPTIONS=--dns-result-order=ipv4first
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app ./
USER app
EXPOSE 3000
CMD ["node", "server.mjs"]
