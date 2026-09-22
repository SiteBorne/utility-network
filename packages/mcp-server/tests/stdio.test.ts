import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { MCP_TOOL_NAMES } from '@siteborne/protocol-mcp';
import { afterEach, describe, expect, it } from 'vitest';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('@siteborne/mcp-server packed stdio entry', () => {
  it('negotiates 2026-07-28 and lists the same ten tools', async () => {
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

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });
});
