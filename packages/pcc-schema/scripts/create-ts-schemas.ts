#!/usr/bin/env node
// Create TypeScript-friendly schemas by replacing external $ref URLs with local paths
// This allows quicktype to resolve references locally

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, copyFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SCHEMAS_DIR = resolve(__dirname, '../../../schemas');
const OUTPUT_DIR = resolve(__dirname, '../../../.temp-ts-schemas');

function loadSchema(relativePath: string): any {
  const fullPath = resolve(__dirname, '../../../schemas', relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf-8'));
}

// Replace external $ref URLs with local paths
function replaceExternalRefs(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => replaceExternalRefs(item));
  }
  
  if (obj.$ref) {
    const refPath = obj.$ref;
    if (refPath.startsWith('https://siteborne.net/schemas/')) {
      // Convert to local path
      const localPath = refPath.replace('https://siteborne.net/schemas/', '');
      return { $ref: localPath };
    }
    if (refPath.startsWith('https://utility.siteborne.net/schemas/')) {
      const localPath = refPath.replace('https://utility.siteborne.net/schemas/', '');
      return { $ref: localPath };
    }
    return obj;
  }
  
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = replaceExternalRefs(value);
  }
  return result;
}

function main() {
  console.log('=== Creating TypeScript-friendly schemas ===\n');
  
  const schemaFiles = [
    'services/company-evidence-output.schema.json',
    'services/web-context-output.schema.json',
    'services/document-evidence-output.schema.json',
    'services/agent-verification-output.schema.json',
  ];
  
  const outputDir = resolve(__dirname, '../../../.temp-ts-schemas');
  if (existsSync(resolve(__dirname, '../../../.temp-ts-schemas'))) {
    rmSync(resolve(__dirname, '../../../.temp-ts-schemas'), { recursive: true, force: true });
  }
  mkdirSync(resolve(__dirname, '../../../.temp-ts-schemas'), { recursive: true });
  
  // Also copy the PCC schema so quicktype can find it
  const pccSchema = loadSchema('proof-carrying-context.schema.json');
  writeFileSync(resolve(__dirname, '../../../.temp-ts-schemas', 'proof-carrying-context.schema.json'), JSON.stringify(pccSchema, null, 2));
  console.log('Copied PCC schema');

  // Copy common schemas too — output schemas may $ref a common schema (e.g.
  // document-evidence-output.schema.json -> common/money.schema.json) from
  // deep inside their extension payload, not just the PCC root.
  const commonOutputDir = resolve(__dirname, '../../../.temp-ts-schemas', 'common');
  mkdirSync(commonOutputDir, { recursive: true });
  const commonDir = resolve(SCHEMAS_DIR, 'common');
  for (const entry of readdirSync(commonDir)) {
    copyFileSync(resolve(commonDir, entry), resolve(commonOutputDir, entry));
  }
  console.log('Copied common schemas');
  
  for (const file of schemaFiles) {
    const schema = loadSchema(file);
    const modified = replaceExternalRefs(schema);
    
    const outputPath = resolve(__dirname, '../../../.temp-ts-schemas', file.replace('services/', ''));
    writeFileSync(outputPath, JSON.stringify(modified, null, 2));
    console.log(`Created TS-friendly schema: ${file}`);
  }
  
  console.log('\n✓ TypeScript-friendly schemas created in .temp-ts-schemas/');
}

main();