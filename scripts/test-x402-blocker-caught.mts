#!/usr/bin/env -S npx tsx
/**
 * SUN-1202 checkpoint H — blocker regression proof (§7 H9).
 *
 * Automated evidence that the worker-runtime release gate would fail if
 * `sanitizePaymentIdentifierExtensionForValidation` were ever removed
 * from `parsePaymentIdentifier`'s call path -- reintroducing the
 * SUN-1201 `FUNCTIONAL_BLOCKER` (a real, official-buyer-helper-compatible
 * payment identifier rejected as "malformed" under real `workerd`).
 *
 * Mutates `packages/protocol-x402/src/identifier/payment-identifier.ts`
 * in place (removes the one line that calls the sanitizer, reverting
 * `parsePaymentIdentifier` to call `extractAndValidatePaymentIdentifier`
 * directly on the unsanitized payload -- exactly SUN-1201's original,
 * broken behavior), runs the real Case A scenario (which echoes the
 * upstream-declared `schema` field, exactly as SITEBORNE's official
 * buyer helper does) against real `workerd`, requires it to fail with
 * `malformed_payment_signature`, restores the original file
 * unconditionally, and requires Case A to pass again. Never commits the
 * mutant. Requires a clean working tree (aside from the known
 * `wrangler.toml` diff) before doing anything.
 */
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WRANGLER_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'wrangler');
const TARGET_FILE = join(REPO_ROOT, 'packages/protocol-x402/src/identifier/payment-identifier.ts');
const TARGET_FILE_REL = 'packages/protocol-x402/src/identifier/payment-identifier.ts';

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' });
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'pipe' });
    let output = '';
    child.stdout?.on('data', (d) => (output += String(d)));
    child.stderr?.on('data', (d) => (output += String(d)));
    child.on('error', (err) => reject(new Error(`failed to spawn ${cmd}: ${String(err)}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${output.slice(-2000)}`));
    });
  });
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`worker did not become ready within ${timeoutMs}ms: ${String(lastErr)}`);
}

function decodeHeader(header: string): any {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
}
function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
}

/** Runs a single, official-buyer-helper-shaped verify_agent_output Case A
 * request (schema echoed on the payment-identifier extension) against a
 * fresh, isolated real-`workerd` instance of the test-only settlement
 * seam. */
async function runCaseAWithEchoedSchemaOnce(): Promise<{ status: number; body: string }> {
  const configPath = join(REPO_ROOT, 'wrangler.worker-runtime-test.toml');
  const tempDir = mkdtempSync(join(tmpdir(), 'siteborne-x402-blocker-proof-'));
  let devProcess: ChildProcess | undefined;
  try {
    await runCommand(
      WRANGLER_BIN,
      [
        'd1',
        'migrations',
        'apply',
        'siteborne-worker-runtime-test',
        '--local',
        '--config',
        configPath,
        '--persist-to',
        tempDir,
      ],
      REPO_ROOT
    );
    const port = 19700 + Math.floor(Math.random() * 500);
    const base = `http://127.0.0.1:${port}`;
    devProcess = spawn(
      WRANGLER_BIN,
      ['dev', '--local', '--port', String(port), '--config', configPath, '--persist-to', tempDir],
      { cwd: REPO_ROOT, stdio: 'pipe' }
    );
    devProcess.on('error', () => {
      /* surfaced via waitForReady's own timeout */
    });
    await waitForReady(`${base}/`, 60_000);

    const caseABody = {
      verification_contract: {
        claims: [],
        deterministic_requirements: [{ requirement_id: 'schema_check', check: 'schema_valid' }],
      },
      candidate_output: { total: 42 },
      required_schema: {
        type: 'object',
        properties: { total: { type: 'number' } },
        required: ['total'],
      },
      verification_mode: 'standard',
    };
    const challengeRes = await fetch(`${base}/v1/verify/agent-output`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(caseABody),
    });
    const header = challengeRes.headers.get('PAYMENT-REQUIRED');
    if (!header) {
      return { status: challengeRes.status, body: await challengeRes.text() };
    }
    const challenge = decodeHeader(header);
    const declared = challenge.extensions?.['payment-identifier'];
    // Echoes the FULL declared extension, including `schema` -- exactly
    // what SITEBORNE's official buyer helper
    // (buildBuyerPaymentIdentifierExtensions) produces.
    const extensions = declared
      ? {
          'payment-identifier': {
            ...declared,
            info: { ...declared.info, id: 'pay_blocker_proof_' + Date.now() },
          },
        }
      : {};
    const payload = {
      x402Version: 2,
      resource: challenge.resource,
      accepted: challenge.accepts[0],
      payload: { synthetic_signature: 'synthetic:buyer-fixture' },
      extensions,
    };
    const paidRes = await fetch(`${base}/v1/verify/agent-output`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': encodeHeader(payload) },
      body: JSON.stringify(caseABody),
    });
    return { status: paidRes.status, body: await paidRes.text() };
  } finally {
    if (devProcess && !devProcess.killed) {
      devProcess.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(
    '[x402-blocker-proof] checking working tree is clean (aside from the known wrangler.toml diff)...'
  );
  const status = git(['status', '--porcelain']);
  const dirtyLines = status
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .filter((l) => !l.includes('wrangler.toml'));
  if (dirtyLines.length > 0) {
    console.error('[x402-blocker-proof] ABORT: working tree has unexpected uncommitted changes:');
    console.error(dirtyLines.join('\n'));
    process.exit(2);
  }
  console.log('[x402-blocker-proof] working tree clean. Proceeding.');

  const originalContent = readFileSync(TARGET_FILE, 'utf-8');
  const revertedContent = originalContent.replace(
    'const sanitized = sanitizePaymentIdentifierExtensionForValidation(payload);\n  const { id, validation } = extractAndValidatePaymentIdentifier(sanitized);',
    "// SUN-1202 checkpoint H MUTATION TEST FIXTURE: sanitizer call removed,\n  // reverting to SUN-1201's original, broken behavior.\n  const { id, validation } = extractAndValidatePaymentIdentifier(payload);"
  );
  if (revertedContent === originalContent) {
    console.error(
      '[x402-blocker-proof] ABORT: could not locate the expected sanitizer call in ' +
        TARGET_FILE_REL
    );
    process.exit(2);
  }

  let exitCode = 0;
  try {
    console.log('[x402-blocker-proof] writing mutant (sanitizer call removed) to', TARGET_FILE_REL);
    writeFileSync(TARGET_FILE, revertedContent, 'utf-8');

    console.log('[x402-blocker-proof] running Case A (schema echoed) against the MUTANT...');
    const mutantResult = await runCaseAWithEchoedSchemaOnce();
    console.log(
      `[x402-blocker-proof] mutant result: status=${mutantResult.status} body=${mutantResult.body.slice(0, 300)}`
    );
    let mutantBody: any = {};
    try {
      mutantBody = JSON.parse(mutantResult.body);
    } catch {
      /* leave {} */
    }
    const mutantReproducedBlocker =
      mutantResult.status === 400 && mutantBody.error === 'malformed_payment_signature';
    if (!mutantReproducedBlocker) {
      console.error(
        '[x402-blocker-proof] FAIL: the mutant did NOT reproduce the malformed_payment_signature ' +
          'blocker -- the release gate would NOT catch a regression of this fix.'
      );
      exitCode = 1;
    } else {
      console.log(
        '[x402-blocker-proof] PASS: the mutant reproduces the exact SUN-1201 blocker ' +
          '(400 malformed_payment_signature on an official-buyer-helper-shaped, structurally valid ' +
          'payment identifier) -- the release gate would catch this regression.'
      );
    }

    console.log('[x402-blocker-proof] restoring the original file...');
    writeFileSync(TARGET_FILE, originalContent, 'utf-8');

    console.log(
      '[x402-blocker-proof] running Case A (schema echoed) against the RESTORED (fixed) code...'
    );
    const restoredResult = await runCaseAWithEchoedSchemaOnce();
    console.log(
      `[x402-blocker-proof] restored result: status=${restoredResult.status} body=${restoredResult.body.slice(0, 300)}`
    );
    if (restoredResult.status !== 200) {
      console.error(
        '[x402-blocker-proof] FAIL: restoration did not return the codebase to a passing state.'
      );
      exitCode = 1;
    } else {
      console.log('[x402-blocker-proof] PASS: restored code passes Case A (schema echoed) again.');
    }
  } finally {
    writeFileSync(TARGET_FILE, originalContent, 'utf-8');
    const diff = git(['diff', '--', TARGET_FILE_REL]);
    if (diff.trim().length > 0) {
      console.error(
        '[x402-blocker-proof] CRITICAL: working tree NOT clean after restoration for',
        TARGET_FILE_REL
      );
      console.error(diff.slice(0, 2000));
      exitCode = 1;
    } else {
      console.log(
        '[x402-blocker-proof] confirmed: working tree is clean for',
        TARGET_FILE_REL,
        'after restoration.'
      );
    }
  }

  process.exit(exitCode);
}

main();
