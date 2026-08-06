#!/usr/bin/env node
// Generate schemas/MANIFEST.json — the canonical inventory of PCC + the 17
// SUN-0101 canonical schemas (9 common + 8 service input/output), each with
// its content hash, $id, and generated TS/Python output paths. Run this after
// any schema change and commit the result; `--check` verifies it's current
// without writing (used in CI / drift enforcement).

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SCHEMAS_DIR = resolve(ROOT, 'schemas');
const MANIFEST_PATH = resolve(SCHEMAS_DIR, 'MANIFEST.json');

const COMMON_SCHEMAS = [
  'money.schema.json',
  'request-envelope.schema.json',
  'quote-request.schema.json',
  'quote-response.schema.json',
  'structured-error.schema.json',
  'service-metadata.schema.json',
  'async-job.schema.json',
  'pagination.schema.json',
  'authorized-artifact-reference.schema.json',
];

const SERVICE_SCHEMAS = [
  'company-evidence-input.schema.json',
  'company-evidence-output.schema.json',
  'web-context-input.schema.json',
  'web-context-output.schema.json',
  'document-evidence-input.schema.json',
  'document-evidence-output.schema.json',
  'agent-verification-input.schema.json',
  'agent-verification-output.schema.json',
];

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

interface ManifestEntry {
  file: string;
  id: string;
  title: string;
  sha256: string;
  generated: { typescript: string; python: string };
}

function buildEntry(schemaRelPath: string, type: 'common' | 'services' | 'root'): ManifestEntry {
  const fullPath = resolve(SCHEMAS_DIR, schemaRelPath);
  const schema = JSON.parse(readFileSync(fullPath, 'utf-8'));
  const baseName = schemaRelPath.split('/').pop()!.replace('.schema.json', '');
  const tsPath =
    type === 'root'
      ? 'packages/contracts/generated/typescript/pcc.ts'
      : `packages/contracts/generated/typescript/${type}/${baseName}.ts`;
  const pyPath =
    type === 'root'
      ? 'packages/contracts/generated/python/pcc.py'
      : `packages/contracts/generated/python/${type}/${baseName}.py`;
  return {
    file: `schemas/${schemaRelPath}`,
    id: schema['$id'],
    title: schema.title,
    sha256: hashFile(fullPath),
    generated: { typescript: tsPath, python: pyPath },
  };
}

function buildManifest() {
  const common = COMMON_SCHEMAS.map((s) => buildEntry(`common/${s}`, 'common'));
  const services = SERVICE_SCHEMAS.map((s) => buildEntry(`services/${s}`, 'services'));
  const pcc = buildEntry('proof-carrying-context.schema.json', 'root');

  return {
    $comment:
      'Canonical schema manifest for SUN-0101 (17 canonical schemas: 9 common + 8 service ' +
      'input/output) plus the PCC root schema. Regenerate with ' +
      '`pnpm --filter @siteborne/pcc-schema manifest:generate`; verify with `manifest:check`.',
    generated_at_note: 'Timestamp intentionally omitted — hashes are the source of truth; regenerate to see drift.',
    pcc,
    common,
    services,
    counts: {
      common: common.length,
      services: services.length,
      canonical_total: common.length + services.length,
      including_pcc: common.length + services.length + 1,
    },
  };
}

function main() {
  const check = process.argv.includes('--check');
  const manifest = buildManifest();
  const serialized = JSON.stringify(manifest, null, 2) + '\n';

  if (check) {
    if (!existsSync(MANIFEST_PATH)) {
      console.error('MANIFEST.json does not exist. Run without --check to generate it.');
      process.exit(1);
    }
    const existing = readFileSync(MANIFEST_PATH, 'utf-8');
    if (existing !== serialized) {
      console.error('❌ MANIFEST.json is stale. Run: pnpm --filter @siteborne/pcc-schema manifest:generate');
      process.exit(1);
    }
    console.log(`✓ MANIFEST.json is current (${manifest.counts.including_pcc} schemas)`);
    return;
  }

  writeFileSync(MANIFEST_PATH, serialized);
  console.log(`✓ Wrote ${MANIFEST_PATH} (${manifest.counts.including_pcc} schemas)`);
}

main();
