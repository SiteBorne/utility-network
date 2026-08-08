import { glob } from 'glob';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FixtureTest {
  provider: string;
  fixture: string;
  expectedResultClass: string;
  description: string;
}

const FIXTURE_TESTS: FixtureTest[] = [
  {
    provider: 'sec-edgar',
    fixture: 'submissions-success.json',
    expectedResultClass: 'success',
    description: 'SEC submissions complete success',
  },
  {
    provider: 'sec-edgar',
    fixture: 'submissions-partial.json',
    expectedResultClass: 'success',
    description: 'SEC submissions partial',
  },
  {
    provider: 'sec-edgar',
    fixture: 'submissions-not-found.json',
    expectedResultClass: 'not_found',
    description: 'SEC submissions not found',
  },
  {
    provider: 'sec-edgar',
    fixture: 'company-facts-success.json',
    expectedResultClass: 'success',
    description: 'SEC company facts complete success',
  },
  {
    provider: 'sec-edgar',
    fixture: 'company-facts-partial.json',
    expectedResultClass: 'success',
    description: 'SEC company facts partial',
  },
  {
    provider: 'direct-public-http',
    fixture: 'html-success.html',
    expectedResultClass: 'success',
    description: 'Direct HTTP HTML success',
  },
  {
    provider: 'openalex',
    fixture: 'work-success.json',
    expectedResultClass: 'success',
    description: 'OpenAlex work success',
  },
  {
    provider: 'crossref',
    fixture: 'doi-success.json',
    expectedResultClass: 'success',
    description: 'Crossref DOI success',
  },
  {
    provider: 'github-public',
    fixture: 'repository-success.json',
    expectedResultClass: 'success',
    description: 'GitHub repository success',
  },
  {
    provider: 'federal-register',
    fixture: 'document-success.json',
    expectedResultClass: 'success',
    description: 'Federal Register document success',
  },
  {
    provider: 'html',
    fixture: 'normalization-test.html',
    expectedResultClass: 'success',
    description: 'HTML normalization with injection signals',
  },
];

async function verifyFixtures(): Promise<void> {
  console.log('=== Fixture Verification ===\n');

  let passed = 0;
  let failed = 0;

  for (const test of FIXTURE_TESTS) {
    const fixturePath = join(__dirname, '../fixtures', test.provider, test.fixture);

    try {
      const content = readFileSync(fixturePath, 'utf-8');
      const parsed = test.fixture.endsWith('.json') ? JSON.parse(content) : content;

      if (!parsed) {
        console.error(`❌ ${test.provider}/${test.fixture}: Empty or invalid fixture`);
        failed++;
        continue;
      }

      console.log(`✅ ${test.provider}/${test.fixture}: ${test.description}`);
      passed++;
    } catch (error) {
      console.error(
        `❌ ${test.provider}/${test.fixture}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
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

verifyFixtures().catch(console.error);
