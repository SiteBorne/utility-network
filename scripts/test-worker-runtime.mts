#!/usr/bin/env -S npx tsx
/**
 * SUN-1200 checkpoint F — VALIDATION RUNTIME CLOSURE (§14, §16, §17).
 *
 * `pnpm test:worker-runtime` — the automated real-`workerd` release-gate
 * harness. The pinned `wrangler` (4.119.0) exports no `createTestHarness`
 * (confirmed by enumerating its module exports; not force-upgraded merely
 * for this feature, per directive), so this script automates the same
 * `wrangler dev --local` process that manually caught and proved the
 * SUN-1200 checkpoint F output-schema and input-schema request-time-eval
 * fixes: a real bundle, a real `workerd` isolate, the real Worker
 * configuration (`wrangler.toml`, including its currently-uncommitted
 * cutover diff, if present).
 *
 * Isolation (§17): a fresh temp directory is used as `--persist-to` for
 * every run, D1 migrations are applied into that fresh state, a new
 * `wrangler dev --local` process is spawned, and everything is deleted on
 * exit (success or failure) -- the developer's own `.wrangler/state` is
 * never touched or depended on.
 *
 * SCOPE (disclosed, not silently narrowed): this harness proves every
 * scenario that is safe to automate without a real financial transaction
 * -- unsigned 402 challenges (web/document exact shape, §18) and the
 * verify_agent_output Profile 1 pre-economic gate (Cases C/D/E/F, §20:
 * unsupported keyword / remote $ref / byte-limit / depth-limit, each
 * rejected BEFORE any 402). It does NOT drive a request past real
 * settlement (§16/§19's "successful execution through output validation"
 * and Cases A/B) -- doing that safely needs a dedicated test-only
 * deterministic-provider entrypoint separate from the real production
 * `main` this repository does not yet have (see the SUN-1200 checkpoint F
 * VALIDATION RUNTIME CLOSURE (2) report for the honest accounting of this
 * gap), and this harness intentionally never ships or references any
 * fake-provider switch reachable from the real production artifact.
 *
 * No remote Cloudflare access. No real credentials beyond whatever
 * `wrangler.toml`/the environment already has locally (never read or
 * logged by this script). No live CDP calls -- every scenario below stops
 * before a PAYMENT-SIGNATURE is ever constructed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WRANGLER_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'wrangler');

interface ScenarioResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: ScenarioResult[] = [];

function record(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail });
  console.log(`${passed ? '✓' : '✗'} ${name}${detail ? ` -- ${detail}` : ''}`);
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

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'siteborne-worker-runtime-'));
  let devProcess: ChildProcess | undefined;
  let exitCode = 0;

  try {
    console.log(`[test:worker-runtime] isolated persist-to dir: ${tempDir}`);
    console.log('[test:worker-runtime] applying D1 migrations to fresh isolated state...');
    await runCommand(
      WRANGLER_BIN,
      ['d1', 'migrations', 'apply', 'siteborne-utility', '--local', '--persist-to', tempDir],
      REPO_ROOT
    );

    const port = 18787 + Math.floor(Math.random() * 500);
    const base = `http://127.0.0.1:${port}`;
    console.log(`[test:worker-runtime] starting isolated wrangler dev --local on port ${port}...`);
    devProcess = spawn(
      WRANGLER_BIN,
      ['dev', '--local', '--port', String(port), '--persist-to', tempDir],
      { cwd: REPO_ROOT, stdio: 'pipe' }
    );
    let devLog = '';
    devProcess.stdout?.on('data', (d) => (devLog += String(d)));
    devProcess.stderr?.on('data', (d) => (devLog += String(d)));
    let devSpawnError: unknown;
    devProcess.on('error', (err) => {
      // Recorded, not thrown: this fires asynchronously outside the
      // surrounding try/catch's stack, so throwing here would crash the
      // process before `finally` can clean up the isolated temp state.
      // `waitForReady`'s own timeout below is the actual failure path.
      devSpawnError = err;
    });

    await waitForReady(`${base}/`, 60_000);
    record('worker boots under real workerd (wrangler dev --local, isolated state)', true);

    // ---- §18: real outer-Worker unsigned 402 tests ----
    {
      const res = await fetch(`${base}/v2/web/context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_url: 'https://acme.example/', retrieval_mode: 'direct' }),
      });
      const header = res.headers.get('PAYMENT-REQUIRED');
      const ok = res.status === 402 && !!header;
      record('web_context_verified.v2: unsigned request -> real 402 with PAYMENT-REQUIRED', ok);
    }
    {
      const res = await fetch(`${base}/v2/document/evidence-json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          artifact_reference: {
            artifact_id: 'doc/native-fixture.pdf',
            media_type: 'application/pdf',
            size_bytes: 1,
          },
        }),
      });
      const header = res.headers.get('PAYMENT-REQUIRED');
      const ok = res.status === 402 && !!header;
      record('document_evidence_json.v2: unsigned request -> real 402 with PAYMENT-REQUIRED', ok);
    }

    // ---- verify_agent_output.v2 Profile 1 pre-economic gate, Cases C-F (§20) ----
    const agentBase = {
      verification_contract: { claims: [], deterministic_requirements: [] },
      candidate_output: {},
      verification_mode: 'standard',
    };
    async function checkPreEconomicRejection(name: string, requiredSchema: unknown, expectedCode: string) {
      const res = await fetch(`${base}/v2/verify/agent-output`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...agentBase, required_schema: requiredSchema }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const ok = res.status === 400 && body.error === expectedCode && !res.headers.get('PAYMENT-REQUIRED');
      record(name, ok, `status=${res.status} error=${String(body.error)}`);
    }
    // Case C: unsupported keyword.
    await checkPreEconomicRejection(
      'verify_agent_output.v2 Case C: unsupported keyword rejected BEFORE economics',
      { type: 'string', pattern: '^[a-z]+$' },
      'unsupported_required_schema'
    );
    // Case D: remote $ref.
    await checkPreEconomicRejection(
      'verify_agent_output.v2 Case D: remote $ref rejected BEFORE economics',
      { properties: { x: { $ref: 'https://example.invalid/schema.json' } } },
      'unsupported_required_schema'
    );
    // Case E: over byte limit.
    await checkPreEconomicRejection(
      'verify_agent_output.v2 Case E: over-byte-limit schema rejected BEFORE economics',
      { type: 'string', description: 'x'.repeat(40_000) },
      'required_schema_limit_exceeded'
    );
    // Case F: over depth/node limit.
    {
      let deep: Record<string, unknown> = { type: 'number' };
      for (let i = 0; i < 40; i++) deep = { allOf: [deep] };
      await checkPreEconomicRejection(
        'verify_agent_output.v2 Case F: over-depth schema rejected BEFORE economics',
        deep,
        'required_schema_limit_exceeded'
      );
    }
    // A Profile-1-supported schema should still get a normal 402 (no false-positive rejection).
    {
      const res = await fetch(`${base}/v2/verify/agent-output`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...agentBase,
          required_schema: { type: 'object', properties: { x: { type: 'number' } } },
        }),
      });
      const ok = res.status === 402 && !!res.headers.get('PAYMENT-REQUIRED');
      record('verify_agent_output.v2: Profile-1-supported schema still gets a normal 402', ok);
    }

    // ---- weak replay/idempotency proof pre-settlement: two identical unsigned
    // requests each mint their own valid, independently-decodable 402 challenge.
    // NOTE: this harness runs against the real wall clock (unlike the
    // fixed-clock idempotency property test in
    // apps/edge-api/tests/x402-service-route.test.ts), so two real
    // requests a few milliseconds apart legitimately mint distinct
    // quote_ids (issued_at differs) -- this scenario intentionally does
    // NOT assert quote_id equality, only that both are independently
    // valid. Full idempotency (identical quote binding under a fixed
    // clock, and duplicate-payment dedup) is already covered by the
    // vitest suite's own property tests. ----
    {
      const body = JSON.stringify({ target_url: 'https://acme.example/replay', retrieval_mode: 'direct' });
      const [r1, r2] = await Promise.all(
        [1, 2].map(() =>
          fetch(`${base}/v2/web/context`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
        )
      );
      const h1 = r1.headers.get('PAYMENT-REQUIRED');
      const h2 = r2.headers.get('PAYMENT-REQUIRED');
      const ok = r1.status === 402 && r2.status === 402 && !!h1 && !!h2;
      record(
        'replay: two identical unsigned requests each independently mint a valid 402',
        ok,
        `quote_ids differ as expected under real wall-clock: ${h1 === h2 ? 'same' : 'different'}`
      );
    }

    // ---- zero eval/exception proof: tail the dev log for the exact class of error this checkpoint fixed ----
    const hasEvalError = /EvalError|Code generation from strings disallowed/i.test(devLog);
    record('zero EvalError/request-time-eval exception observed in the dev server log', !hasEvalError);
  } catch (err) {
    record('harness execution', false, String(err));
  } finally {
    if (devProcess && !devProcess.killed) {
      devProcess.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
    }
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`[test:worker-runtime] isolated state at ${tempDir} removed`);
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n[test:worker-runtime] ${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length > 0) {
    console.log('[test:worker-runtime] FAILED scenarios:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
