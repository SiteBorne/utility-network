#!/usr/bin/env -S npx tsx
/**
 * `pnpm test:worker-runtime` — the automated real-`workerd` release-gate
 * harness. The pinned `wrangler` (4.119.0) exports no `createTestHarness`
 * (confirmed by enumerating its module exports; not force-upgraded merely
 * for this feature), so this script automates `wrangler dev --local`
 * itself: isolated `--persist-to` state per run, fresh D1 migrations, a
 * real `workerd` isolate, unconditional teardown.
 *
 * Two independent phases:
 *
 * PHASE 1 (real production config, `wrangler.toml`) — SUN-1200 checkpoint
 * F's original scope: unsigned 402 challenges (web/document exact shape)
 * and the verify_agent_output Profile 1 pre-economic gate (Cases C-F:
 * unsupported keyword / remote $ref / byte-limit / depth-limit, each
 * rejected BEFORE any 402). Never constructs a PAYMENT-SIGNATURE, never
 * touches real settlement. Confirms the real production Worker's normal
 * unsigned/pre-economic behavior is unaffected by anything Phase 2 adds.
 *
 * PHASE 2 (test-only config, `wrangler.worker-runtime-test.toml` ->
 * `apps/edge-api/src/worker-runtime-test-entrypoint.ts`) — SUN-1201
 * checkpoint G: drives `verify_agent_output` through real post-settlement
 * execution inside real `workerd`, using a deterministic, offline
 * `FixturePaymentEvidenceProvider` hard-coded in a file the real
 * production entrypoint (`apps/edge-api/src/index.ts`) never imports. See
 * that file's own doc comment for the full structural-isolation
 * argument; this script's own bundle-isolation check (below) proves it
 * against a real `wrangler deploy --dry-run` of the REAL `wrangler.toml`.
 *
 * No remote Cloudflare access. No real credentials. No live CDP calls,
 * ever, in either phase -- Phase 2's "settlement" is exclusively
 * `synthetic_fixture`-trust-class evidence, never real infrastructure.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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

async function withDevServer<T>(
  opts: { configPath?: string; dbName: string },
  fn: (base: string, getLog: () => string) => Promise<T>
): Promise<T> {
  const tempDir = mkdtempSync(join(tmpdir(), 'siteborne-worker-runtime-'));
  let devProcess: ChildProcess | undefined;
  try {
    console.log(`[test:worker-runtime] isolated persist-to dir: ${tempDir}`);
    await runCommand(
      WRANGLER_BIN,
      [
        'd1',
        'migrations',
        'apply',
        opts.dbName,
        '--local',
        ...(opts.configPath ? ['--config', opts.configPath] : []),
        '--persist-to',
        tempDir,
      ],
      REPO_ROOT
    );

    const port = 18787 + Math.floor(Math.random() * 500);
    const base = `http://127.0.0.1:${port}`;
    console.log(`[test:worker-runtime] starting isolated wrangler dev --local on port ${port}...`);
    devProcess = spawn(
      WRANGLER_BIN,
      [
        'dev',
        '--local',
        '--port',
        String(port),
        ...(opts.configPath ? ['--config', opts.configPath] : []),
        '--persist-to',
        tempDir,
      ],
      { cwd: REPO_ROOT, stdio: 'pipe' }
    );
    let devLog = '';
    devProcess.stdout?.on('data', (d) => (devLog += String(d)));
    devProcess.stderr?.on('data', (d) => (devLog += String(d)));
    devProcess.on('error', () => {
      // Recorded via devLog growth / waitForReady's own timeout, not
      // thrown here -- an event-emitter callback throwing would crash
      // the process before `finally` below can clean up.
    });

    await waitForReady(`${base}/`, 60_000);
    return await fn(base, () => devLog);
  } finally {
    if (devProcess && !devProcess.killed) {
      devProcess.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
    }
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`[test:worker-runtime] isolated state at ${tempDir} removed`);
  }
}

// ---------------------------------------------------------------------
// x402 protocol helpers -- deliberately minimal, hand-rolled (not
// importing @siteborne/protocol-x402 from this bare tsx script, which
// cannot resolve workspace `dist/`-less packages the way vitest's
// aliased config does). PAYMENT-REQUIRED/PAYMENT-SIGNATURE are just
// Base64(JSON) per the x402 V2 spec -- see
// packages/protocol-x402/src/codec/headers.ts, which this mirrors
// exactly for the two operations this script needs.
// ---------------------------------------------------------------------
function decodeHeader(header: string): any {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
}
function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
}

async function get402(base: string, path: string, body: unknown) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const header = res.headers.get('PAYMENT-REQUIRED');
  if (!header)
    throw new Error(`no PAYMENT-REQUIRED header (status=${res.status}): ${await res.text()}`);
  return decodeHeader(header);
}

/**
 * Builds a buyer PAYMENT-SIGNATURE payload for the fixture-mode seam --
 * faithfully mirroring what SITEBORNE's own official buyer helper
 * (`buildBuyerPaymentIdentifierExtensions`,
 * `packages/protocol-x402/src/identifier/payment-identifier.ts`)
 * produces: the FULL server-declared `payment-identifier` extension
 * echoed back verbatim, `info.id` filled in -- including the upstream
 * `schema` field. (This bare tsx script cannot import
 * `@siteborne/protocol-x402` directly -- workspace packages never build
 * `dist/`, and only Vitest's own aliased config resolves them -- so this
 * mirrors the real helper's output rather than calling it; equivalence
 * is proven separately, using the REAL package, in
 * `packages/protocol-x402/src/identifier/payment-identifier.test.ts`'s
 * "H1: the real, official buyer helper output" test.)
 *
 * SUN-1201 checkpoint G discovered, live under real `workerd`, that
 * echoing this `schema` field triggered a self-caught request-time
 * `ajv.compile(ext.schema)` inside `@x402/extensions`' own
 * `validatePaymentIdentifier`, poisoning an otherwise-valid identifier
 * into a false "malformed" rejection -- reported as
 * `X402_EXTENSION_CLASSIFICATION=FUNCTIONAL_BLOCKER`. SUN-1202 checkpoint
 * H fixed this with `sanitizePaymentIdentifierExtensionForValidation`
 * (applied unconditionally inside `parsePaymentIdentifier`, the real
 * production code path) -- this harness now deliberately echoes the
 * schema, exactly as a real spec-compliant buyer does, to prove the fix
 * under real `workerd` rather than routing around the defect as SUN-1201
 * did.
 */
function buildBuyerPayload(challenge: any, paymentId: string) {
  const requirement = challenge.accepts[0];
  const declared = challenge.extensions?.['payment-identifier'];
  const extensions = declared
    ? { 'payment-identifier': { ...declared, info: { ...declared.info, id: paymentId } } }
    : {};
  return {
    x402Version: 2,
    resource: challenge.resource,
    accepted: requirement,
    payload: { synthetic_signature: 'synthetic:buyer-fixture' },
    extensions,
  };
}

async function payAndFetch(base: string, path: string, body: unknown, challenge: any) {
  const paymentId =
    'pay_' +
    Buffer.from(String(Math.random()) + Date.now())
      .toString('hex')
      .slice(0, 32);
  const payload = buildBuyerPayload(challenge, paymentId);
  const header = encodeHeader(payload);
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

// ---------------------------------------------------------------------
// Phase 1: real production config (wrangler.toml)
// ---------------------------------------------------------------------
async function runPhase1() {
  await withDevServer({ dbName: 'siteborne-utility' }, async (base, getLog) => {
    record('PHASE 1 (real wrangler.toml): worker boots under real workerd', true);

    {
      const res = await fetch(`${base}/v2/web/context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_url: 'https://acme.example/', retrieval_mode: 'direct' }),
      });
      const header = res.headers.get('PAYMENT-REQUIRED');
      record(
        'PHASE 1: web_context_verified.v2 unsigned request -> real 402 with PAYMENT-REQUIRED',
        res.status === 402 && !!header
      );
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
      record(
        'PHASE 1: document_evidence_json.v2 unsigned request -> real 402 with PAYMENT-REQUIRED',
        res.status === 402 && !!header
      );
    }

    const agentBase = {
      verification_contract: { claims: [], deterministic_requirements: [] },
      candidate_output: {},
      verification_mode: 'standard',
    };
    async function checkPreEconomicRejection(
      name: string,
      requiredSchema: unknown,
      expectedCode: string
    ) {
      const res = await fetch(`${base}/v2/verify/agent-output`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...agentBase, required_schema: requiredSchema }),
      });
      const respBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const ok =
        res.status === 400 &&
        respBody.error === expectedCode &&
        !res.headers.get('PAYMENT-REQUIRED');
      record(`PHASE 1: ${name}`, ok, `status=${res.status} error=${String(respBody.error)}`);
    }
    await checkPreEconomicRejection(
      'verify_agent_output.v2 Case C: unsupported keyword rejected BEFORE economics',
      { type: 'string', pattern: '^[a-z]+$' },
      'unsupported_required_schema'
    );
    await checkPreEconomicRejection(
      'verify_agent_output.v2 Case D: remote $ref rejected BEFORE economics',
      { properties: { x: { $ref: 'https://example.invalid/schema.json' } } },
      'unsupported_required_schema'
    );
    await checkPreEconomicRejection(
      'verify_agent_output.v2 Case E: over-byte-limit schema rejected BEFORE economics',
      { type: 'string', description: 'x'.repeat(40_000) },
      'required_schema_limit_exceeded'
    );
    {
      let deep: Record<string, unknown> = { type: 'number' };
      for (let i = 0; i < 40; i++) deep = { allOf: [deep] };
      await checkPreEconomicRejection(
        'verify_agent_output.v2 Case F: over-depth schema rejected BEFORE economics',
        deep,
        'required_schema_limit_exceeded'
      );
    }
    {
      const res = await fetch(`${base}/v2/verify/agent-output`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...agentBase,
          required_schema: { type: 'object', properties: { x: { type: 'number' } } },
        }),
      });
      record(
        'PHASE 1: verify_agent_output.v2 Profile-1-supported schema still gets a normal 402',
        res.status === 402 && !!res.headers.get('PAYMENT-REQUIRED')
      );
    }
    {
      const body = JSON.stringify({
        target_url: 'https://acme.example/replay',
        retrieval_mode: 'direct',
      });
      const [r1, r2] = await Promise.all(
        [1, 2].map(() =>
          fetch(`${base}/v2/web/context`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          })
        )
      );
      record(
        'PHASE 1: two identical unsigned requests each independently mint a valid 402',
        r1.status === 402 &&
          r2.status === 402 &&
          !!r1.headers.get('PAYMENT-REQUIRED') &&
          !!r2.headers.get('PAYMENT-REQUIRED')
      );
    }

    const hasEvalError = /EvalError|Code generation from strings disallowed/i.test(getLog());
    record(
      'PHASE 1: zero EvalError/request-time-eval exception in the dev server log',
      !hasEvalError
    );
  });
}

// ---------------------------------------------------------------------
// Phase 2: test-only deterministic settlement seam (SUN-1201 checkpoint G)
// ---------------------------------------------------------------------
async function runPhase2() {
  const configPath = join(REPO_ROOT, 'wrangler.worker-runtime-test.toml');
  await withDevServer(
    { configPath, dbName: 'siteborne-worker-runtime-test' },
    async (base, getLog) => {
      record('PHASE 2 (test-only entrypoint): worker boots under real workerd', true);

      // Governing definition (SUN-1200 checkpoint F directive §20, echoed
      // in the checkpoint F closure report): Case A = Profile-1-supported
      // schema + a candidate_output that satisfies it => the service's
      // own real code (packages/service-runtime/.../service.ts) reports
      // result_class 'success', output.outcome 'pass' -- confirmed
      // directly against that file's own logic, not inferred.
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
      const challengeA = await get402(base, '/v1/verify/agent-output', caseABody);
      const resultA = await payAndFetch(base, '/v1/verify/agent-output', caseABody, challengeA);
      let parsedA: any = {};
      try {
        parsedA = JSON.parse(resultA.body);
      } catch {
        /* leave {} */
      }
      const caseAOk =
        resultA.status === 200 &&
        parsedA.result_class === 'success' &&
        parsedA.output?.outcome === 'pass' &&
        parsedA.output?.requirement_results?.find((r: any) => r.requirement_id === 'schema_check')
          ?.passed === true &&
        typeof parsedA.receipt_id === 'string';
      record(
        'PHASE 2: Case A (Profile-1 schema + valid candidate) reaches real post-settlement success',
        caseAOk,
        `status=${resultA.status} result_class=${parsedA.result_class} outcome=${parsedA.output?.outcome}`
      );

      // Case B = same schema, a candidate_output that VIOLATES it. Per
      // x402-service.ts's own real, unmodified route logic (not altered
      // by this checkpoint), the paid route only returns 200 when
      // result_class === 'success' -- a service result of 'partial'
      // (this service's real outcome when its own schema_valid
      // deterministic requirement genuinely fails) is surfaced as 502
      // service_execution_failed, never billed as a successful 200. This
      // IS the real governing behavior, confirmed by reading
      // x402-service.ts directly -- not something this checkpoint
      // invented or altered.
      const caseBBody = { ...caseABody, candidate_output: { total: 'not-a-number' } };
      const challengeB = await get402(base, '/v1/verify/agent-output', caseBBody);
      const resultB = await payAndFetch(base, '/v1/verify/agent-output', caseBBody, challengeB);
      let parsedB: any = {};
      try {
        parsedB = JSON.parse(resultB.body);
      } catch {
        /* leave {} */
      }
      const caseBOk =
        resultB.status === 502 &&
        parsedB.error === 'service_execution_failed' &&
        String(parsedB.message).includes('partial');
      record(
        'PHASE 2: Case B (Profile-1 schema + invalid candidate) reaches real post-settlement truthful failure',
        caseBOk,
        `status=${resultB.status} error=${parsedB.error} message=${parsedB.message}`
      );

      // H3: a structurally malformed extension (schema echoed, but id
      // fails the pattern/length check) must still be rejected -- proves
      // the SUN-1202 checkpoint H fix did not turn payment-identifier
      // validation into "accept anything".
      {
        const challenge = await get402(base, '/v1/verify/agent-output', caseABody);
        const declared = challenge.extensions?.['payment-identifier'];
        const payload = {
          x402Version: 2,
          resource: challenge.resource,
          accepted: challenge.accepts[0],
          payload: { synthetic_signature: 'synthetic:buyer-fixture' },
          extensions: declared
            ? { 'payment-identifier': { ...declared, info: { ...declared.info, id: 'too-short' } } }
            : {},
        };
        const res = await fetch(`${base}/v1/verify/agent-output`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'PAYMENT-SIGNATURE': encodeHeader(payload),
          },
          body: JSON.stringify(caseABody),
        });
        const respBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        record(
          'PHASE 2 (H3): a malformed payment identifier (schema echoed, invalid id) is still rejected',
          res.status === 400 && respBody.error === 'malformed_payment_signature',
          `status=${res.status} error=${String(respBody.error)}`
        );
      }

      // H4: a buyer that tampers with the server-declared security-
      // sensitive `info.required` field (attempting to claim "not
      // required" to skip supplying any identifier at all, on a route
      // that DOES require one) must still be governed by the server's
      // own stored requirement, never the buyer-echoed claim.
      {
        const challenge = await get402(base, '/v1/verify/agent-output', caseABody);
        const declared = challenge.extensions?.['payment-identifier'];
        const payload = {
          x402Version: 2,
          resource: challenge.resource,
          accepted: challenge.accepts[0],
          payload: { synthetic_signature: 'synthetic:buyer-fixture' },
          extensions: declared
            ? { 'payment-identifier': { ...declared, info: { required: false } } }
            : {},
        };
        const res = await fetch(`${base}/v1/verify/agent-output`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'PAYMENT-SIGNATURE': encodeHeader(payload),
          },
          body: JSON.stringify(caseABody),
        });
        const respBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        record(
          'PHASE 2 (H4): tampering with the declared info.required flag does not bypass the server-declared requirement',
          res.status === 400 && respBody.error === 'malformed_payment_signature',
          `status=${res.status} error=${String(respBody.error)} message=${String(respBody.message)}`
        );
      }

      const hasEvalError = /EvalError|Code generation from strings disallowed/i.test(getLog());
      record(
        'PHASE 2: zero EvalError/request-time-eval exception reaching the real post-settlement path',
        !hasEvalError
      );
    }
  );
}

// ---------------------------------------------------------------------
// Bundle isolation proof (§7 / S3): the REAL production wrangler.toml's
// dry-run bundle must never contain the test-only entrypoint's source
// chunk.
// ---------------------------------------------------------------------
async function runBundleIsolationCheck() {
  const outDir = mkdtempSync(join(tmpdir(), 'siteborne-bundle-audit-'));
  try {
    await runCommand(WRANGLER_BIN, ['deploy', '--dry-run', '--outdir', outDir], REPO_ROOT);
    const bundle = readFileSync(join(outDir, 'index.js'), 'utf-8');
    const containsTestEntrypoint = bundle.includes('worker-runtime-test-entrypoint');
    const containsMarker = bundle.includes('SUN-1201-WORKER-RUNTIME-TEST-ENTRYPOINT-b7f2c4');
    record(
      'bundle isolation: real wrangler.toml dry-run bundle does NOT contain the test-only entrypoint',
      !containsTestEntrypoint && !containsMarker,
      `containsTestEntrypointChunk=${containsTestEntrypoint} containsMarker=${containsMarker}`
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

async function main() {
  let exitCode = 0;
  try {
    await runPhase1();
    await runPhase2();
    await runBundleIsolationCheck();
  } catch (err) {
    record('harness execution', false, String(err));
  }

  const failed = results.filter((r) => !r.passed);
  console.log(
    `\n[test:worker-runtime] ${results.length - failed.length}/${results.length} scenarios passed.`
  );
  if (failed.length > 0) {
    console.log('[test:worker-runtime] FAILED scenarios:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
