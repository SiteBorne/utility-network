import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { writeFile } from 'node:fs/promises';
import { MCP_PROTOCOL_VERSION, createSiteborneMcpHonoApp } from '../dist/index.js';

const app = createSiteborneMcpHonoApp({
  allowedHosts: ['tdqs.local'],
  allowedOrigins: ['tdqs.local'],
  health: {
    production_ready: false,
    production_enabled: true,
    services: {
      'company_evidence_graph.v2': {
        implementation: 'real_executor',
        production: 'production_disabled',
        external: 'not_live',
      },
      'web_context_verified.v2': {
        implementation: 'real_executor',
        production: 'production_enabled',
        external: 'configured',
      },
      'document_evidence_json.v2': {
        implementation: 'real_executor',
        production: 'production_disabled',
        external: 'not_live',
      },
      'verify_agent_output.v2': {
        implementation: 'real_executor',
        production: 'production_enabled',
        external: 'configured',
      },
    },
  },
});

const client = new Client(
  { name: 'siteborne-tdqs-export', version: '1.0.0' },
  { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } }
);

try {
  await client.connect(
    new StreamableHTTPClientTransport(new globalThis.URL('http://tdqs.local/mcp'), {
      fetch: async (input, init) => {
        const headers = new globalThis.Headers(init?.headers);
        headers.set('Host', 'tdqs.local');
        return app.fetch(new globalThis.Request(input, { ...init, headers }));
      },
    })
  );
  const output = `${JSON.stringify(await client.listTools())}\n`;
  if (process.argv[2]) {
    await writeFile(process.argv[2], output, { encoding: 'utf8', mode: 0o600 });
  } else {
    process.stdout.write(output);
  }
} finally {
  await client.close();
}
