import { NextResponse } from 'next/server';
import { ensureRuntime } from '@/server/engine/runtime';
import { BitgetApiError } from '@/server/bitget/rest';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(message: string, status = 400, code?: string) {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export function errorResponse(e: unknown) {
  if (e instanceof BitgetApiError) {
    return fail(e.message, 502, e.code);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return fail(msg, 500);
}

/** Boot the engine lazily so plain `next dev` also works. */
export async function withEngine<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    await ensureRuntime();
    return await fn();
  } catch (e) {
    return errorResponse(e);
  }
}
