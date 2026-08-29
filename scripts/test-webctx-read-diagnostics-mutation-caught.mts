#!/usr/bin/env -S npx tsx
/**
 * SUN-1221E3P §24 — mutation proof for the response-read diagnostic wrap
 * (`readOrThrow` in `socket-http-client.ts` + its pattern registration in
 * `errors.ts`). Six narrow proofs, each mutating one exact anchor string,
 * running the three relevant test files against the mutant, requiring
 * FAIL, then restoring the original byte-for-byte (verified via SHA-256)
 * in a `finally` block regardless of outcome.
 *
 * Never commits a mutant. Each proof restores its own target
 * unconditionally, so a failure in one never leaves another unrestored.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PNPM = process.env.PNPM_EXECUTABLE ?? 'pnpm';

const SOCKET_CLIENT = join(REPO_ROOT, 'packages/provider-adapters/src/http/socket-http-client.ts');
const ERRORS = join(REPO_ROOT, 'packages/provider-adapters/src/errors.ts');

const TEST_RELS = [
  'packages/provider-adapters/src/tests/socket-http-client-read-diagnostics.test.ts',
  'packages/provider-adapters/src/tests/socket-http-client-fragmentation.test.ts',
  'packages/provider-adapters/src/tests/web-context-transport-diagnostics.test.ts',
  'packages/provider-adapters/src/tests/web-context-diagnostic-classification.test.ts',
];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function runTests(): { passed: boolean; output: string } {
  try {
    const output = execFileSync(PNPM, ['exec', 'vitest', 'run', ...TEST_RELS], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { passed: true, output };
  } catch (error) {
    const e = error as { stdout?: Buffer | string; stderr?: Buffer | string };
    return { passed: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

interface Mutation {
  name: string;
  target: string;
  from: string;
  to: string;
}

const MUTATIONS: Mutation[] = [
  {
    name: '1. readOrThrow no longer tags a raw read() rejection (passes it through unwrapped)',
    target: SOCKET_CLIENT,
    from: `  try {
    return await reader.read();
  } catch (err) {
    throw new Error(\`WEBCTX_RESPONSE_READ_FAILED: \${err instanceof Error ? err.message : String(err)}\`, {
      cause: err,
    });
  }`,
    to: `  return await reader.read(); // MUTATED: tagging removed`,
  },
  {
    name: '2. readOrThrow drops the .cause chain (original error no longer recoverable)',
    target: SOCKET_CLIENT,
    from: `    throw new Error(\`WEBCTX_RESPONSE_READ_FAILED: \${err instanceof Error ? err.message : String(err)}\`, {
      cause: err,
    });`,
    to: `    throw new Error(\`WEBCTX_RESPONSE_READ_FAILED: \${err instanceof Error ? err.message : String(err)}\`); // MUTATED: cause dropped`,
  },
  {
    name: '3. header-read loop reverts to bare reader.read() (one of four call sites un-wrapped)',
    target: SOCKET_CLIENT,
    from: `      let headerEnd = -1;
      while (headerEnd === -1) {
        const { done, value } = await readOrThrow(reader);`,
    to: `      let headerEnd = -1;
      while (headerEnd === -1) {
        const { done, value } = await reader.read(); // MUTATED: header-phase call site un-wrapped`,
  },
  {
    name: '4. readChunkedBody\'s ensure() reverts to bare reader.read() (chunk-phase call site un-wrapped)',
    target: SOCKET_CLIENT,
    from: `      while (buffered.length < minBytes) {
        const { done, value } = await readOrThrow(reader);
        if (done) throw new Error('Connection closed mid-chunk');`,
    to: `      while (buffered.length < minBytes) {
        const { done, value } = await reader.read(); // MUTATED: chunk-phase call site un-wrapped
        if (done) throw new Error('Connection closed mid-chunk');`,
  },
  {
    name: '5. errors.ts no longer classifies the WEBCTX_RESPONSE_READ_FAILED prefix (falls back to generic bucket)',
    target: ERRORS,
    from: `  { pattern: /^WEBCTX_RESPONSE_READ_FAILED:/, reason: 'WEBCTX_RESPONSE_READ_FAILED' },\n`,
    to: '',
  },
  {
    name: '6. WEBCTX_RESPONSE_READ_FAILED pattern shadowed by an over-broad earlier match (loses precision)',
    target: ERRORS,
    from: `  { pattern: /^WEBCTX_RESPONSE_READ_FAILED:/, reason: 'WEBCTX_RESPONSE_READ_FAILED' },`,
    to: `  { pattern: /platform/, reason: 'WEBCTX_UPSTREAM_PROTOCOL_ERROR' }, // MUTATED: over-broad shadow inserted before the real pattern\n  { pattern: /^WEBCTX_RESPONSE_READ_FAILED:/, reason: 'WEBCTX_RESPONSE_READ_FAILED' },`,
  },
];

function applyAndRun(m: Mutation): { name: string; caught: boolean; detail: string } {
  const original = readFileSync(m.target, 'utf8');
  const originalHash = hash(original);
  if (!original.includes(m.from)) {
    return { name: m.name, caught: false, detail: 'SKIPPED: anchor string not found in target file' };
  }
  const mutated = original.replace(m.from, m.to);
  try {
    writeFileSync(m.target, mutated, 'utf8');
    const result = runTests();
    return {
      name: m.name,
      caught: !result.passed,
      detail: result.passed ? 'NOT CAUGHT: tests still passed against the mutant' : 'caught: tests failed as required',
    };
  } finally {
    const restored = readFileSync(m.target, 'utf8');
    if (restored !== mutated) {
      // Someone else changed the file mid-run; do not blindly overwrite.
      throw new Error(`refusing to restore ${m.target}: unexpected concurrent modification detected`);
    }
    writeFileSync(m.target, original, 'utf8');
    const restoredHash = hash(readFileSync(m.target, 'utf8'));
    if (restoredHash !== originalHash) {
      throw new Error(`FATAL: ${m.target} was not restored byte-for-byte after mutation "${m.name}"`);
    }
  }
}

let caughtCount = 0;
let skippedCount = 0;
for (const m of MUTATIONS) {
  const result = applyAndRun(m);
  if (result.detail.startsWith('SKIPPED')) {
    skippedCount++;
    console.log(`⚠️  SKIPPED — ${result.name}\n   ${result.detail}`);
  } else if (result.caught) {
    caughtCount++;
    console.log(`✅ CAUGHT — ${result.name}`);
  } else {
    console.log(`❌ NOT CAUGHT — ${result.name}\n   ${result.detail}`);
  }
}

console.log(`\n${caughtCount}/${MUTATIONS.length} mutations caught (${skippedCount} skipped).`);

const finalCheck = runTests();
console.log(
  finalCheck.passed
    ? '\n✅ Final re-run against fully-restored source: GREEN.'
    : `\n❌ FATAL: fully-restored source is NOT green:\n${finalCheck.output}`
);

if (caughtCount !== MUTATIONS.length || skippedCount > 0 || !finalCheck.passed) {
  process.exitCode = 1;
}
