#!/usr/bin/env node
// Create combined schema files by inlining all $ref references
// This allows Python generation to work without external references

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SCHEMAS_DIR = resolve(__dirname, '../../../schemas');
const TEMP_DIR = resolve(ROOT, '.temp-combined-schemas');

// Load all schemas
function loadSchema(relativePath: string): any {
  const fullPath = resolve(SCHEMAS_DIR, relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf-8'));
}

// Deep clone and inline all $ref references
function inlineRefs(obj: any, schemas: Map<string, any>, visited = new Set()): any {
  if (obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => inlineRefs(item, schemas, visited));
  }

  if (obj.$ref) {
    const refPath = obj.$ref;
    // Handle external URLs - convert to local paths
    let localPath = refPath;
    if (refPath.startsWith('https://siteborne.net/schemas/')) {
      localPath = refPath.replace('https://siteborne.net/schemas/', '');
    } else if (refPath.startsWith('https://utility.siteborne.net/schemas/')) {
      localPath = refPath.replace('https://utility.siteborne.net/schemas/', '');
    }

    if (schemas.has(localPath)) {
      const referenced = schemas.get(localPath);
      // Avoid circular references
      const refKey = JSON.stringify(referenced);
      if (visited.has(refKey)) {
        return { $ref: localPath }; // Keep as ref to avoid infinite recursion
      }
      visited.add(refKey);
      const inlined = inlineRefs(referenced, schemas, visited);
      visited.delete(refKey);
      return inlined;
    }
    return obj; // Keep as-is if not found
  }

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = inlineRefs(value, schemas, visited);
  }
  return result;
}

function main() {
  console.log('=== Creating combined schemas ===\n');

  // Load all schemas
  const schemaFiles = [
    'common/money.schema.json',
    'common/request-envelope.schema.json',
    'common/quote-request.schema.json',
    'common/quote-response.schema.json',
    'common/structured-error.schema.json',
    'common/service-metadata.schema.json',
    'common/async-job.schema.json',
    'common/pagination.schema.json',
    'common/authorized-artifact-reference.schema.json',
    'services/company-evidence-input.schema.json',
    'services/company-evidence-output.schema.json',
    'services/web-context-input.schema.json',
    'services/web-context-output.schema.json',
    'services/document-evidence-input.schema.json',
    'services/document-evidence-output.schema.json',
    'services/agent-verification-input.schema.json',
    'services/agent-verification-output.schema.json',
    'proof-carrying-context.schema.json',
  ];

  const schemas = new Map<string, any>();
  for (const file of schemaFiles) {
    try {
      const schema = loadSchema(file);
      schemas.set(file, schema);
      console.log(`Loaded: ${file}`);
    } catch (e) {
      console.error(`Failed to load ${file}:`, e);
    }
  }

  // Create output directory
  const outputDir = resolve(__dirname, '../../../.temp-combined-schemas');
  if (existsSync(resolve(__dirname, '../../../.temp-combined-schemas'))) {
    rmSync(resolve(__dirname, '../../../.temp-combined-schemas'), { recursive: true, force: true });
  }
  mkdirSync(resolve(__dirname, '../../../.temp-combined-schemas'), { recursive: true });

  // Create combined schemas for each service
  const serviceSchemas = [
    'services/company-evidence-input.schema.json',
    'services/company-evidence-output.schema.json',
    'services/web-context-input.schema.json',
    'services/web-context-output.schema.json',
    'services/document-evidence-input.schema.json',
    'services/document-evidence-output.schema.json',
    'services/agent-verification-input.schema.json',
    'services/agent-verification-output.schema.json',
  ];

  for (const serviceSchema of serviceSchemas) {
    const original = schemas.get(serviceSchema);
    if (!original) {
      console.error(`Schema not found: ${serviceSchema}`);
      continue;
    }

    // Inline all references
    const combined = inlineRefs(original, schemas);

    // Write combined schema
    const outputPath = resolve(
      __dirname,
      '../../../.temp-combined-schemas',
      serviceSchema.replace('services/', '')
    );
    writeFileSync(outputPath, JSON.stringify(combined, null, 2));
    console.log(`Created combined schema: ${serviceSchema}`);
  }

  // Also create combined common schemas
  const commonSchemas = [
    'common/money.schema.json',
    'common/request-envelope.schema.json',
    'common/quote-request.schema.json',
    'common/quote-response.schema.json',
    'common/structured-error.schema.json',
    'common/service-metadata.schema.json',
    'common/async-job.schema.json',
    'common/pagination.schema.json',
    'common/authorized-artifact-reference.schema.json',
  ];

  for (const commonSchema of commonSchemas) {
    const original = schemas.get(commonSchema);
    if (!original) continue;

    const combined = inlineRefs(original, schemas);
    const outputPath = resolve(
      __dirname,
      '../../../.temp-combined-schemas',
      commonSchema.replace('common/', '')
    );
    writeFileSync(outputPath, JSON.stringify(combined, null, 2));
    console.log(`Created combined common schema: ${commonSchema}`);
  }

  // Also create combined PCC schema
  const pccSchema = schemas.get('proof-carrying-context.schema.json');
  if (pccSchema) {
    const combined = inlineRefs(pccSchema, schemas);
    writeFileSync(
      resolve(__dirname, '../../../.temp-combined-schemas', 'proof-carrying-context.schema.json'),
      JSON.stringify(combined, null, 2)
    );
    console.log('Created combined PCC schema');
  }

  console.log('\n✓ Combined schemas created in .temp-combined-schemas/');
}

main();
