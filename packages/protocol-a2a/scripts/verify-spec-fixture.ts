import { readFile } from 'node:fs/promises';
import {
  A2A_CONTENT_TYPE,
  A2A_PROTOCOL_VERSION,
  A2A_VERSION_HEADER,
  AGENT_CARD_PATH,
  AgentCard,
  Extensions,
  canonicalizeAgentCard,
  generateAgentCardSignature,
  verifyAgentCardSignature,
} from '@a2a-js/sdk';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  defaultServerCallContextBuilder,
  validateVersion,
} from '@a2a-js/sdk/server';
import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';

interface SpecFixture {
  sdk_package: string;
  sdk_version: string;
  a2a_spec_version: string;
  agent_card_path_export: string;
  selected_protocol_binding: string;
  version_header: string;
  content_type: string;
  send_message_operation: string;
  legacy_v0_3_compatibility: boolean;
}

const fixture = JSON.parse(
  await readFile(new URL('../fixtures/a2a-spec-baseline.json', import.meta.url), 'utf8')
) as SpecFixture;
const packageManifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
) as { dependencies: Record<string, string> };

if (
  fixture.sdk_package !== '@a2a-js/sdk' ||
  packageManifest.dependencies[fixture.sdk_package] !== fixture.sdk_version
) {
  throw new Error('A2A SDK pin drift');
}
if (
  A2A_PROTOCOL_VERSION !== fixture.a2a_spec_version ||
  AGENT_CARD_PATH !== fixture.agent_card_path_export ||
  A2A_VERSION_HEADER !== fixture.version_header ||
  A2A_CONTENT_TYPE !== fixture.content_type ||
  fixture.selected_protocol_binding !== 'JSONRPC' ||
  fixture.send_message_operation !== 'SendMessage' ||
  fixture.legacy_v0_3_compatibility !== false
) {
  throw new Error('A2A v1 wire/spec baseline drift');
}

const runtimeExports = [
  AgentCard,
  Extensions,
  canonicalizeAgentCard,
  generateAgentCardSignature,
  verifyAgentCardSignature,
  DefaultRequestHandler,
  InMemoryTaskStore,
  JsonRpcTransportHandler,
  defaultServerCallContextBuilder,
  validateVersion,
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
];
if (runtimeExports.some((value) => value === undefined)) {
  throw new Error('required official A2A SDK export is unavailable');
}

process.stdout.write(
  `A2A spec baseline OK: ${fixture.sdk_package}@${fixture.sdk_version}, spec ${fixture.a2a_spec_version}, ${fixture.selected_protocol_binding}\n`
);
