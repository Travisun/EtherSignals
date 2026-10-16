import { NextRequest } from 'next/server';
import { listAgents, upsertAgent, deleteAgent, runAgent, runHistory } from '@/server/llm/agents';
import { ok, fail, errorResponse } from '@/server/api/helpers';
import { guard } from '@/server/security/guard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await guard(req);
  if (denied) return denied;
  return ok({ agents: listAgents(), history: Object.fromEntries(listAgents().map((a) => [a.id, runHistory(a.id)])) });
}

export async function POST(req: NextRequest) {
  const denied = await guard(req, { pin: true });
  if (denied) return denied;
  try {
    const body = await req.json();
    if (body.action === 'run') {
      const res = await runAgent(String(body.id), String(body.input ?? ''));
      return ok(res);
    }
    if (!body.name) return fail('name required');
    const agent = upsertAgent({
      id: body.id ? String(body.id) : undefined,
      name: String(body.name),
      enabled: body.enabled ?? true,
      systemPrompt: String(body.systemPrompt ?? ''),
      tools: Array.isArray(body.tools) ? body.tools.map(String) : ['send_notification'],
      liveOrders: Boolean(body.liveOrders),
      maxActionsPerRun: body.maxActionsPerRun != null ? Number(body.maxActionsPerRun) : undefined,
      trigger: body.trigger ?? { type: 'manual' },
      task: body.task ? String(body.task) : undefined,
    });
    return ok({ agent });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await guard(req, { pin: true });
  if (denied) return denied;
  try {
    deleteAgent(req.nextUrl.searchParams.get('id') ?? '');
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
