#!/usr/bin/env node
// Drift check for OpenAPI generation
// Regenerates OpenAPI artifacts into a temp directory and compares against committed output

import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const OPENAPI_OUTPUT_DIR = resolve(ROOT, 'packages/contracts/generated/openapi');
const DRIFT_CHECK_DIR = resolve(ROOT, '.openapi-drift-check');
const OPENAPI_TEMP_DIR = resolve(DRIFT_CHECK_DIR, 'openapi');

function hashFile(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}

function hashDir(dir: string): Map<string, string> {
  const hashes = new Map<string, string>();
  function walk(d: string, prefix: string) {
    for (const entry of readdirSync(d)) {
      const full = resolve(d, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        hashes.set(rel, hashFile(full));
      }
    }
  }
  walk(dir, '');
  return hashes;
}

function cleanTemp() {
  if (existsSync(DRIFT_CHECK_DIR)) {
    rmSync(DRIFT_CHECK_DIR, { recursive: true, force: true });
  }
}

function main() {
  console.log('=== OpenAPI Drift Check ===\n');

  const expectedFiles = [
    'common-components.json',
    'service-components.json',
    'service-contracts.openapi.json',
  ];

  // 1. Snapshot committed hashes
  let missing = false;
  for (const file of expectedFiles) {
    const path = resolve(OPENAPI_OUTPUT_DIR, file);
    if (!existsSync(path)) {
      console.error('Missing committed OpenAPI file: ' + path);
      missing = true;
    }
  }
  if (missing) {
    console.error('\nRun generation first: pnpm --filter @siteborne/pcc-schema generate:openapi');
    process.exit(1);
  }

  const committed = hashDir(OPENAPI_OUTPUT_DIR);

  // 2. Regenerate into a temp directory
  cleanTemp();
  mkdirSync(OPENAPI_TEMP_DIR, { recursive: true });

  try {
    console.log('Regenerating OpenAPI artifacts into temp dir...');
    execSync('npx tsx scripts/generate-openapi.ts', {
      cwd: resolve(ROOT, 'packages/pcc-schema'),
      stdio: 'inherit',
      env: {
        ...process.env,
        OPENAPI_OUTPUT_DIR: OPENAPI_TEMP_DIR,
      },
    });

    // Format OpenAPI temp files with prettier to match committed style
    console.log('\nFormatting OpenAPI temp files with prettier...');
    execSync('npx prettier --write .', {
      cwd: OPENAPI_TEMP_DIR,
      stdio: 'inherit',
    });

    const regenerated = hashDir(OPENAPI_TEMP_DIR);

    let hasDrift = false;
    const allFiles = new Set<string>([...committed.keys(), ...regenerated.keys()]);
    for (const f of allFiles) {
      if (committed.get(f) !== regenerated.get(f)) {
        console.error(`  ❌ OpenAPI drift: ${f}`);
        hasDrift = true;
      }
    }

    if (hasDrift) {
      console.error('\n❌ DRIFT DETECTED — committed OpenAPI does not match canonical schemas.');
      console.error('   Run: pnpm --filter @siteborne/pcc-schema generate:openapi');
      process.exit(1);
    } else {
      console.log(`\n✓ ALL ${expectedFiles.length} OPENAPI FILES MATCH - NO DRIFT`);
      process.exit(0);
    }
  } finally {
    cleanTemp();
  }
}

main();
