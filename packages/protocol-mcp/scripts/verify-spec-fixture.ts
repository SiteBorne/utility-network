import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MCP_PROTOCOL_VERSION, MCP_SERVER_NAME, MCP_TOOL_NAMES } from '../src/constants';

interface SpecBaseline {
  protocol_version: string;
  sdk: Record<string, string>;
  transport: string;
  required_headers: string[];
  header_mismatch_error_code: number;
  server_name: string;
  tools: string[];
  source_urls: string[];
}

const packageRoot = new URL('../', import.meta.url);
const baseline = JSON.parse(
  readFileSync(new URL('fixtures/mcp-spec-baseline.json', packageRoot), 'utf8')
) as SpecBaseline;
const packageJson = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const errors: string[] = [];
if (baseline.protocol_version !== MCP_PROTOCOL_VERSION) {
  errors.push(`protocol version drift: ${baseline.protocol_version} != ${MCP_PROTOCOL_VERSION}`);
}
if (baseline.server_name !== MCP_SERVER_NAME) {
  errors.push(`server name drift: ${baseline.server_name} != ${MCP_SERVER_NAME}`);
}
if (baseline.transport !== 'streamable-http-per-request') {
  errors.push(`unexpected transport baseline: ${baseline.transport}`);
}
if (baseline.header_mismatch_error_code !== -32020) {
  errors.push(`HeaderMismatch error code drift: ${baseline.header_mismatch_error_code}`);
}
for (const header of ['MCP-Protocol-Version', 'Mcp-Method', 'Mcp-Name']) {
  if (!baseline.required_headers.includes(header))
    errors.push(`missing required header: ${header}`);
}
if (JSON.stringify(baseline.tools) !== JSON.stringify([...MCP_TOOL_NAMES])) {
  errors.push('frozen tool list drift');
}
for (const [packageName, expected] of Object.entries(baseline.sdk)) {
  const declared =
    packageJson.dependencies[packageName] ?? packageJson.devDependencies[packageName];
  if (declared !== expected)
    errors.push(`${packageName} drift: ${declared ?? 'missing'} != ${expected}`);
}
if (
  baseline.source_urls.length !== 2 ||
  baseline.source_urls.some((url) => !url.startsWith('https://github.com/modelcontextprotocol/'))
) {
  errors.push('spec baseline must cite exactly the official protocol and TypeScript SDK sources');
}

if (errors.length > 0) {
  console.error('MCP spec fixture verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const fixturePath = fileURLToPath(new URL('fixtures/mcp-spec-baseline.json', packageRoot));
console.warn(
  `MCP spec fixture OK: ${MCP_PROTOCOL_VERSION}, 3 SDK pins, ${MCP_TOOL_NAMES.length} tools (${fixturePath})`
);
