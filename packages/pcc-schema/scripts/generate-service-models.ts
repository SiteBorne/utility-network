#!/usr/bin/env node
// Generate TypeScript and Python models from canonical schemas
// Uses quicktype for TypeScript and datamodel-code-generator for Python

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SCHEMAS_DIR = resolve(ROOT, 'schemas');
// Use environment variables for output directories, defaulting to committed paths
const TS_OUTPUT_DIR = resolve(
  process.env.TS_OUTPUT_DIR || resolve(ROOT, 'packages/contracts/generated/typescript')
);
const PY_OUTPUT_DIR = resolve(
  process.env.PY_OUTPUT_DIR || resolve(ROOT, 'packages/contracts/generated/python')
);
const VENV_PYTHON = resolve(ROOT, '.venv/bin/python3');

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

const COMMON_SCHEMA_PATHS = COMMON_SCHEMAS.map((s) => resolve(SCHEMAS_DIR, 'common', s));
const PCC_SCHEMA_PATH = resolve(SCHEMAS_DIR, 'proof-carrying-context.schema.json');
const OUTPUT_SCHEMA_ADDITIONAL = [...COMMON_SCHEMA_PATHS, PCC_SCHEMA_PATH];

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

function generateTypeScript(
  schemaPath: string,
  outputPath: string,
  additionalSchemas: string[] = []
): void {
  console.log(`  Generating TypeScript: ${outputPath}`);
  mkdirSync(resolve(dirname(outputPath)), { recursive: true });

  // For service output schemas, use TS-friendly schemas with local $ref paths
  const isOutputSchema = schemaPath.endsWith('-output.schema.json');
  let finalSchemaPath = schemaPath;
  let finalAdditionalSchemas = additionalSchemas;

  if (schemaPath.includes('/services/') && schemaPath.endsWith('-output.schema.json')) {
    // Use TS-friendly schema with local $ref paths
    const relativePath = schemaPath.replace(SCHEMAS_DIR + '/', '');
    finalSchemaPath = resolve(
      ROOT,
      '.temp-ts-schemas',
      relativePath.replace(/^(common|services)\//, '')
    );
    finalAdditionalSchemas = []; // TS-friendly schema has local $ref paths
  }

  const args = [
    '--lang',
    'typescript',
    '--out',
    outputPath,
    '--src-lang',
    'schema',
    finalSchemaPath,
    '--just-types',
    '--no-enums',
    '--prefer-unions',
  ];
  for (const additional of finalAdditionalSchemas) {
    args.push('-S', additional);
  }
  run('quicktype', args);

  // Add header
  const tsHeader = `// Generated from ${schemaPath}
  // DO NOT EDIT MANUALLY — regenerate from canonical schema
  
  `;
  const tsContent = readFileSync(outputPath, 'utf-8');
  writeFileSync(outputPath, tsHeader + tsContent);

  // Format with prettier to match committed style
  run('prettier', ['--write', outputPath]);
}

function generatePython(schemaPath: string, outputPath: string): void {
  console.log(`  Generating Python: ${outputPath}`);
  mkdirSync(resolve(dirname(outputPath)), { recursive: true });
  // Use combined schemas for Python generation to avoid cross-reference issues
  // Combined schemas are in a flat structure at .temp-combined-schemas/
  const relativePath = schemaPath.replace(SCHEMAS_DIR + '/', '');
  const combinedSchemaPath = resolve(
    ROOT,
    '.temp-combined-schemas',
    relativePath.replace(/^(common|services)\//, '')
  );
  const relativeSchemaPath = combinedSchemaPath.replace(ROOT + '/', '');
  run(
    VENV_PYTHON,
    [
      '-m',
      'datamodel_code_generator',
      '--input',
      relativeSchemaPath,
      '--input-file-type',
      'jsonschema',
      '--output',
      outputPath,
      '--output-model-type',
      'pydantic_v2.BaseModel',
      '--field-constraints',
      '--use-standard-collections',
      '--use-schema-description',
      '--use-title-as-name',
      '--reuse-model',
      '--disable-timestamp',
    ],
    ROOT
  );

  // Add header
  const pyHeader = `# Generated from ${schemaPath}
# DO NOT EDIT MANUALLY — regenerate from canonical schema

from __future__ import annotations

`;
  const pyContent = readFileSync(outputPath, 'utf-8');
  writeFileSync(outputPath, pyHeader + pyContent);
}

function main() {
  console.log('=== SITEBORNE Service Contracts Model Generation ===\n');

  // Clean output directories
  if (existsSync(TS_OUTPUT_DIR)) {
    rmSync(TS_OUTPUT_DIR, { recursive: true, force: true });
  }
  if (existsSync(PY_OUTPUT_DIR)) {
    rmSync(PY_OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(TS_OUTPUT_DIR, { recursive: true });
  mkdirSync(PY_OUTPUT_DIR, { recursive: true });

  // Generate common schemas
  console.log('\n--- Common Schemas ---');
  for (const schema of COMMON_SCHEMAS) {
    const schemaPath = resolve(SCHEMAS_DIR, 'common', schema);
    const baseName = schema.replace('.schema.json', '');
    generateTypeScript(
      resolve(SCHEMAS_DIR, 'common', schema),
      resolve(TS_OUTPUT_DIR, 'common', `${baseName}.ts`),
      COMMON_SCHEMA_PATHS
    );
    generatePython(
      resolve(SCHEMAS_DIR, 'common', schema),
      resolve(PY_OUTPUT_DIR, 'common', `${baseName}.py`)
    );
  }

  // Generate service schemas
  console.log('\n--- Service Schemas ---');
  for (const schema of SERVICE_SCHEMAS) {
    const baseName = schema.replace('.schema.json', '');
    const isOutput = schema.endsWith('-output.schema.json');
    const additionalSchemas = isOutput ? OUTPUT_SCHEMA_ADDITIONAL : COMMON_SCHEMA_PATHS;
    generateTypeScript(
      resolve(SCHEMAS_DIR, 'services', schema),
      resolve(TS_OUTPUT_DIR, 'services', `${baseName}.ts`),
      additionalSchemas
    );
    generatePython(
      resolve(SCHEMAS_DIR, 'services', schema),
      resolve(PY_OUTPUT_DIR, 'services', `${baseName}.py`),
      true
    );
  }

  // Also generate PCC schema (already exists but regenerate for consistency)
  console.log('\n--- PCC Schema ---');
  const pccTsPath = resolve(TS_OUTPUT_DIR, 'pcc.ts');
  const pccPyPath = resolve(PY_OUTPUT_DIR, 'pcc.py');
  generateTypeScript(
    resolve(SCHEMAS_DIR, 'proof-carrying-context.schema.json'),
    pccTsPath,
    COMMON_SCHEMA_PATHS
  );
  generatePython(resolve(SCHEMAS_DIR, 'proof-carrying-context.schema.json'), pccPyPath);

  // Format PCC TypeScript model with prettier (uses actual output path)
  run('prettier', ['--write', pccTsPath]);

  console.log('\n✓ Generation complete');
  console.log(`  TypeScript: ${TS_OUTPUT_DIR}`);
  console.log(`  Python: ${PY_OUTPUT_DIR}`);
}

main();
