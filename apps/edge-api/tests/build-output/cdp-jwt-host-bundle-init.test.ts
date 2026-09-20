/**
 * SETTLEMENT-OBSERVABILITY-01 -- build-output regression gate for the
 * CONTINUATION HOST Worker (`siteborne-paid-continuation-runtime`, built with
 * `wrangler.paid-continuation-runtime.toml`). Identical behavioural contract to
 * the public-Worker gate; the previous gate built only root `wrangler.toml`, so
 * the stale host bundle (which still lacked the JWT initialiser) went unseen.
 *
 * (Original public-Worker gate: FIRST-PAID-VERIFY-WORKER-JWT-BUNDLE-INIT-REMEDIATION-01.)
 *
 * Authoritative contract (behavioural): the production-style emitted bundle
 * (Wrangler/esbuild, same root wrangler.toml, whole production graph) runs under
 * real workerd and the real CDP SDK JWT path mints a JWT for /verify, /settle and
 * /supported from a PUBLIC synthetic Ed25519 fixture. Source-level and
 * vitest-pool-workers runs cannot catch the original defect: they resolve
 * modules with vite/node, not with esbuild's `sideEffects:false` pruning.
 *
 * Structural evidence (secondary): if the bundle defines `init_jwt`, it must
 * also invoke it. Bundler internals may rename helpers, so this is never the
 * sole gate.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const HOST_CONFIG = path.join(REPO_ROOT, 'wrangler.paid-continuation-runtime.toml');
const PROBE_ENTRY = path.resolve(__dirname, 'fixtures/cdp-jwt-host-bundle-probe-entry.ts');
const PROBE_URL = 'http://probe.invalid/__cdp_jwt_bundle_probe';

let workDir: string;
let probeBundle: string;
let prodBundle: string;

function emit(outDir: string, entry?: string): string {
  execFileSync(
    'npx',
    [
      'wrangler',
      'deploy',
      ...(entry ? [entry] : []),
      '--config',
      HOST_CONFIG,
      '--dry-run',
      '--outdir',
      outDir,
    ],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    }
  );
  // Wrangler names the emitted module after the entry file.
  return path.join(
    outDir,
    `${entry ? path.basename(entry, '.ts') : 'workflow-host-entrypoint'}.js`
  );
}

async function runProbeUnderWorkerd(): Promise<{ results: Array<Record<string, unknown>> }> {
  const { Miniflare } = await import('miniflare');
  const mf = new Miniflare({
    modules: true,
    scriptPath: probeBundle,
    modulesRoot: path.dirname(probeBundle),
    compatibilityDate: '2026-08-05',
    compatibilityFlags: ['nodejs_compat'],
  });
  try {
    const response = await mf.dispatchFetch(PROBE_URL);
    return (await response.json()) as { results: Array<Record<string, unknown>> };
  } finally {
    await mf.dispose();
  }
}

describe('emitted continuation-host bundle: CDP JWT initialisation', () => {
  beforeAll(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'cdp-jwt-host-bundle-init-'));
    prodBundle = emit(path.join(workDir, 'prod'));
    probeBundle = emit(path.join(workDir, 'probe'), PROBE_ENTRY);
  }, 400_000);

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it('mints a synthetic Ed25519 JWT on the verify, settle and supported paths under workerd', async () => {
    const { results } = await runProbeUnderWorkerd();
    expect(results.map((r) => r.path)).toEqual(['verify', 'settle', 'supported']);
    expect(results[0]).toMatchObject({ verified: true });
    for (const result of results) {
      expect(result, `path ${String(result.path)}`).toMatchObject({
        reached_facilitator_fetch: true,
        jwt_present: true,
        alg_eddsa: true,
        nonce_hex_32: true,
        sub_matches_key_id: true,
        iss_cdp: true,
        uri_scoped: true,
        signature_present: true,
      });
      expect(result.failure).toBeUndefined();
    }
  }, 120_000);

  it('does not surface the synthetic secret, key id, or a JWT in the probe report', async () => {
    const report = JSON.stringify(await runProbeUnderWorkerd());
    expect(report).not.toContain('synthetic-control-non-secret-test-key-id');
    expect(report).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(report).not.toContain('9d61b19deffd5a60');
  }, 120_000);

  it('still serves only the inert 404 outside the probe path (host surface unchanged)', async () => {
    const { Miniflare } = await import('miniflare');
    const mf = new Miniflare({
      modules: true,
      scriptPath: probeBundle,
      modulesRoot: path.dirname(probeBundle),
      compatibilityDate: '2026-08-05',
      compatibilityFlags: ['nodejs_compat'],
    });
    try {
      expect((await mf.dispatchFetch('http://probe.invalid/v2/verify/agent-output')).status).toBe(
        404
      );
    } finally {
      await mf.dispose();
    }
  }, 120_000);

  it('invokes init_jwt() in the production bundle whenever it defines it (structural)', () => {
    const bundle = readFileSync(prodBundle, 'utf8');
    if (/var init_jwt = __esm\(/.test(bundle)) {
      expect(bundle).toMatch(/\binit_jwt\(\)/);
    }
  });
});
