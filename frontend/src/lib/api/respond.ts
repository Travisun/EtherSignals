/** Uniform JSON response helpers for route handlers. */

export function jsonOk(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

/** Deliberately terse, never leak internals to the wire. */
export const ERR = {
  badRequest: (message: string, headers?: Record<string, string>) =>
    apiError(400, "bad_request", message, headers),
  unauthorized: (message: string) => apiError(401, "unauthorized", message),
  notFound: () => apiError(404, "not_found", "Resource not found."),
  payloadTooLarge: (message: string) => apiError(413, "payload_too_large", message),
  rateLimited: (seconds: number) =>
    apiError(
      429,
      "rate_limited",
      `Too many requests. Retry after ${seconds}s.`,
      { "Retry-After": String(seconds) },
    ),
  server: () =>
    apiError(500, "internal_error", "Something went wrong. Try again later."),
};
