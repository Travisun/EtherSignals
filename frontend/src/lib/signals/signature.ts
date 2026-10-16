import { createHmac, timingSafeEqual } from "crypto";

/**
 * Webhook authenticity verification.
 *
 * Contract (mirrors the reference project's HMAC scheme):
 *   Signature = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *   Headers:
 *     X-EtherSignals-Signature: sha256=<hex digest>
 *     X-EtherSignals-Timestamp: <unix seconds>
 *     X-EtherSignals-Event-Id:  <optional dedupe key>
 *
 * - Constant-time comparisons everywhere.
 * - Timestamp tolerance window rejects replays captured more than
 *   `toleranceSec` ago (default 300s).
 * - Secret rotation: any secret in the list verifies; senders migrate one by
 *   one, old secrets are then removed.
 */

export const SIGNATURE_HEADER = "x-ethersignals-signature";
export const TIMESTAMP_HEADER = "x-ethersignals-timestamp";
export const EVENT_ID_HEADER = "x-ethersignals-event-id";

export function signPayload(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Burn comparable time to keep length a non-signal.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Constant-time string comparison shared with the Bearer-token path. */
export { safeEqual };

/**
 * GTrading-style authentication: `Authorization: Bearer <token>`.
 * Token must match one of the configured secrets (constant-time).
 */
export function verifyBearerToken(
  headers: Headers,
  secrets: string[],
): VerifyResult {
  const auth = headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) return { ok: false, reason: "missing_credentials" };
  const token = match[1].trim();
  if (secrets.length === 0 || token === "") {
    return { ok: false, reason: "bad_token" };
  }
  for (const secret of secrets) {
    if (safeEqual(token, secret)) return { ok: true };
  }
  return { ok: false, reason: "bad_token" };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

export function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
  secrets: string[],
  toleranceSec: number,
  nowMs: number = Date.now(),
): VerifyResult {
  const sig = headers.get(SIGNATURE_HEADER);
  if (!sig) return { ok: false, reason: "missing_signature" };
  const tsRaw = headers.get(TIMESTAMP_HEADER);
  if (!tsRaw) return { ok: false, reason: "missing_timestamp" };

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  const driftSec = Math.abs(nowMs / 1000 - ts);
  if (driftSec > toleranceSec) return { ok: false, reason: "stale_timestamp" };

  if (secrets.length === 0) return { ok: false, reason: "bad_signature" };

  for (const secret of secrets) {
    const expected = signPayload(secret, ts, rawBody);
    if (safeEqual(expected, sig)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}
