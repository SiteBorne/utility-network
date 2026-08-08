import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, '..');

const VALID_RESULT_CLASSES = new Set([
  'success',
  'partial',
  'verified_absent_candidate',
  'not_found',
  'policy_blocked',
  'invalid_request',
  'rate_limited',
  'retryable_failure',
  'permanent_failure',
  'source_changed',
  'quarantined',
  'n/a',
]);

interface MatrixRow {
  scenario_id: string;
  provider_id: string;
  capability: string;
  category: string;
  scenario: string;
  fixture: string;
  expected_result_class: string;
  expected_warning: string;
  expected_network_calls: number | string;
  expected_cache: string;
  expected_provenance: string;
  expected_audit: string;
  test_file: string;
  test_anchor: string;
}

function loadMatrix(): MatrixRow[] {
  const matrixPath = join(PACKAGE_ROOT, 'fixtures', 'FIXTURE_MATRIX.yaml');
  const content = readFileSync(matrixPath, 'utf-8');
  const doc = parse(content) as { scenarios: MatrixRow[] };
  if (!doc || !Array.isArray(doc.scenarios)) {
    throw new Error('FIXTURE_MATRIX.yaml must have a top-level "scenarios" array');
  }
  return doc.scenarios;
}

/** Result-class extraction that tolerates parenthetical clarifications, e.g.
 * "source_changed (policy blocks continuation in this row)" -> source_changed. */
function extractResultClass(value: string): string {
  return value.split(/\s|\(/)[0].trim();
}

const testFileCache = new Map<string, string>();

function readTestFile(relativePath: string): string {
  const cached = testFileCache.get(relativePath);
  if (cached !== undefined) return cached;
  const fullPath = join(PACKAGE_ROOT, relativePath);
  if (!existsSync(fullPath)) {
    testFileCache.set(relativePath, '');
    return '';
  }
  const content = readFileSync(fullPath, 'utf-8');
  testFileCache.set(relativePath, content);
  return content;
}

function testAnchorFound(testFile: string, anchor: string): boolean {
  const content = readTestFile(testFile);
  if (!content) return false;
  // Some scenarios are covered by data-driven `it()` titles built from a
  // `cases`/array literal at parameterization time (e.g.
  // `it(\`rejects ${description}: ${url}\`, ...)`), so the literal test title
  // does not appear verbatim in source. We therefore check that the anchor
  // text appears anywhere in the file — either directly in an `it(...)`
  // title, or in the literal array data that parameterizes one — which still
  // fails the check if the scenario is genuinely removed, while tolerating
  // parameterized test patterns.
  return content.includes(anchor);
}

function fixtureExists(fixtureField: string): { checked: boolean; ok: boolean; path?: string } {
  // Rows using "none", "none (...)" or "inline: ..." don't reference a fixture
  // file on disk — nothing to check.
  if (
    fixtureField === 'none' ||
    fixtureField.startsWith('none ') ||
    fixtureField.startsWith('inline') ||
    fixtureField.startsWith("'inline") ||
    fixtureField.startsWith('none (generated)')
  ) {
    return { checked: false, ok: true };
  }
  const fixturePath = join(PACKAGE_ROOT, 'fixtures', fixtureField);
  return { checked: true, ok: existsSync(fixturePath), path: fixturePath };
}

function verifyMatrix(): void {
  console.log('=== Fixture Matrix Verification ===\n');

  const rows = loadMatrix();
  const seenIds = new Set<string>();
  let passed = 0;
  let failed = 0;

  for (const row of rows) {
    const errors: string[] = [];

    if (!row.scenario_id) {
      errors.push('missing scenario_id');
    } else if (seenIds.has(row.scenario_id)) {
      errors.push(`duplicate scenario_id: ${row.scenario_id}`);
    } else {
      seenIds.add(row.scenario_id);
    }

    const resultClass = extractResultClass(String(row.expected_result_class ?? ''));
    if (!VALID_RESULT_CLASSES.has(resultClass)) {
      errors.push(`invalid expected_result_class: "${row.expected_result_class}"`);
    }

    const fixtureCheck = fixtureExists(String(row.fixture ?? ''));
    if (fixtureCheck.checked && !fixtureCheck.ok) {
      errors.push(`referenced fixture not found: ${row.fixture}`);
    }

    if (!row.test_file || !existsSync(join(PACKAGE_ROOT, row.test_file))) {
      errors.push(`test_file not found: ${row.test_file}`);
    } else if (!row.test_anchor || !testAnchorFound(row.test_file, row.test_anchor)) {
      errors.push(`no it(...) in ${row.test_file} matches test_anchor: "${row.test_anchor}"`);
    }

    if (errors.length > 0) {
      console.error(`❌ ${row.scenario_id || '(missing id)'}: ${errors.join('; ')}`);
      failed++;
    } else {
      console.log(`✅ ${row.scenario_id}`);
      passed++;
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

verifyMatrix();
