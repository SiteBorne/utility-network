import { glob } from 'glob';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { ProviderManifestSchema } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function verifyManifests(): Promise<void> {
  console.log('=== Manifest Verification ===\n');

  const manifestFiles = await glob('manifests/*.yaml', { cwd: join(__dirname, '..') });

  let passed = 0;
  let failed = 0;

  for (const file of manifestFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const manifest = parse(content);
      const validated = ProviderManifestSchema.parse(manifest);

      console.log(`✅ ${file}: ${validated.provider_id} (${validated.capabilities.join(', ')})`);
      passed++;
    } catch (error) {
      console.error(`❌ ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      failed++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

verifyManifests().catch(console.error);
