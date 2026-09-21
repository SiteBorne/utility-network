import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const EXPECTED_TOOLS = [
  'siteborne_build_company_evidence_graph',
  'siteborne_retrieve_verified_web_context',
  'siteborne_extract_document_evidence_json',
  'siteborne_verify_agent_output',
  'siteborne_get_quote',
  'siteborne_get_service_health',
].sort();

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'siteborne-mcp-pack-'));
const npmEnvironment = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  npm_config_cache: join(temporaryDirectory, 'npm-cache'),
  npm_config_offline: 'true',
};
let client: Client | undefined;

try {
  const pack = spawnSync('npm', ['pack', '--pack-destination', temporaryDirectory], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: npmEnvironment,
  });
  if (pack.status !== 0) {
    throw new Error(`npm pack failed: ${pack.stderr.trim()}`);
  }

  const archive = readdirSync(temporaryDirectory).find((name) => name.endsWith('.tgz'));
  if (!archive) throw new Error('npm pack did not create an archive');

  const install = spawnSync(
    'npm',
    [
      'install',
      '--prefix',
      temporaryDirectory,
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(temporaryDirectory, archive),
    ],
    { encoding: 'utf8', env: npmEnvironment }
  );
  if (install.status !== 0) {
    throw new Error(`offline local install failed: ${install.stderr.trim()}`);
  }

  client = new Client(
    { name: 'siteborne-packed-install-verifier', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );
  const transport = new StdioClientTransport({
    command: join(temporaryDirectory, 'node_modules', '.bin', 'siteborne-mcp'),
    cwd: temporaryDirectory,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    stderr: 'pipe',
  });
  let childStderr = '';
  transport.stderr?.on('data', (chunk) => {
    childStderr += String(chunk);
  });
  try {
    await client.connect(transport);
  } catch (error) {
    throw new Error(
      `packed server failed to connect: ${error instanceof Error ? error.message : String(error)}; stderr: ${childStderr.trim()}`
    );
  }
  const tools = await client.listTools();
  const actualTools = tools.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(actualTools) !== JSON.stringify(EXPECTED_TOOLS)) {
    throw new Error(`packed server tool mismatch: ${JSON.stringify(actualTools)}`);
  }
  const health = await client.callTool({
    name: 'siteborne_get_service_health',
    arguments: {},
  });
  if (
    health.isError === true ||
    (health.structuredContent as { production_enabled?: unknown } | undefined)
      ?.production_enabled !== false
  ) {
    throw new Error('packed server health tool did not report production disabled');
  }
  const quote = await client.callTool({
    name: 'siteborne_get_quote',
    arguments: {
      service_id: 'company_evidence_graph.v1',
      scheme: 'exact',
      input: { company_name: 'Local packaging proof' },
    },
  });
  if (
    quote.isError !== true ||
    !JSON.stringify(quote.content).includes('quote_configuration_unavailable')
  ) {
    throw new Error('packed server quote tool did not fail closed without seller configuration');
  }
  console.warn(
    `MCP packed install OK: ${archive}, ${actualTools.length} tools, health/quote verified, offline install`
  );
} finally {
  await client?.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
