#!/usr/bin/env node
// Drift check for the 17 canonical service/common schemas + PCC.
// Regenerates TS/Python models using the SAME pipeline as generate-service-models.ts
// (via create-combined-schemas.ts and create-ts-schemas.ts) into a temp directory
// and compares against the committed generated/ output. Any mismatch is drift.

import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const TS_OUTPUT_DIR = resolve(ROOT, 'packages/contracts/generated/typescript');
const PY_OUTPUT_DIR = resolve(ROOT, 'packages/contracts/generated/python');
const DRIFT_CHECK_DIR = resolve(ROOT, '.service-drift-check');
const TS_TEMP_DIR = resolve(DRIFT_CHECK_DIR, 'typescript');
const PY_TEMP_DIR = resolve(DRIFT_CHECK_DIR, 'python');

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

function run(cmd: string, args: string[], cwd: string = ROOT): string {
  try {
    const quotedCmd = cmd.includes(' ') ? `"${cmd}"` : cmd;
    const quotedArgs = args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg));
    const shellCmd = [quotedCmd, ...quotedArgs].join(' ');
    const result = execSync(shellCmd, { cwd, encoding: 'utf-8', stdio: 'pipe', shell: true });
    return result.toString().trim();
  } catch (e) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    throw e;
  }
}

function cleanTemp() {
  if (existsSync(DRIFT_CHECK_DIR)) {
    rmSync(DRIFT_CHECK_DIR, { recursive: true, force: true });
  }
}

function main() {
  console.log('=== SITEBORNE Service Contracts Drift Check (17 schemas + PCC) ===\n');

  const allNames = [
    ...COMMON_SCHEMAS.map((s) => s.replace('.schema.json', '')),
    ...SERVICE_SCHEMAS.map((s) => s.replace('.schema.json', '')),
    'pcc',
  ];

  // 1. Snapshot committed hashes
  let missing = false;
  for (const base of allNames) {
    const tsPath =
      base === 'pcc'
        ? resolve(TS_OUTPUT_DIR, 'pcc.ts')
        : resolve(
            TS_OUTPUT_DIR,
            COMMON_SCHEMAS.some((s) => s.startsWith(base)) ? 'common' : 'services',
            `${base}.ts`
          );
    const pyPath =
      base === 'pcc'
        ? resolve(PY_OUTPUT_DIR, 'pcc.py')
        : resolve(
            PY_OUTPUT_DIR,
            COMMON_SCHEMAS.some((s) => s.startsWith(base)) ? 'common' : 'services',
            `${base}.py`
          );
    if (!existsSync(tsPath)) {
      console.error('Missing committed TypeScript: ' + tsPath);
      missing = true;
    }
    if (!existsSync(pyPath)) {
      console.error('Missing committed Python: ' + pyPath);
      missing = true;
    }
  }
  if (missing) {
    console.error(
      '\nRun generation first: pnpm --filter @siteborne/pcc-schema generate:services && generate'
    );
    process.exit(1);
  }

  const committedTs = hashDir(TS_OUTPUT_DIR);
  const committedPy = hashDir(PY_OUTPUT_DIR);

  // 2. Regenerate into a temp directory using the exact same
  //    scripts that produce the committed output (create-combined-schemas ->
  //    create-ts-schemas -> generate-service-models).
  cleanTemp();
  mkdirSync(TS_TEMP_DIR, { recursive: true });
  mkdirSync(PY_TEMP_DIR, { recursive: true });

  try {
    console.log('Regenerating combined/TS-friendly intermediate schemas...');
    execSync('npx tsx scripts/create-combined-schemas.ts', {
      cwd: resolve(ROOT, 'packages/pcc-schema'),
      stdio: 'inherit',
    });
    execSync('npx tsx scripts/create-ts-schemas.ts', {
      cwd: resolve(ROOT, 'packages/pcc-schema'),
      stdio: 'inherit',
    });

    // Note: PCC's pcc.ts/pcc.py are regenerated as part of generate-service-models.ts
    // below (single source of truth for the unified 17-schema + PCC pipeline). The
    // legacy standalone generate-models.ts / pcc_models.py path is SUN-0100's and is
    // left untouched here.
    console.log('\nRegenerating service + common models (incl. PCC) into temp dir...');
    // We need to modify the output directories for the temp generation.
    // Set environment variables to redirect output.
    execSync('npx tsx scripts/generate-service-models.ts', {
      cwd: resolve(ROOT, 'packages/pcc-schema'),
      stdio: 'inherit',
      env: {
        ...process.env,
        TS_OUTPUT_DIR: TS_TEMP_DIR,
        PY_OUTPUT_DIR: PY_TEMP_DIR,
      },
    });

    // Format TypeScript temp files with prettier to match committed style
    console.log('\nFormatting TypeScript temp files with prettier...');
    execSync('npx prettier --write .', {
      cwd: TS_TEMP_DIR,
      stdio: 'inherit',
    });

    const regeneratedTs = hashDir(TS_TEMP_DIR);
    const regeneratedPy = hashDir(PY_TEMP_DIR);

    let hasDrift = false;
    const allFiles = new Set<string>([...committedTs.keys(), ...regeneratedTs.keys()]);
    for (const f of allFiles) {
      if (committedTs.get(f) !== regeneratedTs.get(f)) {
        console.error(`  ❌ TypeScript drift: ${f}`);
        hasDrift = true;
      }
    }
    const allPyFiles = new Set<string>([...committedPy.keys(), ...regeneratedPy.keys()]);
    for (const f of allPyFiles) {
      if (committedPy.get(f) !== regeneratedPy.get(f)) {
        console.error(`  ❌ Python drift: ${f}`);
        hasDrift = true;
      }
    }

    if (hasDrift) {
      console.error('\n❌ DRIFT DETECTED — committed generated/ does not match canonical schemas.');
      console.error('   Run: pnpm --filter @siteborne/pcc-schema generate && generate:services');
      process.exit(1);
    } else {
      console.log(`\n✓ ALL ${allNames.length} MODELS MATCH - NO DRIFT`);
      process.exit(0);
    }
  } finally {
    cleanTemp();
    for (const tmp of ['.temp-combined-schemas', '.temp-ts-schemas', '.temp-schemas']) {
      const p = resolve(ROOT, tmp);
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
  }
}

main();
