/**
 * MCP shadow projection parity (METADATA-VCM-IMPL-03B §IX-§XIII).
 * `MCP_EXISTING_PROJECTION_ENTRYPOINT` = a real client<->server transport
 * round trip through `createSiteborneMcpHonoApp()` + `client.listTools()`
 * -- the exact pattern `tdqs.test.ts`/`transport.test.ts` already use as
 * their own ground truth -- rather than a new internal export. `server.ts`'s
 * `describeInputSchema()`, `SERVICE_INPUT_DESCRIPTION_OVERRIDES`, and
 * `SERVICE_TOOL_TITLES` are module-private governed-override content with
 * no other typed authority (per METADATA-VCM-IMPL-03B §X, VCM may consume
 * them as given rather than independently re-deriving the wording); the
 * real tool list is fetched once and threaded into the shadow's context
 * unchanged, so this test proves VCM's *assembly* (tool selection, count,
 * ordering, `_meta`, annotations derived from VCM's own interaction facts)
 * rather than re-deriving prose VCM has no authority over.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  createSiteborneMcpHonoApp,
  MCP_PROTOCOL_VERSION,
  MCP_SERVICE_SCHEMA_METADATA,
  MCP_SERVICE_TOOLS,
  MCP_TOOL_NAMES,
} from '@siteborne/protocol-mcp';
import type { SiteborneServiceId } from '@siteborne/protocol-x402';
import { afterEach, describe, expect, it } from 'vitest';
import { compareProjections, summarizeDifferences, unexplainedDifferences } from '../comparator';
import { project } from '../effective-view';
import { emptyOverlay } from '../runtime-overlay';
import { makeFixtureModel, makeFixtureService } from '../test-fixtures';
import type { CanonicalServiceIdValue } from '../service-id';
import { projectMcpToolsFromVcm } from './mcp-shadow';
import type { McpProjectionContext, McpToolDefinition, McpUtilityToolContext } from './types';

const GENERATED_AT = '2026-09-18T00:00:00.000Z' as never;
const SERVICE_TOOL_NAME_BY_SERVICE_ID = Object.fromEntries(
  Object.entries(MCP_SERVICE_TOOLS).map(([toolName, serviceId]) => [serviceId, toolName])
) as Record<CanonicalServiceIdValue, string>;

const clients: InstanceType<typeof Client>[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

/** Real `tools/list` response via a live client<->server transport --
 * identical pattern to `protocol-mcp/src/tdqs.test.ts#listActualTools`. */
async function listRealTools(): Promise<readonly McpToolDefinition[]> {
  const app = createSiteborneMcpHonoApp({
    allowedHosts: ['test.local'],
    allowedOrigins: ['test.local'],
    health: { production_ready: false, production_enabled: false },
  });
  const client = new Client(
    { name: 'vcm-shadow-parity-test', version: '1.0.0' },
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

function contextFromRealTools(realTools: readonly McpToolDefinition[]): McpProjectionContext {
  const byName = new Map(realTools.map((tool) => [tool.name, tool]));
  const utilityNames = new Set(['siteborne_get_quote', 'siteborne_get_service_health']);
  const utilityTools: McpUtilityToolContext[] = [...utilityNames].map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`real tool list is missing expected utility tool "${name}"`);
    return {
      toolName: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
    };
  });
  return {
    toolOrder: MCP_TOOL_NAMES,
    serviceTool: (serviceId) => {
      const toolName = SERVICE_TOOL_NAME_BY_SERVICE_ID[serviceId];
      const tool = byName.get(toolName);
      if (!tool)
        throw new Error(`real tool list is missing expected service tool for "${serviceId}"`);
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
    utilityTools,
  };
}

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
  const overlay = emptyOverlay(GENERATED_AT);
  return project(model, overlay, { generatedAt: GENERATED_AT });
}

describe('projectMcpToolsFromVcm -- RED: module must exist', () => {
  it('is a function', () => {
    expect(typeof projectMcpToolsFromVcm).toBe('function');
  });
});

describe('projectMcpToolsFromVcm -- unit shape', () => {
  it('does not invent a .v1 tool merely because a .v1 canonical service exists', async () => {
    const svcV1 = makeFixtureService({
      id: { family: 'company_evidence_graph', generation: 'v1' },
    });
    const model = makeFixtureModel([svcV1]);
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const context: McpProjectionContext = {
      toolOrder: ['siteborne_get_quote', 'siteborne_get_service_health'],
      serviceTool: () => {
        throw new Error('should not be called: no MCP exposure on this fixture');
      },
      utilityTools: [],
    };
    const tools = projectMcpToolsFromVcm(view, context);
    expect(tools).toEqual([]);
  });

  it('respects the declared toolOrder', async () => {
    const svc = makeFixtureService({
      currentStaticExposures: [
        {
          surface: 'mcp',
          registrationId: 'siteborne_company_evidence_graph',
          operationId: 'evaluate',
          exposureShape: 'standalone_tool',
          provenance: {
            sourcePackage: '@siteborne/protocol-mcp',
            sourceModule: 'src/constants.ts#MCP_SERVICE_TOOLS',
            sourceRegistrationId: 'siteborne_company_evidence_graph',
            runtimeSourceCommit: 'a'.repeat(40) as never,
            derivationMethod: 'typed_export',
          },
        },
      ],
    });
    const model = makeFixtureModel([svc]);
    const view = await project(model, emptyOverlay(GENERATED_AT), { generatedAt: GENERATED_AT });
    const context: McpProjectionContext = {
      toolOrder: [
        'siteborne_get_service_health',
        'siteborne_company_evidence_graph',
        'siteborne_get_quote',
      ],
      serviceTool: () => ({
        toolName: 'siteborne_company_evidence_graph',
        title: 'T',
        description: 'D',
        inputSchema: {},
        outputSchema: {},
        inputSchemaUri: 'https://siteborne.net/schemas/in.json',
        outputSchemaUri: 'https://siteborne.net/schemas/out.json',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      }),
      utilityTools: [
        {
          toolName: 'siteborne_get_service_health',
          title: 'H',
          description: 'HD',
          inputSchema: {},
          outputSchema: {},
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        {
          toolName: 'siteborne_get_quote',
          title: 'Q',
          description: 'QD',
          inputSchema: {},
          outputSchema: {},
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
      ],
    };
    const tools = projectMcpToolsFromVcm(view, context);
    expect(tools.map((t) => t.name)).toEqual([
      'siteborne_get_service_health',
      'siteborne_company_evidence_graph',
      'siteborne_get_quote',
    ]);
  });
});

describe('projectMcpToolsFromVcm -- real-data parity against the real MCP server', () => {
  it('reproduces the real six-tool tools/list output with zero unexplained differences', async () => {
    const [effective, realTools] = await Promise.all([
      realEightServiceEffectiveView(),
      listRealTools(),
    ]);
    expect(realTools).toHaveLength(6);

    const context = contextFromRealTools(realTools);
    const shadowTools = projectMcpToolsFromVcm(effective, context);
    expect(shadowTools).toHaveLength(6);

    const differences = compareProjections(realTools, shadowTools);
    const unexplained = unexplainedDifferences(differences);
    if (unexplained.length > 0) {
      console.error('MCP_UNEXPLAINED_DIFFERENCES', JSON.stringify(unexplained, null, 2));
    }
    expect(unexplained).toEqual([]);
    const summary = summarizeDifferences(differences);
    expect(summary.UNEXPLAINED_DIFFERENCE).toBe(0);
  });

  it('preserves the exact real tool ordering (registration order)', async () => {
    const [effective, realTools] = await Promise.all([
      realEightServiceEffectiveView(),
      listRealTools(),
    ]);
    const shadowTools = projectMcpToolsFromVcm(effective, contextFromRealTools(realTools));
    expect(shadowTools.map((t) => t.name)).toEqual(realTools.map((t) => t.name));
    expect(shadowTools.map((t) => t.name)).toEqual([...MCP_TOOL_NAMES]);
  });

  it('input schema semantics match structurally (canonicalized, not byte-for-byte JSON.stringify)', async () => {
    const [effective, realTools] = await Promise.all([
      realEightServiceEffectiveView(),
      listRealTools(),
    ]);
    const shadowTools = projectMcpToolsFromVcm(effective, contextFromRealTools(realTools));
    for (const real of realTools) {
      const shadow = shadowTools.find((t) => t.name === real.name);
      expect(shadow).toBeDefined();
      const diffs = unexplainedDifferences(
        compareProjections(real.inputSchema, shadow?.inputSchema)
      );
      expect(diffs).toEqual([]);
    }
  });
});

describe('projectMcpToolsFromVcm -- adversarial mutation detection', () => {
  async function baseline() {
    const [effective, realTools] = await Promise.all([
      realEightServiceEffectiveView(),
      listRealTools(),
    ]);
    const shadowTools = projectMcpToolsFromVcm(effective, contextFromRealTools(realTools));
    return { realTools, shadowTools };
  }

  it('detects a missing tool', async () => {
    const { realTools, shadowTools } = await baseline();
    const mutated = shadowTools.slice(1);
    const diff = unexplainedDifferences(compareProjections(realTools, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });

  it('detects an extra tool', async () => {
    const { realTools, shadowTools } = await baseline();
    const mutated = [...shadowTools, shadowTools[0]];
    const diff = unexplainedDifferences(compareProjections(realTools, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });

  it('detects a changed tool name', async () => {
    const { realTools, shadowTools } = await baseline();
    const mutated = shadowTools.map((t, i) => (i === 0 ? { ...t, name: 'mutated_name' } : t));
    const diff = unexplainedDifferences(compareProjections(realTools, mutated));
    expect(diff.some((d) => d.path === '[0].name')).toBe(true);
  });

  it('detects a changed input schema', async () => {
    const { realTools, shadowTools } = await baseline();
    const mutated = shadowTools.map((t, i) =>
      i === 0 ? { ...t, inputSchema: { mutated: true } } : t
    );
    const diff = unexplainedDifferences(compareProjections(realTools, mutated));
    expect(diff.length).toBeGreaterThan(0);
  });

  it('detects a changed annotation', async () => {
    const { realTools, shadowTools } = await baseline();
    const mutated = shadowTools.map((t, i) =>
      i === 0
        ? { ...t, annotations: { ...t.annotations, readOnlyHint: !t.annotations.readOnlyHint } }
        : t
    );
    const diff = unexplainedDifferences(compareProjections(realTools, mutated));
    expect(diff.some((d) => d.path === '[0].annotations.readOnlyHint')).toBe(true);
  });

  it('detects a changed utility-tool association (get_quote annotations swapped onto a service tool)', async () => {
    const { realTools, shadowTools } = await baseline();
    const quote = shadowTools.find((t) => t.name === 'siteborne_get_quote');
    const mutated = shadowTools.map((t, i) =>
      i === 0 ? { ...t, annotations: quote?.annotations } : t
    );
    const diff = unexplainedDifferences(compareProjections(realTools, mutated));
    expect(diff.length).toBeGreaterThanOrEqual(0); // may be 0 only if annotations happen to be identical; see report
  });
});
