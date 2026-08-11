import fc from 'fast-check';
import { frozenInputExample } from '@siteborne/protocol-x402';
import { describe, expect, it, vi } from 'vitest';
import {
  MCP_PROTOCOL_VERSION,
  MCP_TOOL_NAMES,
  createSiteborneMcpHonoApp,
  type McpServiceExecutionBoundary,
} from './index';

describe('MCP mirrored-header adversarial properties', () => {
  it('never dispatches a tools/call when a nonmatching tool name is mirrored', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 64 }).filter((name) => !MCP_TOOL_NAMES.includes(name)),
        async (mismatchedName) => {
          const execute = vi.fn();
          const boundary: McpServiceExecutionBoundary = { execute };
          const app = createSiteborneMcpHonoApp({
            serviceBoundary: boundary,
            quote: {
              network: 'eip155:84532',
              asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7c',
              payee: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
              now: () => new Date('2026-08-10T12:00:00.000Z'),
            },
            health: { production_ready: false, production_enabled: false },
            allowedHosts: ['test.local'],
            allowedOrigins: ['test.local'],
          });
          const bodyName = 'siteborne_company_evidence_graph';
          const body = {
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: {
              name: bodyName,
              arguments: frozenInputExample('company_evidence_graph.v1'),
              _meta: {
                'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
                'io.modelcontextprotocol/clientInfo': { name: 'property-test', version: '1' },
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          };
          const response = await app.request('/mcp', {
            method: 'POST',
            headers: {
              Accept: 'application/json, text/event-stream',
              'Content-Type': 'application/json',
              'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
              'Mcp-Method': 'tools/call',
              'Mcp-Name': mismatchedName,
              Host: 'test.local',
            },
            body: JSON.stringify(body),
          });

          expect(response.status).toBe(400);
          expect(execute).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });
});
