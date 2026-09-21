/**
 * SUN-1200 checkpoint F (P0-A) — proves two things about
 * `schema-registry.ts`'s changes:
 *
 * 1. `getOutputSchemaId`'s new no-filesystem-read derivation
 *    (`https://siteborne.net/schemas/services/<file>`) matches every
 *    real output schema file's actual, committed `$id` exactly — so the
 *    derivation is provably correct, not merely assumed, and any future
 *    schema that broke this repository's uniform `$id` convention would
 *    fail this test rather than silently drift.
 * 2. `setPrecompiledOutputValidators`/`getPrecompiledOutputValidator`
 *    behave correctly: unset by default (this test file never calls the
 *    setter until its own dedicated test), and once set, exactly the
 *    given validator is returned for a known id and `undefined` for an
 *    unknown one.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  getAjv,
  getOutputSchemaId,
  getPrecompiledOutputValidator,
  knownServiceIds,
  setPrecompiledOutputValidators,
} from '../schema-registry';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, '..', '..', '..', '..', 'schemas');
const CANDIDATE_SCHEMAS_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'contracts',
  'releases',
  '3.0.0',
  'schemas'
);

describe('getOutputSchemaId derivation matches real committed schema $id (SUN-1200 checkpoint F)', () => {
  for (const serviceId of knownServiceIds()) {
    it(`${serviceId}: derived $id matches the real schema file's own $id`, () => {
      const derivedId = getOutputSchemaId(serviceId);
      expect(derivedId).toBeTruthy();
      // Re-read the real file the OLD fs-based implementation would have
      // read, purely to prove equivalence -- this test file itself runs
      // under real Node.js, where fs genuinely works.
      const file = derivedId!.split('/').pop()!;
      const schemaRoot = serviceId.endsWith('.v3') ? CANDIDATE_SCHEMAS_DIR : SCHEMAS_DIR;
      const real = JSON.parse(readFileSync(join(schemaRoot, 'services', file), 'utf-8'));
      expect(derivedId).toBe(real.$id);
      expect(getAjv().getSchema(derivedId!)).toBeTypeOf('function');
    });
  }
});

describe('candidate Release-3 validators', () => {
  for (const serviceId of [
    'company_evidence_graph.v3',
    'web_context_verified.v3',
    'document_evidence_json.v3',
    'verify_agent_output.v3',
  ]) {
    it(`${serviceId}: resolves the release-qualified precompiled schema`, () => {
      const derivedId = getOutputSchemaId(serviceId);
      expect(derivedId).toMatch('/contracts/3.0.0/schemas/services/');
      expect(getAjv().getSchema(derivedId!)).toBeTypeOf('function');
    });
  }
});

describe('precompiled output validator override (SUN-1200 checkpoint F P0-A)', () => {
  it('returns undefined for any id when never set', () => {
    // A fresh describe block/module-level singleton -- but since
    // `precompiledOutputValidators` is a module-level variable shared
    // across this whole test file, this must run before any test in
    // this file calls the setter. Vitest runs `it` blocks within a file
    // in declaration order by default, so this stays first.
    expect(
      getPrecompiledOutputValidator('https://example.invalid/never-set.schema.json')
    ).toBeUndefined();
  });

  it('returns exactly the registered validator for a known id, and undefined for an unknown one, once set', () => {
    const fakeValidator = (() => true) as unknown;
    setPrecompiledOutputValidators({
      'https://example.invalid/known.schema.json': fakeValidator,
    });
    expect(getPrecompiledOutputValidator('https://example.invalid/known.schema.json')).toBe(
      fakeValidator
    );
    expect(
      getPrecompiledOutputValidator('https://example.invalid/unknown.schema.json')
    ).toBeUndefined();
  });
});
