import { NextRequest } from 'next/server';
import { streamChat, DEFAULT_CHAT_PROMPT, DEFAULT_ADVICE_PROMPT } from '@/server/llm/providers';
import { getTradeAdvice, buildMarketContext } from '@/server/llm/advice';
import { settingsRepo } from '@/server/store/repos';
import { errorResponse } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';
import { notify } from '@/server/events/notifier';
import type { LlmChatMessage, MarketType, Timeframe } from '@/core/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** POST /api/llm — modes: chat (SSE stream), advice (structured JSON). */
export async function POST(req: NextRequest) {
  {
    const denied = await guard(req);
    if (denied) return denied;
  }
  try {
    const body = await req.json();
    const mode = String(body.mode ?? 'chat');
    const settings = settingsRepo.get();

    if (mode === 'advice') {
      const ctx = await buildMarketContext(
        String(body.symbol ?? 'BTCUSDT').toUpperCase(),
        (body.marketType as MarketType) ?? 'futures',
        (body.timeframe as Timeframe) ?? '15m',
      );
      const advice = await getTradeAdvice(ctx);
      notify('llm.advice.ready', {
        symbol: ctx.symbol, bias: advice.bias, confidence: advice.confidence,
      }, { level: 'success', channel: 'llm' });
      return Response.json({ ok: true, data: { advice, context: { price: ctx.price, symbol: ctx.symbol } } });
    }

    // chat mode → SSE token stream
    const messages: LlmChatMessage[] = body.messages ?? [];
    // bound cost: cap message count and payload size per request
    if (messages.length > 60) {
      return errorResponse(new Error('too many messages (max 60)'));
    }
    const serialized = JSON.stringify(messages);
    if (serialized.length > 256_000) {
      return errorResponse(new Error('chat payload too large'));
    }
    const system = settings.llm.chatSystemPrompt?.trim() || DEFAULT_CHAT_PROMPT;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(': start\n\n'));
          for await (const token of streamChat([{ role: 'system', content: system }, ...messages], {
            signal: req.signal,
          })) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** GET /api/llm — introspection: prompts + provider status (no secrets). */
export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  const { llm } = settingsRepo.get();
  return Response.json({
    ok: true,
    data: {
      hasProvider: llm.providers.some((p) => p.enabled && p.apiKey),
      activeProviderId: llm.activeProviderId ?? null,
      chatSystemPrompt: llm.chatSystemPrompt || DEFAULT_CHAT_PROMPT,
      adviceSystemPrompt: llm.adviceSystemPrompt || DEFAULT_ADVICE_PROMPT,
      temperature: llm.temperature,
    },
  });
}
