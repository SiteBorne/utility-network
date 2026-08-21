import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { frozenInputExample } from '@siteborne/protocol-x402';
import { afterEach, describe, expect, it } from 'vitest';
import app from '../src/index';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect() {
  const client = new Client(
    { name: 'edge-api-mcp-route-test', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Host', 'test.local');
      return app.fetch(new Request(input, { ...init, headers }), {
        SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
      });
    },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

describe('edge-api /mcp route', () => {
  it('mounts the modern MCP endpoint with exactly six tools', async () => {
    const client = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [
        'siteborne_company_evidence_graph',
        'siteborne_web_context_verified',
        'siteborne_document_evidence_json',
        'siteborne_verify_agent_output',
        'siteborne_get_quote',
        'siteborne_get_service_health',
      ].sort()
    );
  });

  it('does not expose useful service execution without the paid boundary', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'siteborne_company_evidence_graph',
      arguments: frozenInputExample('company_evidence_graph.v1') as Record<string, unknown>,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('payment_required'),
        }),
      ])
    );
  });

  it('keeps production state false on the MCP health tool', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'siteborne_get_service_health',
      arguments: {},
    });
    expect(result.structuredContent).toEqual(
      expect.objectContaining({ production_ready: false, production_enabled: false })
    );
  });

  it('rejects an oversized MCP request before protocol dispatch', async () => {
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(10 * 1024 * 1024 + 1),
        Host: 'test.local',
      },
      body: '{}',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
  });

  it('measures the MCP body and rejects an oversized request even when Content-Length understates it', async () => {
    const oversized = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'siteborne_get_quote',
        arguments: { padding: 'x'.repeat(1024 * 1024) },
      },
    });
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '1',
        Host: 'test.local',
      },
      body: oversized,
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
  });
});
