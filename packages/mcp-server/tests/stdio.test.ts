import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('@siteborne/mcp-server packed stdio entry', () => {
  it('negotiates 2026-07-28 and lists the same six tools', async () => {
    const client = new Client(
      { name: 'siteborne-stdio-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/stdio.js'],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      stderr: 'pipe',
    });
    await client.connect(transport);
    clients.push(client);

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
});
