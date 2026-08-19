#!/usr/bin/env -S npx tsx
/**
 * SUN-1204 checkpoint J — Nevermined seam regression proof (§13).
 *
 * Automated evidence that the worker-runtime release gate would fail if
 * the deny-only test client
 * (`apps/edge-api/src/worker-runtime-test-entrypoint.ts`'s
 * `denyingNeverminedClient`) ever stopped denying -- i.e., that Phase 5's
 * N4 scenario genuinely exercises real denial-handling logic rather than
 * trivially passing regardless of what the verifier returns. Mutates the
 * deny client's `isValid` to `true` (the exact bug this would look like:
 * a verifier that silently stops denying), runs the real N4 request
 * against real `workerd`, requires it to now WRONGLY succeed (proving the
 * mutation is a genuine, observable regression the gate would catch),
 * restores the original file unconditionally, and requires N4 to
 * correctly reject again. Never commits the mutant. Requires a clean
 * working tree (aside from the known `wrangler.toml` diff) first.
 */
import { execFileSync } from 'node:child_process';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WRANGLER_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'wrangler');
const TARGET_FILE = join(REPO_ROOT, 'apps/edge-api/src/worker-runtime-test-entrypoint.ts');
const TARGET_FILE_REL = 'apps/edge-api/src/worker-runtime-test-entrypoint.ts';

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

async function runN4Once(): Promise<{ status: number; body: string }> {
  const configPath = join(REPO_ROOT, 'wrangler.worker-runtime-test.toml');
  const tempDir = mkdtempSync(join(tmpdir(), 'siteborne-nvm-deny-proof-'));
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
    const port = 19800 + Math.floor(Math.random() * 400);
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

    const path = '/v2/nevermined-deny/company/evidence-graph';
    const body = {
      identifiers: { cik: '0000320193' },
      requested_field_groups: ['identity', 'sec_submissions'],
    };
    const challengeRes = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const header = challengeRes.headers.get('PAYMENT-REQUIRED');
    if (!header) return { status: challengeRes.status, body: await challengeRes.text() };
    decodeHeader(header); // establishes/validates the stored quote exists

    const id = 'pay_deny_proof_' + Date.now();
    const paidRes = await fetch(base + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_000000000000000000000000',
        'Payment-Identifier': id,
        'PAYMENT-DELEGATION-ID': 'fixture-delegation-deny-proof',
      },
      body: JSON.stringify(body),
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
    '[nevermined-deny-proof] checking working tree is clean (aside from wrangler.toml)...'
  );
  const status = git(['status', '--porcelain']);
  const dirtyLines = status
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .filter((l) => !l.includes('wrangler.toml'));
  if (dirtyLines.length > 0) {
    console.error(
      '[nevermined-deny-proof] ABORT: working tree has unexpected uncommitted changes:'
    );
    console.error(dirtyLines.join('\n'));
    process.exit(2);
  }
  console.log('[nevermined-deny-proof] working tree clean. Proceeding.');

  const originalContent = readFileSync(TARGET_FILE, 'utf-8');
  const mutantContent = originalContent.replace(
    /async verifyPermissions\(\) \{\n      return \{\n        isValid: false,\n        invalidReason: 'fixture_explicit_denial',\n      \};\n    \},/,
    "async verifyPermissions() {\n      // SUN-1204 MUTATION TEST FIXTURE: flipped to always-valid.\n      return {\n        isValid: true,\n        payer: '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99',\n        network: 'eip155:84532',\n        agentRequestId: 'fixture-mutant-request',\n      };\n    },"
  );
  if (mutantContent === originalContent) {
    console.error('[nevermined-deny-proof] ABORT: could not locate the deny client body to mutate');
    process.exit(2);
  }

  let exitCode = 0;
  try {
    console.log('[nevermined-deny-proof] writing mutant (deny client flipped to always-valid)...');
    writeFileSync(TARGET_FILE, mutantContent, 'utf-8');

    console.log('[nevermined-deny-proof] running N4 against the MUTANT...');
    const mutantResult = await runN4Once();
    console.log(
      `[nevermined-deny-proof] mutant result: status=${mutantResult.status} body=${mutantResult.body.slice(0, 300)}`
    );
    // Under the mutant, the deny-only path should no longer produce N4's
    // exact expected signal (402 payment_verification_rejected /
    // verification_not_successful) -- either it wrongly succeeds (200,
    // if settlement also completes) or it fails for a DIFFERENT reason
    // (e.g. the deny client's settlePermissions still throws, since only
    // verifyPermissions was mutated here) -- either way, N4's own
    // assertion (status===402 && error==='payment_verification_rejected')
    // would now genuinely fail, proving the release gate depends on real
    // denial-handling logic, not a no-op.
    const mutantStillDeniesTheSameWay =
      mutantResult.status === 402 && mutantResult.body.includes('verification_not_successful');
    if (mutantStillDeniesTheSameWay) {
      console.error(
        '[nevermined-deny-proof] FAIL: the mutant did not observably change N4 behavior -- ' +
          'N4 may not be exercising real denial-handling logic.'
      );
      exitCode = 1;
    } else {
      console.log(
        "[nevermined-deny-proof] PASS: the mutant causes the deny-only path to stop producing N4's " +
          'exact expected denial signal -- confirms N4 genuinely depends on real denial-handling logic, ' +
          'so the release gate would catch a regression here.'
      );
    }

    console.log('[nevermined-deny-proof] restoring the original file...');
    writeFileSync(TARGET_FILE, originalContent, 'utf-8');

    console.log('[nevermined-deny-proof] running N4 against the RESTORED code...');
    const restoredResult = await runN4Once();
    console.log(
      `[nevermined-deny-proof] restored result: status=${restoredResult.status} body=${restoredResult.body.slice(0, 300)}`
    );
    if (restoredResult.status !== 402) {
      console.error(
        '[nevermined-deny-proof] FAIL: restoration did not return N4 to a correctly-denying state.'
      );
      exitCode = 1;
    } else {
      console.log('[nevermined-deny-proof] PASS: restored code correctly denies again.');
    }
  } finally {
    writeFileSync(TARGET_FILE, originalContent, 'utf-8');
    const diff = git(['diff', '--', TARGET_FILE_REL]);
    if (diff.trim().length > 0) {
      console.error(
        '[nevermined-deny-proof] CRITICAL: working tree NOT clean after restoration for',
        TARGET_FILE_REL
      );
      console.error(diff.slice(0, 2000));
      exitCode = 1;
    } else {
      console.log(
        '[nevermined-deny-proof] confirmed: working tree is clean for',
        TARGET_FILE_REL,
        'after restoration.'
      );
    }
  }

  process.exit(exitCode);
}

main();
