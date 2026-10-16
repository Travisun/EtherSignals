import webpush from "web-push";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { REGIME_LABELS } from "@/lib/constants";

/**
 * Web Push fan-out to anonymous subscribers. Gracefully degrades to a no-op
 * when VAPID keys are not configured (dev / self-host minimal installs).
 */

let configured = false;

export function pushConfigured(): boolean {
  return env.vapid !== null;
}

function ensureConfigured(): boolean {
  if (configured) return true;
  const vapid = env.vapid;
  if (!vapid) return false;
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  configured = true;
  return true;
}

export type NewSignalPush = {
  symbol: string;
  timeframe: string;
  regime: string;
  score: number;
  price: string | null;
  marketType: string;
  url: string;
};

/**
 * Fire-and-forget fan-out. Never throws; callers run this inside
 * `after()` (post-response) and failures must not affect ingest results.
 * Dead endpoints (404/410) are pruned.
 */
export async function broadcastNewSignal(payload: NewSignalPush): Promise<void> {
  if (!ensureConfigured()) return;

  let subs: { id: string; endpoint: string; p256dh: string; auth: string }[];
  try {
    subs = await db.pushSubscription.findMany({
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  } catch (err) {
    console.error("[push] failed to list subscriptions", err);
    return;
  }
  if (subs.length === 0) return;

  const regimeLabel = REGIME_LABELS[payload.regime] ?? payload.regime;
  const market = payload.marketType === "spot" ? "Spot" : "Perp";
  const text =
    `${market} · ${payload.timeframe} trend → ${regimeLabel}` +
    (payload.price ? ` @ ${payload.price}` : "") +
    ` · score ${payload.score >= 0 ? "+" : ""}${payload.score.toFixed(2)}`;

  const payloadJson = JSON.stringify({
    title: `${payload.symbol} · ${regimeLabel} (${payload.timeframe})`,
    body: text,
    url: payload.url,
  });

  const dead: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadJson,
          { TTL: 300, urgency: "high" },
        );
        await db.pushSubscription.update({
          where: { id: sub.id },
          data: { lastSentAt: new Date() },
        });
      } catch (err) {
        const statusCode =
          typeof err === "object" && err !== null && "statusCode" in err
            ? Number((err as { statusCode: unknown }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) dead.push(sub.id);
        else console.error(`[push] send failed (${statusCode})`, err);
      }
    }),
  );

  if (dead.length > 0) {
    await db.pushSubscription
      .deleteMany({ where: { id: { in: dead } } })
      .catch(() => undefined);
  }
}
