import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMcpHandler, type McpDeps, type McpHttpRequest } from '../lib/mcp/server';
import { TOOLS } from '../lib/mcp/tools';

function deps(overrides: Partial<McpDeps> = {}): McpDeps {
  return {
    async search() {
      return { ok: true, data: { detailers: [{ slug: 'shiny-jets', sponsored: false }], rank: 'factual' } };
    },
    async getDetailer(slug: string) {
      return slug === 'shiny-jets' ? { slug, company: 'Shiny Jets', sponsored: false } : null;
    },
    async requestQuote() {
      return { ok: true, data: { status: 'requested', lead_id: 'lead-1', duplicate: false } };
    },
    quotesEnabled: true,
    ...overrides,
  };
}

async function post(handler: ReturnType<typeof createMcpHandler>, body: unknown, headers: McpHttpRequest['headers'] = {}) {
  return handler({
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
    ip: '203.0.113.10',
  });
}

test('tool definitions classify reads and the sensitive quote write', () => {
  const byName = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool]));
  assert.equal(byName.search_detailers.classification, 'read');
  assert.equal(byName.search_detailers.annotations.readOnlyHint, true);
  assert.equal(byName.get_detailer.classification, 'read');
  assert.equal(byName.get_detailer.annotations.readOnlyHint, true);
  assert.equal(byName.request_quote.classification, 'write');
  assert.equal(byName.request_quote.sensitive, true);
  assert.equal(byName.request_quote.annotations.readOnlyHint, false);
  assert.match(byName.request_quote.description, /not a price/i);
});

test('initialize and tools/list advertise the directory connector', async () => {
  const handler = createMcpHandler(deps());
  const init = await post(handler, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'muse', version: '1' } },
  });
  assert.equal(init.status, 200);
  const initBody = JSON.parse(init.body);
  assert.equal(initBody.result.protocolVersion, '2025-06-18');
  assert.equal(initBody.result.serverInfo.name, 'shiny-jets-directory');
  assert.match(initBody.result.instructions, /Never invent/);

  const list = await post(handler, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = JSON.parse(list.body).result.tools.map((tool: { name: string; annotations: { readOnlyHint: boolean } }) => ({
    name: tool.name,
    readOnlyHint: tool.annotations.readOnlyHint,
  }));
  assert.deepEqual(names, [
    { name: 'search_detailers', readOnlyHint: true },
    { name: 'get_detailer', readOnlyHint: true },
    { name: 'request_quote', readOnlyHint: false },
  ]);
});

test('tools/call searches and refuses quote creation when quotes are disabled', async () => {
  let wrote = 0;
  const handler = createMcpHandler(deps({
    quotesEnabled: false,
    async requestQuote() {
      wrote += 1;
      return { ok: true, data: { status: 'requested' } };
    },
  }));
  const search = await post(handler, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'search_detailers', arguments: { location: 'KTEB' } },
  });
  const searchBody = JSON.parse(search.body);
  assert.equal(searchBody.result.isError, false);
  assert.equal(searchBody.result.structuredContent.detailers[0].sponsored, false);

  const quote = await post(handler, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'request_quote', arguments: { slug: 'shiny-jets' } },
  });
  const quoteBody = JSON.parse(quote.body);
  assert.equal(quoteBody.result.isError, true);
  assert.match(quoteBody.result.content[0].text, /disabled/);
  assert.equal(wrote, 0);
});

test('a configured token is required and a quote call can create a lead', async () => {
  const handler = createMcpHandler(deps({ token: 'secret-token', quotesEnabled: true }));
  const denied = await post(handler, { jsonrpc: '2.0', id: 5, method: 'tools/list' });
  assert.equal(denied.status, 401);

  const quoted = await post(
    handler,
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'request_quote', arguments: { slug: 'shiny-jets', aircraft: 'Cessna 172' } },
    },
    { authorization: 'Bearer secret-token' },
  );
  assert.equal(quoted.status, 200);
  const body = JSON.parse(quoted.body);
  assert.equal(body.result.structuredContent.status, 'requested');
  assert.equal(body.result.structuredContent.lead_id, 'lead-1');
});

test('notifications, bad origins, and GET are rejected or acknowledged', async () => {
  const handler = createMcpHandler(deps());
  const note = await post(handler, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.status, 202);
  assert.equal(note.body, '');

  const evil = await post(handler, { jsonrpc: '2.0', id: 7, method: 'ping' }, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);

  const get = await handler({ method: 'GET', headers: {}, body: '', ip: '203.0.113.10' });
  assert.equal(get.status, 405);
});
