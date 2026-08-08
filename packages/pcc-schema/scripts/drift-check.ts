#!/usr/bin/env node
// Generated model drift check for PCC schema
// Usage: pnpm pcc:generate:check

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SCHEMA_PATH = resolve(ROOT, 'schemas/proof-carrying-context.schema.json');
const TS_OUTPUT = resolve(ROOT, 'packages/contracts/generated/typescript/pcc.ts');
const PY_OUTPUT = resolve(ROOT, 'packages/contracts/generated/python/pcc.py');
const TEMP_DIR = resolve(ROOT, '.pcc-drift-temp');
// Use venv python for datamodel-code-generator
const VENV_PYTHON = resolve(ROOT, '.venv/bin/python3');

function run(cmd: string, args: string[], cwd: string = ROOT): string {
  try {
    // Quote command and arguments that contain spaces
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

function hashFile(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}

function cleanTemp() {
  if (existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

function main() {
  console.log('=== PCC Generated Model Drift Check ===\n');

  if (!existsSync(SCHEMA_PATH)) {
    console.error(`Schema not found: ${SCHEMA_PATH}`);
    process.exit(1);
  }

  const schemaHash = hashFile(SCHEMA_PATH);
  console.log(`Schema hash: sha256:${schemaHash}`);

  // Check if generated files exist
  const tsExists = existsSync(TS_OUTPUT);
  const pyExists = existsSync(PY_OUTPUT);

  if (!tsExists || !pyExists) {
    console.error('Generated models not found. Run generation first.');
    process.exit(1);
  }

  const tsHashBefore = hashFile(TS_OUTPUT);
  const pyHashBefore = hashFile(PY_OUTPUT);
  console.log(`TypeScript hash (committed): sha256:${tsHashBefore}`);
  console.log(`Python hash (committed):     sha256:${pyHashBefore}`);

  // Create temp directory
  cleanTemp();
  mkdirSync(resolve(TEMP_DIR, 'typescript'), { recursive: true });
  mkdirSync(resolve(TEMP_DIR, 'python'), { recursive: true });

  try {
    // Generate TypeScript models to temp
    console.log('\nGenerating TypeScript models...');
    const tsTempOutput = resolve(TEMP_DIR, 'typescript', 'pcc.ts');
    console.log(`Creating temp dir: ${resolve(TEMP_DIR, 'typescript')}`);
    mkdirSync(resolve(TEMP_DIR, 'typescript'), { recursive: true });
    console.log(`Dir exists after mkdir: ${existsSync(resolve(TEMP_DIR, 'typescript'))}`);
    console.log(`Output file will be: ${tsTempOutput}`);
    console.log(`Running quicktype...`);
    run('quicktype', [
      '--lang',
      'typescript',
      '--out',
      tsTempOutput,
      '--src-lang',
      'schema',
      SCHEMA_PATH,
      '--just-types',
      '--no-enums',
      '--prefer-unions',
    ]);
    console.log('Quicktype completed');
    console.log(`File exists after quicktype: ${existsSync(tsTempOutput)}`);

    // Add header
    const tsHeader = `// Generated from schemas/proof-carrying-context.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

`;
    const tsContent = readFileSync(tsTempOutput, 'utf-8');
    writeFileSync(tsTempOutput, tsHeader + tsContent);

    // Format with prettier to match committed style
    console.log('Formatting with prettier...');
    run('prettier', ['--write', tsTempOutput]);

    // Generate Python models to temp
    console.log('Generating Python models...');
    const pyTempOutput = resolve(TEMP_DIR, 'python', 'pcc_models.py');
    run(VENV_PYTHON, [
      '-m',
      'datamodel_code_generator',
      '--input',
      SCHEMA_PATH,
      '--input-file-type',
      'jsonschema',
      '--output',
      pyTempOutput,
      '--output-model-type',
      'pydantic_v2.BaseModel',
      '--field-constraints',
      '--use-standard-collections',
      '--use-schema-description',
      '--use-title-as-name',
      '--reuse-model',
      '--class-name',
      'PCCDocument',
      '--disable-timestamp',
    ]);

    // Add header
    const pyHeader = `# Generated from schemas/proof-carrying-context.schema.json
# DO NOT EDIT MANUALLY — regenerate from canonical schema

from __future__ import annotations

`;
    const pyContent = readFileSync(pyTempOutput, 'utf-8');
    writeFileSync(pyTempOutput, pyHeader + pyContent);

    const tsHashAfter = hashFile(tsTempOutput);
    const pyHashAfter = hashFile(pyTempOutput);
    console.log(`TypeScript hash (generated): sha256:${tsHashAfter}`);
    console.log(`Python hash (generated):     sha256:${pyHashAfter}`);

    // Compare
    let hasDrift = false;
    if (tsHashBefore !== tsHashAfter) {
      console.error('\n❌ DRIFT DETECTED: TypeScript models differ from committed version');
      hasDrift = true;
    } else {
      console.log('\n✓ TypeScript models match committed version');
    }

    if (pyHashBefore !== pyHashAfter) {
      console.error('❌ DRIFT DETECTED: Python models differ from committed version');
      hasDrift = true;
    } else {
      console.log('✓ Python models match committed version');
    }

    // Also verify schema hash hasn't changed
    const schemaHashCurrent = hashFile(SCHEMA_PATH);
    if (schemaHash !== schemaHashCurrent) {
      console.error('❌ Schema file changed during generation!');
      hasDrift = true;
    }

    if (hasDrift) {
      console.error('\n❌ DRIFT CHECK FAILED');
      return 1;
    }
    console.log('\n✓ ALL MODELS MATCH - NO DRIFT');
    return 0;
  } finally {
    cleanTemp();
  }
}

const exitCode = main();
if (exitCode !== 0) process.exit(exitCode ?? 0);
