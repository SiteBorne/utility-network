import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
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
      .filter(([key]) => key !== 'description')
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
