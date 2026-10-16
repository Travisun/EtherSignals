import { describe, expect, it } from "vitest";
import {
  signPayload,
  verifyWebhookSignature,
} from "@/lib/signals/signature";

const SECRET = "test-secret";
const BODY = JSON.stringify({ symbol: "ETHUSDT", side: "LONG" });

function headersWith(sig: string | null, ts: string | number | null) {
  const h = new Headers();
  if (sig !== null) h.set("x-ethersignals-signature", sig);
  if (ts !== null) h.set("x-ethersignals-timestamp", String(ts));
  return h;
}

describe("verifyWebhookSignature", () => {
  const now = 1_700_000_000_000;
  const tolerance = 300;

  it("accepts a correctly signed, fresh payload", () => {
    const ts = now / 1000;
    const sig = signPayload(SECRET, ts, BODY);
    expect(
      verifyWebhookSignature(BODY, headersWith(sig, ts), [SECRET], tolerance, now),
    ).toEqual({ ok: true });
  });

  it("accepts with the second secret in a rotation list", () => {
    const ts = now / 1000;
    const sig = signPayload("new-secret", ts, BODY);
    expect(
      verifyWebhookSignature(BODY, headersWith(sig, ts), [SECRET, "new-secret"], tolerance, now),
    ).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const ts = now / 1000;
    const sig = signPayload(SECRET, ts, BODY);
    const result = verifyWebhookSignature(
      BODY + " ",
      headersWith(sig, ts),
      [SECRET],
      tolerance,
      now,
    );
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects stale timestamps (replay)", () => {
    const ts = now / 1000 - tolerance - 1;
    const sig = signPayload(SECRET, ts, BODY);
    expect(
      verifyWebhookSignature(BODY, headersWith(sig, ts), [SECRET], tolerance, now),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects future timestamps beyond tolerance", () => {
    const ts = now / 1000 + tolerance + 10;
    const sig = signPayload(SECRET, ts, BODY);
    expect(
      verifyWebhookSignature(BODY, headersWith(sig, ts), [SECRET], tolerance, now),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects missing pieces and non-numeric timestamps", () => {
    const ts = now / 1000;
    const sig = signPayload(SECRET, ts, BODY);
    expect(verifyWebhookSignature(BODY, new Headers(), [SECRET], tolerance, now)).toEqual({
      ok: false,
      reason: "missing_signature",
    });
    expect(
      verifyWebhookSignature(BODY, headersWith(sig, null), [SECRET], tolerance, now),
    ).toEqual({ ok: false, reason: "missing_timestamp" });
    expect(
      verifyWebhookSignature(BODY, headersWith(sig, "abc"), [SECRET], tolerance, now),
    ).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("rejects everything when no secret is configured", () => {
    const ts = now / 1000;
    const sig = signPayload(SECRET, ts, BODY);
    expect(
      verifyWebhookSignature(BODY, headersWith(sig, ts), [], tolerance, now),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });
});
