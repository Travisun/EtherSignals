import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ERR, jsonOk } from "@/lib/api/respond";
import { checkIpRateLimit, clientIpFromHeaders } from "@/lib/security/ip";
import { RateLimitError } from "@/lib/security/rate-limit";
import { pushConfigured } from "@/lib/notifications/push";

export const dynamic = "force-dynamic";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});

/** GET /api/push, a capability probe for the client (is push available?). */
export async function GET() {
  return jsonOk({ enabled: pushConfigured() });
}

/** POST /api/push, register an anonymous push subscription. */
export async function POST(request: Request) {
  const ip = clientIpFromHeaders(request.headers, env.trustProxy);
  try {
    checkIpRateLimit("pushManage", ip);
  } catch (err) {
    if (err instanceof RateLimitError) return ERR.rateLimited(err.retryAfterSec);
    throw err;
  }

  if (!pushConfigured()) {
    return jsonOk({ ok: false, reason: "push_not_configured" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ERR.badRequest("Body must be JSON.");
  }
  const result = subscriptionSchema.safeParse(body);
  if (!result.success) {
    return ERR.badRequest("Invalid PushSubscription payload.");
  }

  // Only allow same-origin push service endpoints; an open relay to
  // arbitrary URLs would turn this into an SSRF amplifier.
  const endpointHost = safeHost(result.data.endpoint);
  if (!endpointHost || !ALLOWED_PUSH_HOSTS.has(endpointHost)) {
    return ERR.badRequest("Unsupported push service endpoint.");
  }

  await db.pushSubscription
    .upsert({
      where: { endpoint: result.data.endpoint },
      create: {
        endpoint: result.data.endpoint,
        p256dh: result.data.keys.p256dh,
        auth: result.data.keys.auth,
        userAgent: request.headers.get("user-agent")?.slice(0, 256) ?? null,
      },
      update: {
        p256dh: result.data.keys.p256dh,
        auth: result.data.keys.auth,
      },
    })
    .catch(() => undefined);

  return jsonOk({ ok: true });
}

/** DELETE /api/push?endpoint=..., unsubscribe. */
export async function DELETE(request: Request) {
  const ip = clientIpFromHeaders(request.headers, env.trustProxy);
  try {
    checkIpRateLimit("pushManage", ip);
  } catch (err) {
    if (err instanceof RateLimitError) return ERR.rateLimited(err.retryAfterSec);
    throw err;
  }

  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) return ERR.badRequest("endpoint query parameter is required.");
  if (endpoint.length > 2048) return ERR.badRequest("endpoint too long.");

  await db.pushSubscription
    .deleteMany({ where: { endpoint } })
    .catch(() => undefined);

  return jsonOk({ ok: true });
}

const ALLOWED_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "push.services.mozilla.com",
]);

function safeHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}
