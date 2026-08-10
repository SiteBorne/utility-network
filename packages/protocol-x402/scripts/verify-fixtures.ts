/**
 * Regression gate over fixtures/x402-spec-baseline.json — proves the
 * recorded spec/package baseline this package is pinned against is
 * internally consistent with what's actually installed
 * (package.json's @x402/core version) and with SUPPORTED_X402_VERSION.
 * Not a network call — reads only already-committed, local files.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { x402Version } from '@x402/core';
import { BAZAAR } from '@x402/extensions/bazaar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

interface SpecBaseline {
  protocol: { targeted_major_version: number };
  npm_packages_inspected: Array<{
    name: string;
    version: string;
    used: boolean;
    used_subpaths?: string[];
  }>;
  bazaar_extension?: { package: string; version: string; subpath: string; extension_key: string };
}

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ ${message}`);
    failures++;
  }
}

function main(): void {
  const baseline = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'fixtures', 'x402-spec-baseline.json'), 'utf-8')
  ) as SpecBaseline;
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
    dependencies: Record<string, string>;
  };
  const installedX402CoreVersionSpec = pkg.dependencies['@x402/core'];

  console.log('Verifying x402 spec baseline consistency...\n');

  assert(
    baseline.protocol.targeted_major_version === x402Version,
    `recorded targeted_major_version (${baseline.protocol.targeted_major_version}) matches @x402/core's own exported x402Version constant (${x402Version})`
  );

  const coreEntry = baseline.npm_packages_inspected.find((p) => p.name === '@x402/core');
  assert(Boolean(coreEntry), 'fixtures/x402-spec-baseline.json records an @x402/core entry');
  assert(coreEntry?.used === true, '@x402/core is recorded as actually used');
  assert(
    Boolean(installedX402CoreVersionSpec) &&
      coreEntry !== undefined &&
      installedX402CoreVersionSpec!.replace('^', '').split('.')[0] ===
        coreEntry.version.split('.')[0],
    `package.json's @x402/core dependency spec (${installedX402CoreVersionSpec}) is major-version-compatible with the recorded baseline (${coreEntry?.version})`
  );

  const unusedHeavyPackages = baseline.npm_packages_inspected.filter(
    (p) => p.used === false && (p.name === 'x402' || p.name === '@coinbase/x402')
  );
  assert(
    unusedHeavyPackages.length === 2,
    'both heavier x402/@coinbase-x402 packages remain explicitly recorded as evaluated-but-not-used'
  );

  const extensionsEntry = baseline.npm_packages_inspected.find(
    (p) => p.name === '@x402/extensions'
  );
  const installedExtensionsVersionSpec = pkg.dependencies['@x402/extensions'];
  assert(
    Boolean(extensionsEntry) && extensionsEntry?.used === true,
    'fixtures/x402-spec-baseline.json records @x402/extensions as actually used'
  );
  assert(
    Boolean(installedExtensionsVersionSpec) &&
      extensionsEntry !== undefined &&
      installedExtensionsVersionSpec!.replace('^', '').split('.')[0] ===
        extensionsEntry.version.split('.')[0],
    `package.json's @x402/extensions dependency spec (${installedExtensionsVersionSpec}) is major-version-compatible with the recorded baseline (${extensionsEntry?.version})`
  );
  assert(
    Boolean(extensionsEntry?.used_subpaths?.includes('@x402/extensions/bazaar')),
    'fixtures/x402-spec-baseline.json records @x402/extensions/bazaar as a used subpath (SUN-0700A checkpoint 4)'
  );

  console.log('\nVerifying Bazaar extension baseline (directive §18 drift guard)...\n');
  assert(
    Boolean(baseline.bazaar_extension),
    'fixtures/x402-spec-baseline.json records a bazaar_extension entry'
  );
  assert(
    baseline.bazaar_extension?.version === extensionsEntry?.version,
    `recorded bazaar_extension.version (${baseline.bazaar_extension?.version}) matches the recorded @x402/extensions entry version (${extensionsEntry?.version})`
  );
  assert(
    baseline.bazaar_extension?.extension_key === BAZAAR.key,
    `recorded bazaar_extension.extension_key ("${baseline.bazaar_extension?.extension_key}") matches @x402/extensions/bazaar's own exported BAZAAR.key ("${BAZAAR.key}")`
  );

  console.log('\nVerifying X402_SCENARIO_MATRIX.yaml test_reference coverage...\n');
  const matrix = parse(
    readFileSync(join(PACKAGE_ROOT, 'fixtures', 'X402_SCENARIO_MATRIX.yaml'), 'utf-8')
  ) as { scenarios: Array<{ category: string; test_reference: string }> };
  for (const scenario of matrix.scenarios) {
    const exists = existsSync(join(PACKAGE_ROOT, scenario.test_reference));
    assert(
      exists,
      `scenario "${scenario.category}" test_reference "${scenario.test_reference}" exists`
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} spec-baseline consistency check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll spec-baseline consistency checks passed.');
}

main();
