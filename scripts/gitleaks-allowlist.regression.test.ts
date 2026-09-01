/**
 * SUN-1222B-S2: regression coverage for `.gitleaks.toml`'s allowlist,
 * proving the exact-value entries added to close out the forensic-report
 * findings (canonical Base mainnet USDC address and two one-off payment-
 * correlation IDs) do not widen into a class
 * suppression. Runs the real `gitleaks` binary (skips, rather than fails,
 * if it isn't on PATH -- consistent with `secrets:scan` already hard-
 * depending on it) against synthetic fixtures under a throwaway temp
 * directory, never against this repository's own tree.
 *
 * Every fixture value below is synthetic/placeholder, invented for this
 * test -- none is a real credential, and the "near-miss" values are the
 * canonical/allowlisted public values from `.gitleaks.toml` with exactly
 * one digit changed. Synthetic detector values are assembled at runtime so
 * this test file itself remains clean under the working-tree scan.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const configPath = join(repositoryRoot, '.gitleaks.toml');

const gitleaksAvailable = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;

function scan(cwd: string): { status: number; files: Set<string> } {
  const reportPath = join(cwd, '.gitleaks-report.json');
  const result = spawnSync(
    'gitleaks',
    [
      'dir',
      '.',
      '--config',
      configPath,
      '--report-format',
      'json',
      '--report-path',
      reportPath,
      '--exit-code',
      '0',
    ],
    { cwd, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`gitleaks invocation itself failed: ${result.stderr || result.stdout}`);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Array<{
    File: string;
  }>;
  return { status: result.status, files: new Set(report.map((finding) => finding.File)) };
}

describe.skipIf(!gitleaksAvailable)('gitleaks allowlist precision', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitleaks-allowlist-regression-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, '.claude', 'worktrees', 'fakeworktree', 'docs'), { recursive: true });

    const canonicalUsdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const unknownBlockchainLikeValue = `${canonicalUsdc.slice(0, -1)}4`;

    // --- must stay suppressed: the exact allowlisted values ---
    writeFileSync(
      join(dir, 'canonical-usdc.md'),
      `BASESCAN_TOKEN_CONTRACT  = ${canonicalUsdc}  (matches authorized USDC asset)\n`
    );
    writeFileSync(
      join(dir, 'canonical-payment-ids.md'),
      'OLD_AUTH_PAYMENT_ATTEMPT_ID=pay_5b90677d6a7d4a178bec037e21409e22\n' +
        'idempotency_key: pay_eb7a027d441448c5b9f5d707e20df776\n'
    );
    // --- must stay suppressed: the exact public value remains public even
    // when a second checkout contains the same tracked evidence ---
    writeFileSync(
      join(dir, '.claude', 'worktrees', 'fakeworktree', 'docs', 'dup.md'),
      `BASESCAN_TOKEN_CONTRACT  = ${canonicalUsdc}  (worktree copy)\n`
    );

    // --- must still be caught: near-miss of an allowlisted value (one
    // digit different), in the identical realistic context ---
    writeFileSync(
      join(dir, 'near-miss.md'),
      `BASESCAN_TOKEN_CONTRACT  = ${unknownBlockchainLikeValue}  (one digit off canonical)\n`
    );
    // --- must still be caught: the same near-miss value, but placed
    // under a nested worktree-like path -- proves there is no path-wide
    // suppression that could hide an uncommitted secret in another checkout ---
    writeFileSync(
      join(dir, '.claude', 'worktrees', 'fakeworktree', 'docs', 'near-miss-in-worktree.md'),
      `BASESCAN_TOKEN_CONTRACT  = ${unknownBlockchainLikeValue}  (one digit off canonical, inside worktree path)\n`
    );

    // --- negative controls: unrelated secret shapes, must always be
    // caught regardless of any of the above ---
    const privateKeyHeader = ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ');
    const privateKeyFooter = ['-----END RSA', 'PRIVATE KEY-----'].join(' ');
    writeFileSync(
      join(dir, 'fake-private-key.pem'),
      `${privateKeyHeader}\nMIIEpAIBAAKCAQEA1c7SyntheticNeverRealFixtureMaterialXXXXXXXXXXXX\n${privateKeyFooter}\n`
    );
    const syntheticBearer =
      ['g', 'h', 'p', '_'].join('') +
      ['A7dK', '9mQ2', 'vX5c', 'B8nP', '4rT6', 'yH3j', 'L0sW', '1fG2', 'uZ8e'].join('');
    writeFileSync(join(dir, 'bearer-token.txt'), `Authorization: Bearer ${syntheticBearer}\n`);
    const docsSecret = ['aZ9kLmQw', 'ErTyUiOp', 'AsDfGhJk', 'LzXcVbNm', '12345678'].join('');
    writeFileSync(join(dir, 'docs', 'high-entropy.md'), `SOME_API_KEY = "${docsSecret}"\n`);
    const sourceSecret = ['qP7wLxN2', 'fRk9sTvY', 'uHjMdCbG', 'nEaZ4890', '123abcXYZ'].join('');
    writeFileSync(
      join(dir, 'src', 'high-entropy.ts'),
      `export const SOME_SECRET_TOKEN = "${sourceSecret}";\n`
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('suppresses only the exact allowlisted canonical values', () => {
    const { files } = scan(dir);
    expect(files.has('canonical-usdc.md')).toBe(false);
    expect(files.has('canonical-payment-ids.md')).toBe(false);
    expect(files.has('.claude/worktrees/fakeworktree/docs/dup.md')).toBe(false);
  });

  it('still catches a one-digit-different near-miss of an allowlisted value, in and out of the worktree path', () => {
    const { files } = scan(dir);
    expect(files.has('near-miss.md')).toBe(true);
    expect(files.has('.claude/worktrees/fakeworktree/docs/near-miss-in-worktree.md')).toBe(true);
  });

  it('still catches unrelated secret shapes untouched by the allowlist', () => {
    const { files } = scan(dir);
    expect(files.has('fake-private-key.pem')).toBe(true);
    expect(files.has('bearer-token.txt')).toBe(true);
    expect(files.has('docs/high-entropy.md')).toBe(true);
    expect(files.has('src/high-entropy.ts')).toBe(true);
  });
});
