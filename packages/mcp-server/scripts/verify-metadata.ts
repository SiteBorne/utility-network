import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as {
  name: string;
  version: string;
  mcpName: string;
  private?: boolean;
};
const serverJson = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
  packages: Array<{ identifier: string; version: string; transport: { type: string } }>;
};

const packageEntry = serverJson.packages[0];
const failures = [
  packageJson.mcpName === serverJson.name || 'mcpName must match server.json name',
  packageJson.name === packageEntry?.identifier || 'npm identifier must match package name',
  packageJson.version === serverJson.version || 'server version must match package version',
  packageJson.version === packageEntry?.version ||
    'package entry version must match package version',
  packageEntry?.transport.type === 'stdio' || 'package transport must be stdio',
  packageJson.private !== true || 'public shim must not be marked private',
].filter((result): result is string => typeof result === 'string');

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.warn(
  `MCP package metadata OK: ${packageJson.name}@${packageJson.version} -> ${packageJson.mcpName}`
);
