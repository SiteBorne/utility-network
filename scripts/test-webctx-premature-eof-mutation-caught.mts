#!/usr/bin/env -S npx tsx
/**
 * SUN-1221E4P §27 — mutation proof for this checkpoint's two new
 * diagnostic tags: `WEBCTX_HTTP_PREMATURE_EOF` (clean `done: true` before
 * headers/chunk complete) and `WEBCTX_HTTP_INVALID_RESPONSE_STATUS` (the
 * platform `Response` constructor rejecting a 1xx status). Each mutation
 * reverts one exact anchor to its pre-E4P (generic-collapsing) form,
 * proves the relevant test files FAIL against the mutant, then restores
 * byte-for-byte (verified via SHA-256) regardless of outcome.
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
  'packages/provider-adapters/src/tests/socket-http-client-premature-eof.test.ts',
  'packages/provider-adapters/src/tests/socket-http-client-fragmentation.test.ts',
  'packages/provider-adapters/src/tests/socket-http-client-read-diagnostics.test.ts',
  'packages/provider-adapters/src/tests/web-context-diagnostic-classification.test.ts',
];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// A mutant that turns a loop's error-exit into a silent no-op (rather than
// a clean assertion failure) can spin the fragmentation tests' mock reader
// forever instead of failing fast. Bound every invocation with a hard
// timeout + SIGKILL so a hanging mutant is reported as CAUGHT (the suite
// never completed = never passed) instead of hanging the whole checkpoint,
// and always sweep any leaked worker processes afterward regardless of
// outcome.
const TEST_TIMEOUT_MS = 90_000;

function sweepLeakedWorkers(): void {
  try {
    execFileSync('pkill', ['-9', '-f', 'socket-http-client-premature-eof.test.ts'], { stdio: 'ignore' });
  } catch {
    // No matching process (the common case) throws a non-zero exit; ignore.
  }
}

function runTests(): { passed: boolean; output: string } {
  try {
    const output = execFileSync(PNPM, ['exec', 'vitest', 'run', ...TEST_RELS], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: TEST_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    return { passed: true, output };
  } catch (error) {
    const e = error as { stdout?: Buffer | string; stderr?: Buffer | string; signal?: string | null };
    const timedOut = e.signal === 'SIGKILL';
    const output = `${e.stdout ?? ''}${e.stderr ?? ''}${timedOut ? '\n[harness] killed after exceeding 90s timeout (treated as CAUGHT: suite never completed)' : ''}`;
    return { passed: false, output };
  } finally {
    sweepLeakedWorkers();
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
    name: '1. header-loop premature close reverts to the untagged (pre-E4P) message',
    target: SOCKET_CLIENT,
    from: `if (done) throw new Error('WEBCTX_HTTP_PREMATURE_EOF: connection closed before response headers completed');`,
    to: `if (done) throw new Error('Connection closed before response headers completed'); // MUTATED: E4P tag removed`,
  },
  {
    name: '2. chunk-loop premature close reverts to the untagged (pre-E4P) message',
    target: SOCKET_CLIENT,
    from: `if (done) throw new Error('WEBCTX_HTTP_PREMATURE_EOF: connection closed mid-chunk');`,
    to: `if (done) throw new Error('Connection closed mid-chunk'); // MUTATED: E4P tag removed`,
  },
  {
    name: '3. Response-construction RangeError wrap removed (1xx status throws unwrapped again)',
    target: SOCKET_CLIENT,
    from: `    try {
      return new Response(body, { status, statusText, headers: responseHeaders });
    } catch (err) {
      // SUN-1221E4P §14/§6 — found via the 1xx-interim-response
      // characterization test: the platform's \`Response\` constructor
      // rejects an informational (1xx) status with an unwrapped
      // \`RangeError\`. This parser has no loop to discard a 1xx interim
      // response and keep reading for the real final status line (a real,
      // separately-tracked defect, deliberately NOT fixed here per this
      // checkpoint's evidence law) -- but the resulting construction
      // failure was, until now, an untagged generic error. Diagnostic-
      // tagging only: a response whose status already constructs
      // successfully is completely unaffected.
      throw new Error(
        \`WEBCTX_HTTP_INVALID_RESPONSE_STATUS: \${err instanceof Error ? err.message : String(err)} (status=\${status})\`,
        { cause: err }
      );
    }`,
    to: `    return new Response(body, { status, statusText, headers: responseHeaders }); // MUTATED: E4P wrap removed`,
  },
  {
    name: '4. errors.ts no longer classifies the WEBCTX_HTTP_PREMATURE_EOF prefix (falls back to generic bucket)',
    target: ERRORS,
    from: `  { pattern: /^WEBCTX_HTTP_PREMATURE_EOF:/, reason: 'WEBCTX_HTTP_PREMATURE_EOF' },\n`,
    to: '',
  },
  {
    name: '5. errors.ts no longer classifies the WEBCTX_HTTP_INVALID_RESPONSE_STATUS prefix (falls back to generic bucket)',
    target: ERRORS,
    from: `  { pattern: /^WEBCTX_HTTP_INVALID_RESPONSE_STATUS:/, reason: 'WEBCTX_HTTP_INVALID_RESPONSE_STATUS' },\n`,
    to: '',
  },
  {
    name: '6. WEBCTX_HTTP_PREMATURE_EOF given the wrong reason string (precision loss, not just removal)',
    target: ERRORS,
    from: `{ pattern: /^WEBCTX_HTTP_PREMATURE_EOF:/, reason: 'WEBCTX_HTTP_PREMATURE_EOF' }`,
    to: `{ pattern: /^WEBCTX_HTTP_PREMATURE_EOF:/, reason: 'WEBCTX_UPSTREAM_PROTOCOL_ERROR' } /* MUTATED: wrong reason */`,
  },
  {
    name: '7. the chunk-loop premature-close branch is silently accepted instead of thrown (framing error ignored)',
    target: SOCKET_CLIENT,
    from: `        if (done) throw new Error('WEBCTX_HTTP_PREMATURE_EOF: connection closed mid-chunk');
        buffered = concat(buffered, value);`,
    to: `        if (done) { /* MUTATED: premature close silently accepted */ }
        buffered = concat(buffered, value ?? new Uint8Array(0));`,
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
