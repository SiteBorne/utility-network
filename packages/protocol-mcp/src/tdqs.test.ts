import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { resolveServiceMaxPriceUsd } from '@siteborne/pricing';
import { fromJsonSchema, type JsonSchemaType } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVICE_INPUT_SCHEMAS,
  MCP_SERVICE_TOOLS,
  MCP_TOOL_NAMES,
  createSiteborneMcpHonoApp,
} from './index';

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function listActualTools() {
  const app = createSiteborneMcpHonoApp({
    allowedHosts: ['test.local'],
    allowedOrigins: ['test.local'],
    health: { production_ready: false, production_enabled: false },
  });
  const client = new Client(
    { name: 'tdqs-contract-test', version: '1.0.0' },
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
  return (await client.listTools()).tools;
}

function missingPropertyDescriptions(schema: unknown, path = '$'): string[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  const missing: string[] = [];
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
      const childRecord = child as Record<string, unknown>;
      if (typeof childRecord.description !== 'string' || childRecord.description.trim() === '') {
        missing.push(`${path}.${name}`);
      }
      missing.push(...missingPropertyDescriptions(child, `${path}.${name}`));
    }
  }
  if (record.items) missing.push(...missingPropertyDescriptions(record.items, `${path}[]`));
  return missing;
}

function withoutDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutDescriptions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      // `examples` is an annotation keyword like `description`: it never
      // changes what validates. It is rewritten so an advertised sample never
      // selects a mode that is defined but unavailable.
      .filter(([key]) => key !== 'description' && key !== 'examples')
      .map(([key, child]) => [key, withoutDescriptions(child)])
  );
}

describe('TDQS 1.2 tool-definition contract', () => {
  it('preserves the exact six established tool names', async () => {
    const tools = await listActualTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect(tools).toHaveLength(6);
  });

  it('gives every actual tools/list definition selection, behavior, and return guidance', async () => {
    const tools = await listActualTools();
    for (const tool of tools) {
      expect(tool.description, tool.name).toMatch(/^\S/);
      expect(tool.description, tool.name).toContain('Use when:');
      expect(tool.description, tool.name).toContain('Do not use when:');
      expect(tool.description, tool.name).toContain('Behavior:');
      expect(tool.description, tool.name).toContain('Returns:');
    }
  });

  it('describes every semantically meaningful input property in actual tools/list schemas', async () => {
    const tools = await listActualTools();
    expect(
      tools.flatMap((tool) =>
        missingPropertyDescriptions(tool.inputSchema).map((path) => `${tool.name}:${path}`)
      )
    ).toEqual([]);
  });

  it('changes service input documentation without changing schema semantics', async () => {
    const byName = Object.fromEntries((await listActualTools()).map((tool) => [tool.name, tool]));
    for (const [toolName, serviceId] of Object.entries(MCP_SERVICE_TOOLS)) {
      const original = fromJsonSchema(MCP_SERVICE_INPUT_SCHEMAS[serviceId] as JsonSchemaType)[
        '~standard'
      ].jsonSchema.input({ target: 'draft-07' });
      expect(withoutDescriptions(byName[toolName].inputSchema), toolName).toEqual(
        withoutDescriptions(original)
      );
    }
  });

  it('states quote-only and health-only boundaries explicitly', async () => {
    const byName = Object.fromEntries((await listActualTools()).map((tool) => [tool.name, tool]));
    expect(byName.siteborne_get_quote.description).toContain(
      'does not execute the underlying paid service'
    );
    expect(byName.siteborne_get_service_health.description).toContain(
      'does not perform paid evidence work'
    );
  });
});

// PRODUCTION-ECONOMICS-DISCOVERY-01 (TDQS): tool descriptions cover what the
// tool does, when to use / not use it, parameter interactions, open-world and
// economic behavior, failure semantics and returns -- with every price and
// limit rendered from the canonical contract, never hand-copied.
describe('TDQS economic and semantic metadata', () => {
  const SERVICE_TOOLS = Object.keys(MCP_SERVICE_TOOLS);

  it('every service tool description covers all eight dimensions in order', async () => {
    const tools = await listActualTools();
    for (const name of SERVICE_TOOLS) {
      const description = tools.find((t) => t.name === name)!.description as string;
      const positions = [
        'Use when:',
        'Do not use when:',
        'Parameters:',
        'Behavior:',
        'Economics:',
        'Failure:',
        'Returns:',
      ].map((marker) => description.indexOf(marker));
      expect(
        positions.every((p) => p >= 0),
        name
      ).toBe(true);
      expect(
        [...positions].sort((a, b) => a - b),
        name
      ).toEqual(positions);
      expect(description.length, `${name} stays concise`).toBeLessThan(3200);
    }
  });

  it('web_context_verified states direct/rendered, open-world, replay, rate policy and failure semantics', async () => {
    const tools = await listActualTools();
    const d = tools.find((t) => t.name === 'siteborne_web_context_verified')!.description as string;
    expect(d).toContain('direct HTTP retrieval');
    expect(d).toContain('rendered is defined but unavailable');
    expect(d).toContain('never substituted with direct retrieval');
    expect(d).toContain('open-world');
    expect(d).toContain('replay-protected');
    expect(d).toContain('governed runtime rate policy');
    expect(d).toContain('never answered with a substitute result');
    expect(d).toMatch(/exact price of \$0\.008 USD per request in direct mode/);
    expect(d).toMatch(/rendered mode has a governed price of \$0\.029 USD but is not available/);
  });

  it('document_evidence_json states reference modes, OCR/table tiers, page limit and ceiling-vs-charge', async () => {
    const tools = await listActualTools();
    const d = tools.find((t) => t.name === 'siteborne_document_evidence_json')!
      .description as string;
    for (const term of [
      'artifact_reference',
      'upload_reference',
      'document_url',
      'ocr_permission',
      'table_extraction_request',
    ]) {
      expect(d).toContain(term);
    }
    expect(d).toContain('The authorization is a ceiling, not the charge');
    expect(d).toContain('authorizes a maximum of $0.19 USD per job');
    expect(d).toContain('native-text $0.0098');
    expect(d).toContain('OCR $0.0156');
    expect(d).toContain('table $0.0238');
    expect(d).toContain('limited to 10 pages per job');
    expect(d).not.toContain('100 pages');
  });

  it('verify_agent_output states standard-only, closed-world, and that price never weakens assurance', async () => {
    const tools = await listActualTools();
    const d = tools.find((t) => t.name === 'siteborne_verify_agent_output')!.description as string;
    expect(d).toContain('independent_reproduction is defined but unavailable');
    expect(d).toContain('never downgraded to standard');
    expect(d).toContain('closed-world');
    expect(d).toContain('do not depend on price or maximum_authorized_price');
    expect(d).toMatch(/exact price of \$0\.017 USD per request/);
  });

  it('every dollar amount in every description is a governed price', async () => {
    const governed = new Set(
      (
        [
          'company_evidence_graph_v2',
          'web_context_verified_direct_v2',
          'web_context_verified_rendered',
          'document_evidence_json_native_v2',
          'document_evidence_json_ocr_v2',
          'document_evidence_json_table_v2',
          'document_evidence_json_max_job',
          'verify_agent_output_standard_v2',
          'verify_agent_output_reproduction',
        ] as const
      ).map((key) => resolveServiceMaxPriceUsd(key))
    );
    const tools = await listActualTools();
    for (const tool of tools) {
      for (const [, amount] of (tool.description as string).matchAll(/\$(\d+\.\d+)/g)) {
        expect(governed.has(amount), `${tool.name}: $${amount}`).toBe(true);
      }
    }
  });

  it('annotations are truthful: paid tools are not read-only; open-world only where execution leaves SITEBORNE', async () => {
    const byName = Object.fromEntries((await listActualTools()).map((t) => [t.name, t]));
    for (const name of SERVICE_TOOLS) {
      expect(byName[name].annotations?.readOnlyHint, name).toBe(false);
      expect(byName[name].annotations?.destructiveHint, name).toBe(false);
      expect(byName[name].annotations?.idempotentHint, name).toBe(true);
    }
    expect(byName.siteborne_company_evidence_graph.annotations?.openWorldHint).toBe(true);
    expect(byName.siteborne_web_context_verified.annotations?.openWorldHint).toBe(true);
    expect(byName.siteborne_document_evidence_json.annotations?.openWorldHint).toBe(true);
    expect(byName.siteborne_verify_agent_output.annotations?.openWorldHint).toBe(false);
    for (const name of ['siteborne_get_quote', 'siteborne_get_service_health']) {
      expect(byName[name].annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  it('get_quote documents every output field the prompt names', async () => {
    const quote = (await listActualTools()).find((t) => t.name === 'siteborne_get_quote')!;
    const properties = (
      quote.outputSchema as { properties: Record<string, { description?: string }> }
    ).properties;
    for (const field of [
      'amount',
      'actual_amount',
      'amount_kind',
      'payee',
      'network',
      'asset',
      'binding_hash',
      'requirement_id',
      'production_enabled',
      'pricing_source_version',
      'economics',
    ]) {
      expect(properties[field]?.description, field).toBeTruthy();
    }
    expect(Object.entries(properties).filter(([, v]) => !v.description?.trim())).toEqual([]);
  });

  it('mode selector docs and advertised examples never present an unavailable mode as usable', async () => {
    const byName = Object.fromEntries((await listActualTools()).map((t) => [t.name, t]));
    const web = byName.siteborne_web_context_verified.inputSchema as {
      properties: { retrieval_mode: { description: string } };
      examples?: { retrieval_mode?: string }[];
    };
    expect(web.properties.retrieval_mode.description).toContain(
      'rendered has a governed price but is not available'
    );
    expect(web.examples?.every((e) => e.retrieval_mode !== 'rendered')).toBe(true);
    const verify = byName.siteborne_verify_agent_output.inputSchema as {
      properties: { verification_mode: { description: string } };
    };
    expect(verify.properties.verification_mode.description).toContain(
      'independent_reproduction has a governed price but is not available'
    );
  });
});
