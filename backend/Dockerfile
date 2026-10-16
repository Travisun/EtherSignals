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
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app ./
USER app
EXPOSE 3000
CMD ["node", "server.mjs"]
