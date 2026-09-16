/**
 * Offline digests of the shadow A2A/MCP projections (METADATA-VCM-IMPL-03B
 * §XX), reusing the existing generic `computeProjectionDigest` primitive
 * (digests.ts) -- not published or injected into any public metadata.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  createSiteborneMcpHonoApp,
  MCP_PROTOCOL_VERSION,
  MCP_SERVICE_SCHEMA_METADATA,
  MCP_SERVICE_TOOLS,
  MCP_TOOL_NAMES,
} from '@siteborne/protocol-mcp';
import {
  BAZAAR_PAYMENT_POLICY,
  resolveServiceRoute,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import {
  A2A_PROTOCOL_VERSION,
  buildUnsignedSiteborneAgentCard,
  SITEBORNE_A2A_INTERFACE_URL,
  SITEBORNE_A2A_ORIGIN,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
} from '@siteborne/protocol-a2a';
import { afterEach, describe, expect, it } from 'vitest';
import { computeProjectionDigest } from '../digests';
import { project } from '../effective-view';
import { emptyOverlay } from '../runtime-overlay';
import type { CanonicalServiceIdValue } from '../service-id';
import { projectA2aFromVcm } from './a2a-shadow';
import { projectMcpToolsFromVcm } from './mcp-shadow';
import type { A2aProjectionContext, McpProjectionContext, McpToolDefinition } from './types';

const GENERATED_AT = '2026-09-18T00:00:00.000Z' as never;
const SERVICE_TOOL_NAME_BY_SERVICE_ID = Object.fromEntries(
  Object.entries(MCP_SERVICE_TOOLS).map(([toolName, serviceId]) => [serviceId, toolName])
) as Record<CanonicalServiceIdValue, string>;

async function realEightServiceEffectiveView() {
  const { legacyRegistryToVCM } = await import('../legacy/import-registry');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const registryDir = path.resolve(__dirname, '../../../../registry/services');
  const files = fs
    .readdirSync(registryDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const legacyFiles = files.map((file) =>
    JSON.parse(fs.readFileSync(path.join(registryDir, file), 'utf8'))
  );
  const model = await legacyRegistryToVCM(legacyFiles, {
    vcmSchemaVersion: '0.3.0',
    vcmReleaseVersion: '0.1.0',
    runtimeSourceCommit: 'a'.repeat(40),
    compiledAt: GENERATED_AT,
  });
  return project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
}

function a2aContext(): A2aProjectionContext {
  return {
    agentName: 'SITEBORNE Utility Network',
    agentDescription:
      'Four bounded evidence, context, document, and verification services with PCC receipts and x402 payment enforcement.',
    agentVersion: '1.0.0',
    documentationUrl: 'https://siteborne.net/docs/a2a',
    provider: { organization: 'SITEBORNE', url: 'https://siteborne.com' },
    interfaceUrl: SITEBORNE_A2A_INTERFACE_URL,
    protocolVersion: A2A_PROTOCOL_VERSION,
    x402ExtensionUri: SITEBORNE_X402_EXTENSION_URI,
    x402Version: 2,
    resourceOrigin: SITEBORNE_A2A_ORIGIN,
    serviceOrder: SITEBORNE_SERVICE_IDS as readonly CanonicalServiceIdValue[],
    resourcePath: (serviceId) => resolveServiceRoute(serviceId as SiteborneServiceId).path,
    scheme: (serviceId) => BAZAAR_PAYMENT_POLICY[serviceId as SiteborneServiceId].scheme,
    effectiveProductionStatusByServiceId: {},
    mtlsSecurityScheme: null,
  };
}

const clients: InstanceType<typeof Client>[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function listRealTools(): Promise<readonly McpToolDefinition[]> {
  const app = createSiteborneMcpHonoApp({
    allowedHosts: ['test.local'],
    allowedOrigins: ['test.local'],
    health: { production_ready: false, production_enabled: false },
  });
  const client = new Client(
    { name: 'vcm-digest-test', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } }
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Host', 'test.local');
        return app.fetch(new Request(input, { ...init, headers }));
      },
    })
  );
  const { tools } = await client.listTools();
  return tools as unknown as McpToolDefinition[];
}

function mcpContext(realTools: readonly McpToolDefinition[]): McpProjectionContext {
  const byName = new Map(realTools.map((tool) => [tool.name, tool]));
  return {
    toolOrder: MCP_TOOL_NAMES,
    serviceTool: (serviceId) => {
      const toolName = SERVICE_TOOL_NAME_BY_SERVICE_ID[serviceId];
      const tool = byName.get(toolName);
      if (!tool) throw new Error(`missing real tool for "${serviceId}"`);
      const schemaMeta = MCP_SERVICE_SCHEMA_METADATA[serviceId as SiteborneServiceId];
      return {
        toolName,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        inputSchemaUri: schemaMeta.input_uri,
        outputSchemaUri: schemaMeta.output_uri,
        annotations: tool.annotations,
      };
    },
    utilityTools: ['siteborne_get_quote', 'siteborne_get_service_health'].map((name) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`missing real utility tool "${name}"`);
      return {
        toolName: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      };
    }),
  };
}

describe('shadow projection digests', () => {
  it('SHADOW_A2A_PROJECTION_DIGEST is a valid sha256 digest, stable across repeated calls', async () => {
    const effective = await realEightServiceEffectiveView();
    const card = projectA2aFromVcm(effective, a2aContext());
    const first = await computeProjectionDigest(card);
    const second = await computeProjectionDigest(projectA2aFromVcm(effective, a2aContext()));
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });

  it('SHADOW_MCP_PROJECTION_DIGEST is a valid sha256 digest, stable across repeated calls', async () => {
    const [effective, realTools] = await Promise.all([
      realEightServiceEffectiveView(),
      listRealTools(),
    ]);
    const context = mcpContext(realTools);
    const first = await computeProjectionDigest(projectMcpToolsFromVcm(effective, context));
    const second = await computeProjectionDigest(projectMcpToolsFromVcm(effective, context));
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });

  it('normalized existing A2A digest equals normalized shadow A2A digest (semantic-content digest; both pre-signature)', async () => {
    const effective = await realEightServiceEffectiveView();
    const existing = buildUnsignedSiteborneAgentCard();
    const shadow = projectA2aFromVcm(effective, a2aContext());
    // `signatures` is `[]` on both sides pre-signing; no normalization is
    // needed beyond digesting the full unsigned content directly.
    const existingDigest = await computeProjectionDigest(existing);
    const shadowDigest = await computeProjectionDigest(shadow);
    expect(existingDigest).toBe(shadowDigest);
  });

  it('normalized existing MCP digest equals normalized shadow MCP digest', async () => {
    const [effective, realTools] = await Promise.all([
      realEightServiceEffectiveView(),
      listRealTools(),
    ]);
    const shadow = projectMcpToolsFromVcm(effective, mcpContext(realTools));
    const existingDigest = await computeProjectionDigest(realTools);
    const shadowDigest = await computeProjectionDigest(shadow);
    expect(existingDigest).toBe(shadowDigest);
  });
});
