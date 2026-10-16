import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ERR, jsonOk } from "@/lib/api/respond";
import { checkIpRateLimit, clientIpFromHeaders } from "@/lib/security/ip";
import { RateLimitError } from "@/lib/security/rate-limit";
import {
  verifyBearerToken,
  verifyWebhookSignature,
} from "@/lib/signals/signature";
import {
  parseSignalTrend,
  toSignalInput,
} from "@/lib/signals/schema";
import { MAX_RAW_PAYLOAD_BYTES, MAX_WEBHOOK_BODY_BYTES } from "@/lib/constants";
import { broadcastNewSignal } from "@/lib/notifications/push";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/signals, the single ingest endpoint, speaking the
 * GTrading "signal.trend" contract (docs/WEBHOOK.md).
 *
 * Authentication, in order:
 *  1. `Authorization: Bearer <token>` (GTrading native), constant-time
 *     comparison against the WEBHOOK_SECRETS list.
 *  2. HMAC signature headers (optional hardening for other senders).
 *
 * Idempotency: unique on the producer's `ts`, so merge-window repeats and the
 * documented single retry are counted as duplicates, never re-broadcast.
 */
export async function POST(request: Request) {
  const ip = clientIpFromHeaders(request.headers, env.trustProxy);
  try {
    checkIpRateLimit("webhookIngest", ip);
  } catch (err) {
    if (err instanceof RateLimitError) return ERR.rateLimited(err.retryAfterSec);
    throw err;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return ERR.badRequest("Content-Type must be application/json");
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return ERR.payloadTooLarge("Body exceeds 64 KB.");
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return ERR.badRequest("Unreadable body.");
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return ERR.payloadTooLarge("Body exceeds 64 KB.");
  }

  if (env.isProd && env.webhookSecrets.length === 0) {
    // Misconfigured deployment: refuse everything rather than accept forgeries.
    console.error("[webhook] WEBHOOK_SECRETS is empty in production");
    return ERR.server();
  }

  const auth = authenticate(rawBody, request.headers, env);
  if (!auth.ok) {
    void logIngest(ip, "rejected", auth.reason, null);
    return ERR.unauthorized(`Webhook authentication failed: ${auth.reason}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    void logIngest(ip, "rejected", "invalid_json", null);
    return ERR.badRequest("Body is not valid JSON.");
  }

  const result = parseSignalTrend(parsed);
  if (!result.ok) {
    void logIngest(ip, "rejected", "schema_mismatch", null);
    return ERR.badRequest(
      "Payload failed validation: " +
        result.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
    );
  }

  const input = toSignalInput(
    result.data,
    Buffer.byteLength(rawBody, "utf8") <= MAX_RAW_PAYLOAD_BYTES ? parsed : null,
  );

  try {
    const row = await db.signal.create({ data: input });

    after(async () => {
      await broadcastNewSignal({
        symbol: row.symbol,
        timeframe: row.timeframe,
        regime: row.regime,
        score: row.score,
        price: row.price ? row.price.toString() : null,
        marketType: row.marketType,
        url: "/",
      });
    });

    void logIngest(ip, "accepted", null, row.id);
    return jsonOk({ accepted: 1, duplicates: 0 }, { status: 201 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      void logIngest(ip, "duplicate", "ts already ingested", null);
      return jsonOk({ accepted: 0, duplicates: 1 });
    }
    console.error("[webhook] persist failed", err);
    void logIngest(ip, "rejected", "persist_failed", null);
    return ERR.server();
  }
}

type AuthResult =
  | { ok: true }
  | { ok: false; reason: string };

function authenticate(
  rawBody: string,
  headers: Headers,
  env: { webhookSecrets: string[]; webhookTimestampTolerance: number },
): AuthResult {
  // Enhanced mode: HMAC-signed senders.
  if (headers.get("x-ethersignals-signature")) {
    return verifyWebhookSignature(
      rawBody,
      headers,
      env.webhookSecrets,
      env.webhookTimestampTolerance,
    );
  }
  // Native GTrading mode: Bearer token.
  return verifyBearerToken(headers, env.webhookSecrets);
}

async function logIngest(
  ip: string,
  status: "accepted" | "duplicate" | "rejected",
  reason: string | null,
  signalId: string | null,
) {
  await db.ingestLog
    .create({
      data: { ip: ip === "unknown" ? null : ip, status, reason, signalId },
    })
    .catch(() => undefined);
  // Opportunistic retention trim (~1% of writes keeps the table ≤ 30 days).
  if (Math.random() < 0.01) {
    await db.ingestLog
      .deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 30 * 24 * 3600_000) } },
      })
      .catch(() => undefined);
  }
}
