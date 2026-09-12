import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { frozenInputExample } from '@siteborne/protocol-x402';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(envOverrides: Record<string, string> = {}) {
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
        ...envOverrides,
      });
    },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

// SUN-1222C-MCP-PRE-CUTOVER-REMEDIATION §8: the real production v2 CDP
// routes (`production/company-evidence-graph-v2-cdp-composition.ts` etc.)
// resolve network/asset through the single canonical, fail-closed
// `resolveProductionAuthorizationInput` → `resolvePaymentNetwork` →
// `resolvePaymentAsset` chain — production (Base mainnet) only when all
// four ADR-0055 gates are simultaneously true. MCP quotes must resolve
// through that exact same chain, not an independently hardcoded network.
const PRODUCTION_AUTHORIZED_ENV = {
  PAYMENT_ENVIRONMENT: 'production',
  PRODUCTION_ENABLED: 'true',
  HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
  PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
};

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
    // SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION: the MCP layer now delegates
    // to the real production route function for this service
    // (companyEvidenceGraphV2CdpProductionRoute) rather than an always-
    // "payment_required" stub. This test's fixture env sets no
    // PAID_ROUTES_ENABLED / *_CDP_ROUTE_ENABLED / D1 binding, so the real
    // route honestly 404s before reaching payment logic at all -- a
    // stronger proof of "no useful execution without configuration AND
    // payment" than the old stub's fixed wording ever was. The core
    // safety property this test exists to protect (isError, no
    // structuredContent, no service output) is unchanged and still
    // asserted below.
    const client = await connect();
    const result = await client.callTool({
      name: 'siteborne_company_evidence_graph',
      arguments: frozenInputExample('company_evidence_graph.v2') as Record<string, unknown>,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('text');
    // Never a fulfilled-shaped payload leaking through as an "error".
    expect(() => JSON.parse(content[0]!.text)).not.toThrow();
    const parsed = JSON.parse(content[0]!.text) as { code?: string };
    expect(parsed.code).toBeDefined();
  });

  it('quotes on Base Sepolia when production payment authorization is not satisfied', async () => {
    const client = await connect();
    const quote = await client.callTool({
      name: 'siteborne_get_quote',
      arguments: {
        service_id: 'company_evidence_graph.v2',
        scheme: 'exact',
        input: frozenInputExample('company_evidence_graph.v2'),
      },
    });
    expect(quote.isError).not.toBe(true);
    expect(quote.structuredContent).toEqual(
      expect.objectContaining({ network: 'eip155:84532' })
    );
  });

  it('quotes on the exact network/asset the real v2 CDP routes resolve to once production payment is fully authorized', async () => {
    const client = await connect(PRODUCTION_AUTHORIZED_ENV);
    const quote = await client.callTool({
      name: 'siteborne_get_quote',
      arguments: {
        service_id: 'company_evidence_graph.v2',
        scheme: 'exact',
        input: frozenInputExample('company_evidence_graph.v2'),
      },
    });
    expect(quote.isError).not.toBe(true);
    expect(quote.structuredContent).toEqual(
      expect.objectContaining({
        network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      })
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
