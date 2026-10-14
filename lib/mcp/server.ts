import { timingSafeEqual } from 'node:crypto';
import { SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION, TOOLS, type ToolName } from './tools';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-03-26';

export interface McpHttpRequest {
  method: string;
  headers: {
    accept?: string | null;
    authorization?: string | null;
    origin?: string | null;
  };
  body?: string | null;
  ip?: string | null;
}

export interface McpHttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface McpDeps {
  search: (args: Record<string, unknown>) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
  getDetailer: (slug: string) => Promise<Record<string, unknown> | null>;
  requestQuote: (
    args: Record<string, unknown>,
    ctx: { ip: string },
  ) => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string; retry_after_seconds?: number }>;
  token?: string | null;
  quotesEnabled?: boolean;
  allowedOrigins?: string[];
}

const DEFAULT_ORIGINS = [
  'https://directory.shinyjets.com',
  'https://www.directory.shinyjets.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function jsonRpc(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function tokenMatches(expected: string, header: string | null | undefined): boolean {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) return false;
  const got = Buffer.from(match[1]);
  const exp = Buffer.from(expected);
  if (got.length !== exp.length) return false;
  return timingSafeEqual(got, exp);
}

function originAllowed(origin: string | null | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}

function accepts(header: string | null | undefined, type: string): boolean {
  if (!header) return type === 'application/json';
  return header.split(',').some((part) => {
    const media = part.split(';')[0].trim().toLowerCase();
    return media === type || media === '*/*';
  });
}

function toolResult(data: Record<string, unknown>, isError = false) {
  const text = JSON.stringify(data, null, 2);
  if (isError) return { content: [{ type: 'text', text }], isError: true };
  return { content: [{ type: 'text', text }], structuredContent: data, isError: false };
}

function asArgs(params: unknown): Record<string, unknown> | null {
  if (!params || typeof params !== 'object') return null;
  const args = (params as { arguments?: unknown }).arguments;
  if (args == null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

export function createMcpHandler(deps: McpDeps) {
  const allowed = Array.from(new Set([...DEFAULT_ORIGINS, ...(deps.allowedOrigins || [])]));
  const quotesEnabled = deps.quotesEnabled !== false;

  return async function handleMcp(request: McpHttpRequest): Promise<McpHttpResult> {
    const baseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': request.headers.origin && allowed.includes(request.headers.origin) ? request.headers.origin : 'https://directory.shinyjets.com',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id',
      'Access-Control-Expose-Headers': 'Mcp-Protocol-Version',
      'Cache-Control': 'no-store',
      'Mcp-Protocol-Version': DEFAULT_PROTOCOL,
    };

    const finish = (status: number, payload: unknown, stream = false): McpHttpResult => {
      if (status === 202) return { status, headers: baseHeaders, body: '' };
      if (status === 204) return { status, headers: baseHeaders, body: '' };
      if (stream) {
        return {
          status,
          headers: { ...baseHeaders, 'Content-Type': 'text/event-stream' },
          body: `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        };
      }
      return {
        status,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };
    };

    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return finish(204, null);
    if (method === 'GET' || method === 'DELETE') {
      return finish(405, jsonRpcError(null, -32601, 'This server is stateless. Send JSON-RPC requests with POST.'));
    }
    if (method !== 'POST') return finish(405, jsonRpcError(null, -32601, 'Method not allowed.'));

    if (!originAllowed(request.headers.origin, allowed)) {
      return finish(403, jsonRpcError(null, -32000, 'Origin is not allowed.'));
    }

    const accept = request.headers.accept;
    const wantJson = accepts(accept, 'application/json');
    const wantStream = Boolean(accept && accepts(accept, 'text/event-stream') && !wantJson);
    if (accept && !wantJson && !accepts(accept, 'text/event-stream')) {
      return finish(406, jsonRpcError(null, -32000, 'Accept must include application/json or text/event-stream.'));
    }

    if (deps.token && !tokenMatches(deps.token, request.headers.authorization)) {
      return finish(401, jsonRpcError(null, -32001, 'Unauthorized.'));
    }

    const raw = request.body || '';
    if (raw.length > 32_000) return finish(413, jsonRpcError(null, -32000, 'Request body is too large.'));

    let message: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
    try {
      message = JSON.parse(raw) as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
    } catch {
      return finish(400, jsonRpcError(null, -32700, 'Parse error.'));
    }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return finish(400, jsonRpcError(message?.id ?? null, -32600, 'Invalid Request.'));
    }

    const id = message.id;
    const isNotification = !Object.prototype.hasOwnProperty.call(message, 'id');
    if (isNotification) return finish(202, null);

    const respond = (status: number, payload: unknown) => finish(status, payload, wantStream);

    try {
      if (message.method === 'initialize') {
        const params = (message.params || {}) as { protocolVersion?: string };
        const requested = params.protocolVersion || DEFAULT_PROTOCOL;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL;
        baseHeaders['Mcp-Protocol-Version'] = protocolVersion;
        return respond(
          200,
          jsonRpc(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            instructions: SERVER_INSTRUCTIONS,
          }),
        );
      }

      if (message.method === 'ping') return respond(200, jsonRpc(id, {}));

      if (message.method === 'tools/list') {
        return respond(200, jsonRpc(id, {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
          })),
        }));
      }

      if (message.method === 'resources/list' || message.method === 'prompts/list') {
        const key = message.method === 'resources/list' ? 'resources' : 'prompts';
        return respond(200, jsonRpc(id, { [key]: [] }));
      }

      if (message.method === 'tools/call') {
        const params = (message.params || {}) as { name?: string };
        const name = params.name as ToolName | undefined;
        const args = asArgs(message.params);
        if (!name || !TOOLS.some((tool) => tool.name === name) || !args) {
          return respond(200, jsonRpc(id, toolResult({ error: 'Unknown tool. Use search_detailers, get_detailer, or request_quote.' }, true)));
        }
        if (name === 'search_detailers') {
          const result = await deps.search(args);
          if (!result.ok) return respond(200, jsonRpc(id, toolResult({ error: result.error }, true)));
          return respond(200, jsonRpc(id, toolResult(result.data)));
        }
        if (name === 'get_detailer') {
          if (typeof args.slug !== 'string' || !args.slug.trim()) {
            return respond(200, jsonRpc(id, toolResult({ error: 'slug is required.' }, true)));
          }
          const detailer = await deps.getDetailer(args.slug);
          if (!detailer) return respond(200, jsonRpc(id, toolResult({ error: 'No listed detailer with that slug.' }, true)));
          return respond(200, jsonRpc(id, toolResult(detailer)));
        }
        if (!quotesEnabled) {
          return respond(200, jsonRpc(id, toolResult({ error: 'Quote requests are disabled until the connector token is configured.' }, true)));
        }
        const quoted = await deps.requestQuote(args, { ip: request.ip || 'unknown' });
        if (!quoted.ok) {
          return respond(200, jsonRpc(id, toolResult({ error: quoted.error, retry_after_seconds: quoted.retry_after_seconds }, true)));
        }
        return respond(200, jsonRpc(id, toolResult(quoted.data)));
      }

      return respond(200, jsonRpcError(id, -32601, `Method not found: ${message.method}`));
    } catch (err) {
      console.error('[mcp] tool failed:', err instanceof Error ? err.message : err);
      return respond(200, jsonRpc(id, toolResult({ error: 'The connector could not complete that request.' }, true)));
    }
  };
}
