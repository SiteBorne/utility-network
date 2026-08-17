import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface PackageDocument {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface SpecBaseline {
  package: { name: string; version: string };
  tooling_dependency_owner: 'apps/edge-api';
  edge_api_dependency_section: 'devDependencies';
  runtime_http_replacement: string;
  protocol_runtime_sdk_dependency: false;
  facilitator_types: string[];
  facilitator_methods: string[];
  payg_helpers: string[];
  credit_helpers: string[];
  registration_methods: string[];
  trial_registration_methods: string[];
  sdk_declared_a2a_range: string;
  siteborne_direct_a2a_version: string;
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const baseline = JSON.parse(
  readFileSync(new URL('../fixtures/spec-baseline.json', import.meta.url), 'utf8')
) as SpecBaseline;
const edgePackage = JSON.parse(
  readFileSync(`${root}apps/edge-api/package.json`, 'utf8')
) as PackageDocument;
const protocolPackage = JSON.parse(
  readFileSync(`${root}packages/protocol-nevermined/package.json`, 'utf8')
) as PackageDocument;
const sdkRoot = `${root}apps/edge-api/node_modules/@nevermined-io/payments/`;
const sdkPackage = JSON.parse(readFileSync(`${sdkRoot}package.json`, 'utf8')) as PackageDocument;
const facilitatorTypes = readFileSync(`${sdkRoot}dist/x402/facilitator-api.d.ts`, 'utf8');
const planHelpers = readFileSync(`${sdkRoot}dist/plans.d.ts`, 'utf8');
const planApi = readFileSync(`${sdkRoot}dist/api/plans-api.d.ts`, 'utf8');

assert.equal(sdkPackage.name, baseline.package.name);
assert.equal(sdkPackage.version, baseline.package.version);
// SUN-1000 checkpoint 1P: the SDK is tooling-only now (live-proof/
// registration test files), never a production runtime dependency --
// verify both halves of that claim: absent from `dependencies`
// (would re-enter the Trivy-scanned surface), present in
// `devDependencies` (still installed for the tooling that needs it).
assert.equal(edgePackage.dependencies?.[baseline.package.name], undefined);
assert.equal(edgePackage.devDependencies?.[baseline.package.name], baseline.package.version);
assert.equal(protocolPackage.dependencies?.[baseline.package.name], undefined);
assert.equal(protocolPackage.devDependencies?.[baseline.package.name], undefined);
assert.equal(sdkPackage.dependencies?.['@a2a-js/sdk'], baseline.sdk_declared_a2a_range);
assert.equal(edgePackage.dependencies?.['@a2a-js/sdk'], baseline.siteborne_direct_a2a_version);

for (const symbol of [...baseline.facilitator_types, ...baseline.facilitator_methods]) {
  assert.match(facilitatorTypes, new RegExp(`\\b${symbol}\\b`));
}
for (const symbol of [...baseline.payg_helpers, ...baseline.credit_helpers]) {
  assert.match(planHelpers, new RegExp(`\\b${symbol}\\b`));
}
for (const symbol of [...baseline.registration_methods, ...baseline.trial_registration_methods]) {
  assert.match(planApi, new RegExp(`\\b${symbol}\\b`));
}

console.warn(
  `Nevermined spec fixture OK: ${baseline.package.name}@${baseline.package.version}; ` +
    `${baseline.facilitator_methods.length} facilitator methods; no network`
);
