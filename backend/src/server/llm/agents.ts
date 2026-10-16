import { settingsRepo } from '@/server/store/repos';
import { mcpTools, type McpTool } from '@/server/mcp/tools';
import { complete } from './providers';
import { notify } from '@/server/events/notifier';
import { logAudit } from '@/server/store/pg';
import { uid } from '@/lib/utils';
import type { LlmAgent } from '@/core/types';

const TOOL_PROTOCOL = `

TOOL PROTOCOL: You may call tools. Reply with ONE JSON object only (no prose, no markdown fences):
{"tool":"<tool_name>","args":{...}}   to call a tool, or
{"reply":"<final answer to the user>"}   when done.
Available tools: [[TOOLS]]`;

const EXTRA_TOOLS: McpTool[] = [
  {
    name: 'send_notification',
    description: 'Send an in-app notification to the user (station push + desktop/Telegram/Web-Push channels)',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' }, level: { type: 'string', enum: ['info', 'success', 'warning', 'error'] } },
      required: ['message'],
    },
    handler: async (args) => {
      notify('agent.message', { message: String(args.message ?? '') }, {
        level: (args.level as 'info' | 'success' | 'warning' | 'error') ?? 'info',
        channel: 'llm',
      });
      return { sent: true };
    },
  },
];

function registry(): Map<string, McpTool> {
  return new Map([...mcpTools(), ...EXTRA_TOOLS].map((t) => [t.name, t]));
}

export function listAgents(): LlmAgent[] {
  return settingsRepo.get().llmAgents ?? [];
}

function saveAgents(agents: LlmAgent[]) {
  settingsRepo.update({ llmAgents: agents });
}

export function upsertAgent(agent: Partial<LlmAgent> & { name: string }): LlmAgent {
  const agents = listAgents();
  const now = Date.now();
  const next: LlmAgent = {
    id: agent.id ?? uid('ag_'),
    name: agent.name,
    enabled: agent.enabled ?? true,
    systemPrompt: agent.systemPrompt ?? 'You are a trading operations agent.',
    tools: agent.tools ?? ['send_notification', 'get_ticker', 'get_balance'],
    liveOrders: agent.liveOrders ?? false,
    maxActionsPerRun: Math.max(1, Math.min(agent.maxActionsPerRun ?? 4, 10)),
    trigger: agent.trigger ?? { type: 'manual' },
    task: agent.task,
    lastRunTs: agent.lastRunTs,
    lastOutput: agent.lastOutput,
  };
  const idx = agents.findIndex((a) => a.id === next.id);
  if (idx >= 0) agents[idx] = next;
  else agents.push(next);
  saveAgents(agents);
  return next;
}

export function deleteAgent(id: string) {
  saveAgents(listAgents().filter((a) => a.id !== id));
}

/** Run history (in-memory ring per agent). */
const runs = new Map<string, { ts: number; input: string; output: string; ok: boolean }[]>();

export function runHistory(id: string) {
  return runs.get(id) ?? [];
}

function pushRun(id: string, entry: { ts: number; input: string; output: string; ok: boolean }) {
  const arr = runs.get(id) ?? [];
  arr.unshift(entry);
  if (arr.length > 20) arr.length = 20;
  runs.set(id, arr);
}

/** Execute one agent run: tool-calling loop over the whitelisted registry. */
export async function runAgent(id: string, input: string): Promise<{ ok: boolean; output: string }> {
  const agent = listAgents().find((a) => a.id === id);
  if (!agent) return { ok: false, output: 'agent not found' };
  try {
    return await executeRun(agent, input);
  } catch (e) {
    const output = (e as Error).message ?? 'run failed';
    pushRun(id, { ts: Date.now(), input, output, ok: false });
    return { ok: false, output };
  }
}

async function executeRun(agent: LlmAgent, input: string): Promise<{ ok: boolean; output: string }> {
  const reg = registry();
  const allowed = agent.tools.filter((t) => reg.has(t));
  const toolDocs = allowed
    .map((name) => `${name}: ${reg.get(name)!.description}`)
    .join('\n- ');
  const system = agent.systemPrompt.replace('[[TOOLS]]', toolDocs) + TOOL_PROTOCOL.replace('[[TOOLS]]', toolDocs);

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
    { role: 'user', content: input || agent.task || 'Run your standing task.' },
  ];

  let final = '';
  for (let step = 0; step <= agent.maxActionsPerRun; step++) {
    const out = (await complete(messages, { temperature: 0.3 })).trim();
    let parsed: { tool?: string; args?: Record<string, unknown>; reply?: string };
    try {
      const jsonText = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
      parsed = JSON.parse(jsonText);
    } catch {
      final = out;
      break;
    }
    if (parsed.reply) {
      final = parsed.reply;
      break;
    }
    const toolName = String(parsed.tool ?? '');
    const tool = reg.get(toolName);
    if (!tool || !allowed.includes(toolName)) {
      final = `tool "${toolName}" is not allowed for this agent`;
      break;
    }
    let args = parsed.args ?? {};
    // safety gating for orders
    if (toolName === 'place_order') {
      args = agent.liveOrders ? { ...args, confirm: true } : { ...args, paper: true };
    }
    let result: unknown;
    try {
      result = await tool.handler(args);
      logAudit({
        category: 'llm', action: `agent.tool:${agent.name}/${toolName}`,
        level: 'info', symbol: args.symbol ? String(args.symbol) : null,
        payload: args, result: (result as { error?: string })?.error ? 'fail' : 'ok',
      });
    } catch (e) {
      result = { error: (e as Error).message };
    }
    messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
    messages.push({ role: 'user', content: `TOOL_RESULT: ${JSON.stringify(result).slice(0, 2000)}` });
  }

  if (!final) final = '(no final reply — action limit reached)';
  settingsRepo.update({
    llmAgents: listAgents().map((a) => (a.id === agent.id ? { ...a, lastRunTs: Date.now(), lastOutput: final.slice(0, 2000) } : a)),
  });
  pushRun(agent.id, { ts: Date.now(), input, output: final, ok: !final.startsWith('(') });
  logAudit({ category: 'llm', action: `agent.run:${agent.name}`, level: 'info', payload: { input }, result: 'ok' });
  return { ok: true, output: final };
}

/** sync scheduled/event triggers (called periodically by the runtime) */
const timers = new Map<string, ReturnType<typeof setInterval>>();
const eventBinds = new Map<string, () => void>();

export function syncTriggers() {
  const agents = listAgents();
  for (const agent of agents) {
    if (!agent.enabled) continue;
    if (agent.trigger.type === 'interval' && agent.trigger.intervalSec && !timers.has(agent.id)) {
      const timer = setInterval(() => {
        void runAgent(agent.id, agent.task ?? 'Scheduled run.').catch(() => undefined);
      }, Math.max(30, agent.trigger.intervalSec) * 1000);
      timers.set(agent.id, timer);
    }
    if (agent.trigger.type === 'event' && agent.trigger.event && !eventBinds.has(agent.id)) {
      let last = 0;
      const off = busOn(agent.trigger.event, () => {
        const now = Date.now();
        if (now - last < 30_000) return; // throttle per event
        last = now;
        void runAgent(agent.id, `Event "${agent.trigger.event}" fired. ${agent.task ?? ''}`);
      });
      eventBinds.set(agent.id, off);
    }
  }
  // prune removed/disabled agents
  for (const [id, timer] of timers) {
    const a = agents.find((x) => x.id === id);
    if (!a || !a.enabled || a.trigger.type !== 'interval') {
      clearInterval(timer);
      timers.delete(id);
    }
  }
  for (const [id, off] of eventBinds) {
    const a = agents.find((x) => x.id === id);
    if (!a || !a.enabled || a.trigger.type !== 'event') {
      off();
      eventBinds.delete(id);
    }
  }
}

import { bus } from '@/server/events/bus';
function busOn(event: string, fn: () => void): () => void {
  return bus.on(event, () => fn());
}
