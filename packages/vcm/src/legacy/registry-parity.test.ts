/**
 * The central acceptance test (Master Reference Part II §XIX): the
 * registry parity law, run against every current registry/services/*.json
 * file. No file is modified by this suite -- REGISTRY_MUTATIONS=0.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { legacyRegistryToVCM } from './import-registry';
import { vcmToLegacyRegistry } from './project-registry';
import { checkRegistryParity } from './parity';
import type { LegacyRegistryServiceFile } from './types';

const REGISTRY_DIR = fileURLToPath(new URL('../../../../registry/services', import.meta.url));

function readAllRegistryFiles(): LegacyRegistryServiceFile[] {
  return readdirSync(REGISTRY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map(
      (f) => JSON.parse(readFileSync(join(REGISTRY_DIR, f), 'utf-8')) as LegacyRegistryServiceFile
    );
}

const IMPORT_OPTIONS = {
  runtimeSourceCommit: '0'.repeat(40),
  compiledAt: '2026-09-18T00:00:00.000Z',
  vcmSchemaVersion: '0.2.0', // METADATA-VCM-IMPL-02: legacyBasePriceDeclared added
  vcmReleaseVersion: '0.1.0',
};

describe('registry parity law', () => {
  it('discovers exactly the 8 known registry files', () => {
    const files = readAllRegistryFiles();
    expect(files.length).toBe(8);
  });

  it('round-trips every current registry file with structural parity', async () => {
    const files = readAllRegistryFiles();
    const model = await legacyRegistryToVCM(files, IMPORT_OPTIONS);
    const roundTripped = vcmToLegacyRegistry(model);
    const results = checkRegistryParity(files, roundTripped);

    const failed = results.filter((r) => !r.pass);
    if (failed.length > 0) {
      console.error('REGISTRY_FILES_PARITY_FAIL', JSON.stringify(failed, null, 2));
    }

    expect({
      discovered: files.length,
      pass: results.filter((r) => r.pass).length,
      fail: failed.length,
    }).toEqual({ discovered: 8, pass: 8, fail: 0 });
  });

  it('imports all 8 services without throwing (LEGACY_PARITY is representational, not a validity claim)', async () => {
    const files = readAllRegistryFiles();
    const model = await legacyRegistryToVCM(files, IMPORT_OPTIONS);
    expect(model.services.length).toBe(8);
  });
});
