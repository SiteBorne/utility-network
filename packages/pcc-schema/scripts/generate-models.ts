#!/usr/bin/env node
// Generate PCC TypeScript and Python models from canonical schema
// Uses quicktype for TypeScript and datamodel-code-generator for Python

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SCHEMA_PATH = resolve(ROOT, 'schemas/proof-carrying-context.schema.json');
const TS_OUTPUT = resolve(ROOT, 'packages/contracts/generated/typescript/pcc.ts');
const PY_OUTPUT = resolve(ROOT, 'packages/contracts/generated/python/pcc_models.py');
const VENV_PYTHON = resolve(ROOT, '.venv/bin/python3');

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

function main() {
  console.log('=== PCC Model Generation ===\n');

  if (!existsSync(SCHEMA_PATH)) {
    console.error(`Schema not found: ${SCHEMA_PATH}`);
    process.exit(1);
  }

  try {
    // Generate TypeScript models using quicktype
    console.log('Generating TypeScript models...');
    run('quicktype', [
      '--lang',
      'typescript',
      '--out',
      TS_OUTPUT,
      '--src-lang',
      'schema',
      SCHEMA_PATH,
      '--just-types',
      '--no-enums',
      '--prefer-unions',
    ]);

    // Add header
    const tsHeader = `// Generated from schemas/proof-carrying-context.schema.json
// DO NOT EDIT MANUALLY — regenerate from canonical schema

`;
    const tsContent = readFileSync(TS_OUTPUT, 'utf-8');
    writeFileSync(TS_OUTPUT, tsHeader + tsContent);

    console.log(`  Generated: ${TS_OUTPUT}`);

    // Generate Python models using datamodel-code-generator
    console.log('Generating Python models...');
    run(VENV_PYTHON, [
      '-m',
      'datamodel_code_generator',
      '--input',
      SCHEMA_PATH,
      '--input-file-type',
      'jsonschema',
      '--output',
      PY_OUTPUT,
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
    const pyContent = readFileSync(PY_OUTPUT, 'utf-8');
    writeFileSync(PY_OUTPUT, pyHeader + pyContent);

    console.log(`  Generated: ${PY_OUTPUT}`);

    console.log('\n✓ Generation complete');
  } catch (e) {
    console.error('Generation failed:', e.message);
    process.exit(1);
  }
}

main();
