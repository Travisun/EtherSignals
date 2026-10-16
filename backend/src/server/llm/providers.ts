import { settingsRepo } from '@/server/store/repos';
import { renderNotif } from '@/server/i18n/notifyTexts';
import type { LlmChatMessage, LlmProvider } from '@/core/types';

export const DEFAULT_CHAT_PROMPT = `You are DownTrade's professional crypto trading assistant embedded in a Bitget workbench.
You help the user analyze markets, explain indicators and discuss risk.
Never guarantee profits. Always mention risk when giving directional views.
Answer in the same language the user writes in. Be concise and quantified.`;

export const DEFAULT_ADVICE_PROMPT = `You are a professional crypto trading analyst. Based on the market context provided,
produce a single trading decision in STRICT JSON only (no markdown fences, no prose):
{
  "bias": "long" | "short" | "neutral",
  "confidence": 0-100,
  "entry": number|null,
  "stopLoss": number|null,
  "takeProfit": [numbers],
  "timeHorizon": "minutes"|"hours"|"days"|"weeks",
  "summary": "one short paragraph",
  "risks": ["..."],
  "indicatorsCited": ["RSI(14)","MACD"]
}
Rules: use the quote currency of the symbol for prices; if signals conflict choose "neutral";
confidence below 50 means "neutral" regardless of bias.`;

export interface ChatStreamCallbacks {
  onToken: (t: string) => void;
  signal?: AbortSignal;
}

function activeProvider(): LlmProvider | null {
  const { llm } = settingsRepo.get();
  const list = llm.providers.filter((p) => p.enabled && p.apiKey);
  if (!list.length) return null;
  return list.find((p) => p.id === llm.activeProviderId) ?? list[0];
}

export function hasProvider() {
  return activeProvider() != null;
}

function resolveBaseURL(p: LlmProvider): string {
  const b = (p.baseURL || '').trim().replace(/\/+$/, '');
  if (b) return b;
  switch (p.type) {
    case 'anthropic': return 'https://api.anthropic.com';
    case 'gemini': return 'https://generativelanguage.googleapis.com';
    default: return 'https://api.openai.com/v1';
  }
}

/** Stream a chat completion through the configured provider. */
export async function* streamChat(
  messages: LlmChatMessage[],
  opts: { temperature?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const provider = activeProvider();
  if (!provider) throw new Error('NO_PROVIDER');
  const { llm } = settingsRepo.get();
  const temperature = opts.temperature ?? llm.temperature ?? 0.4;
  const base = resolveBaseURL(provider);

  if (provider.type === 'openai-compatible') {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model || 'gpt-4o-mini',
        temperature,
        stream: true,
        messages,
      }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    for await (const token of sseTokens(res.body, (data) => {
      const j = JSON.parse(data);
      return j.choices?.[0]?.delta?.content ?? '';
    })) yield token;
    return;
  }

  if (provider.type === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const rest = messages.filter((m) => m.role !== 'system');
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model || 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        temperature,
        stream: true,
        system: system || undefined,
        messages: rest,
      }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    for await (const token of sseTokens(res.body, (data) => {
      try {
        const j = JSON.parse(data);
        return j.type === 'content_block_delta' ? (j.delta?.text ?? '') : '';
      } catch {
        return '';
      }
    })) yield token;
    return;
  }

  // gemini
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const url = `${base}/v1beta/models/${provider.model || 'gemini-1.5-flash'}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.apiKey },
    body: JSON.stringify({
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { temperature },
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  for await (const token of sseTokens(res.body, (data) => {
    try {
      const j = JSON.parse(data);
      const parts = j.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p: { text?: string }) => p.text ?? '').join('');
    } catch {
      return '';
    }
  })) yield token;
}

async function* sseTokens(body: ReadableStream<Uint8Array>, extract: (data: string) => string): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const token = extract(data);
        if (token) yield token;
      } catch {
        // skip malformed frame
      }
    }
  }
}

/** Non-streaming completion (used for advice & llm_bias conditions). */
export async function complete(messages: LlmChatMessage[], opts: { temperature?: number } = {}): Promise<string> {
  let out = '';
  for await (const t of streamChat(messages, opts)) out += t;
  return out;
}

export function providerErrorHint(e: unknown, locale: 'zh-CN' | 'en'): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === 'NO_PROVIDER') return renderNotif('llm.no_provider', undefined, locale);
  return msg;
}
