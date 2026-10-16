import { NextRequest, NextResponse } from 'next/server';
import { settingsRepo } from '@/server/store/repos';
import { mcpTools } from '@/server/mcp/tools';
import { ensureRuntime } from '@/server/engine/runtime';
import { logAudit } from '@/server/store/pg';

export const dynamic = 'force-dynamic';

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } });
}

/**
 * MCP (Model Context Protocol) streamable-HTTP endpoint.
 * Exposes every local capability as an MCP tool: market data, account,
 * orders, strategy hooks, backtests and the LLM assistant.
 */
export async function POST(req: NextRequest) {
  const { mcp } = settingsRepo.get();
  if (!mcp.enabled) {
    return NextResponse.json({ error: 'MCP is disabled in Settings' }, { status: 403 });
  }
  // an empty token must fail closed, never open an unauthenticated order router
  if (!mcp.token || req.headers.get('authorization') !== `Bearer ${mcp.token}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  try {
    await ensureRuntime();
    switch (body.method) {
      case 'initialize':
        return rpcResult(body.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'gtrading', version: '1.0.0' },
        });
      case 'notifications/initialized':
        return new NextResponse(null, { status: 202 });
      case 'ping':
        return rpcResult(body.id, {});
      case 'tools/list':
        return rpcResult(body.id, {
          tools: mcpTools().map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
      case 'tools/call': {
        const name = String(body.params?.name ?? '');
        const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
        const tool = mcpTools().find((t) => t.name === name);
        if (!tool) {
          return rpcError(body.id, -32602, `unknown tool: ${name}`);
        }
        try {
          const result = await tool.handler(args);
          const isError = (result as { error?: string })?.error != null;
          logAudit({
            category: 'mcp', action: `tool:${name}`,
            level: isError ? 'warning' : 'info',
            accountId: args.accountId ? String(args.accountId) : null,
            symbol: args.symbol ? String(args.symbol).toUpperCase() : null,
            payload: args, result: isError ? 'fail' : 'ok',
            error: isError ? String((result as { error: string }).error) : null,
          });
          return rpcResult(body.id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          });
        } catch (e) {
          logAudit({
            category: 'mcp', action: `tool:${name}`, level: 'error',
            symbol: args.symbol ? String(args.symbol).toUpperCase() : null,
            payload: args, result: 'fail', error: (e as Error).message,
          });
          return rpcResult(body.id, {
            content: [{ type: 'text', text: `error: ${(e as Error).message}` }],
            isError: true,
          });
        }
      }
      default:
        return rpcError(body.id, -32601, `method not found: ${body.method}`);
    }
  } catch (e) {
    return rpcError(body.id, -32603, (e as Error).message ?? 'internal error');
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'use POST with JSON-RPC 2.0 (MCP streamable HTTP)' },
    { status: 405 },
  );
}
