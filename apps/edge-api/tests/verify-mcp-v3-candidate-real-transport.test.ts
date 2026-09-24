/**
 * Real MCP transport/SDK execution qualification for all four v3
 * candidate services (predeployment checkpoint, SUN-1219/metadata-vcm
 * effort, Step 2).
 *
 * This is NOT a REST-only or source-inspection check. It drives every
 * call through the real `@modelcontextprotocol/client`
 * `StreamableHTTPClientTransport`, doing a real JSON-RPC
 * `initialize` -> `tools/list` -> `tools/call` round trip against the
 * real mounted `/mcp` Hono route (`app.fetch`), exactly the same client
 * machinery `mcp-route.test.ts` already uses for the v2 services. The
 * MCP adapter (`apps/edge-api/src/control-plane/mcp/x402-mcp-adapter.ts`)
 * then delegates to the exact same real v3 candidate route functions
 * (`companyEvidenceGraphV3CandidateRoute`, etc. from
 * `production-public-v3-candidate-routes.ts`) that real REST callers
 * hit -- confirmed by reading `apps/edge-api/src/routes/mcp.ts`, which
 * wires those same functions in as MCP `handlers`.
 *
 * Scope/limits (reported honestly, not silently downgraded):
 *  - No `BUYER_AUTHORIZED_V3_ROUTE_ENABLED` / CDP-route-flag env is set,
 *    so every candidate route fails closed before touching payment or
 *    real CDP evidence -- the same "no useful execution without
 *    configuration AND payment" property `mcp-route.test.ts` already
 *    proves for v2. This DOES prove real transport plumbing reaches the
 *    real v3 route function (never a stub, never "service_not_wired").
 *    It does NOT prove a full paid v3 execution over the MCP wire --
 *    that would require real CDP production credentials and is out of
 *    scope for local-only predeployment work (see HARD BOUNDARIES).
 *  - A full paid MCP v3 round trip (payment payload + settlement) is
 *    NOT_TESTABLE_WITH_CURRENT_FIXTURE without real CDP mainnet
 *    credentials, which this checkpoint is explicitly forbidden from
 *    using.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { frozenInputExample, type SiteborneServiceId } from '@siteborne/protocol-x402';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(envOverrides: Record<string, string> = {}) {
  const client = new Client(
    { name: 'edge-api-mcp-v3-transport-test', version: '1.0.0' },
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

const V3_TOOLS: ReadonlyArray<{ tool: string; serviceId: SiteborneServiceId }> = [
  {
    tool: 'siteborne_build_company_evidence_graph_v3_candidate',
    serviceId: 'company_evidence_graph.v3',
  },
  {
    tool: 'siteborne_retrieve_verified_web_context_v3_candidate',
    serviceId: 'web_context_verified.v3',
  },
  {
    tool: 'siteborne_extract_document_evidence_json_v3_candidate',
    serviceId: 'document_evidence_json.v3',
  },
  { tool: 'siteborne_verify_agent_output_v3_candidate', serviceId: 'verify_agent_output.v3' },
];

describe('real MCP transport execution of the four v3 candidate services', () => {
  it('lists all four v3 candidate tools over a real initialize/tools-list round trip', async () => {
    const client = await connect();
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    for (const { tool } of V3_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  it.each(V3_TOOLS)(
    'reaches the real $serviceId candidate route through the real MCP transport (fails closed, never a stub/unwired response)',
    async ({ tool, serviceId }) => {
      const client = await connect();
      const result = await client.callTool({
        name: tool,
        arguments: frozenInputExample(serviceId) as Record<string, unknown>,
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content).toHaveLength(1);
      expect(content[0]!.type).toBe('text');
      expect(() => JSON.parse(content[0]!.text)).not.toThrow();
      const parsed = JSON.parse(content[0]!.text) as { code?: string };
      // Proves real route-function delegation: a genuinely unwired
      // adapter would return code === 'service_not_wired'. Anything else
      // (e.g. a candidate-gate/auth/config rejection code) proves the
      // call reached the real v3 candidate route function itself.
      expect(parsed.code).toBeDefined();
      expect(parsed.code).not.toBe('service_not_wired');
    }
  );
});
