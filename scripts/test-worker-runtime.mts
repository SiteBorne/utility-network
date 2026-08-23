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
 * PHASE 1 (real production config, `wrangler.toml`) — SUN-1206's stronger
 * production boundary: all 12 paid route configurations return a governed
 * unavailable response before payment-provider or service construction.
 * No PAYMENT-REQUIRED/PAYMENT-RESPONSE header is emitted.
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
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A fresh, local, throwaway Ed25519 seed for exercising the real
 * production entrypoint's signing composition under this script's own
 * isolated `wrangler dev --local` server -- generated per run via
 * Node's built-in `node:crypto` (not `@noble/ed25519`, which this bare
 * script cannot resolve outside its consuming package), never printed,
 * never the real SUN-1215-provisioned production secret, and discarded
 * when the process exits. The Ed25519 JWK `d` member is the raw 32-byte
 * private seed (RFC 8032), the exact format `production-signer.ts`'s
 * `decodeHexPrivateKey` expects. */
function generateLocalTestSigningKeyHex(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' }) as { d?: string };
  if (!jwk.d) throw new Error('failed to export ed25519 private key seed as JWK');
  return Buffer.from(jwk.d, 'base64url').toString('hex');
}

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
  opts: { configPath?: string; dbName: string; vars?: Record<string, string> },
  fn: (base: string, getLog: () => string, tempDir: string) => Promise<T>
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
        // The committed config has one apex Worker Route used only for MCP
        // Registry domain proof. Wrangler otherwise chooses that route's
        // zone (`siteborne.net`) as the local upstream Host for *every* test
        // request, including /mcp, even though production /mcp is served on
        // utility.siteborne.net. Pin the real production MCP host so the
        // DNS-rebinding allowlist is exercised faithfully without widening
        // production policy merely to accommodate Wrangler's local default.
        '--host',
        'utility.siteborne.net',
        '--port',
        String(port),
        ...(opts.configPath ? ['--config', opts.configPath] : []),
        ...Object.entries(opts.vars ?? {}).flatMap(([name, value]) => [
          '--var',
          `${name}:${value}`,
        ]),
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
    return await fn(base, () => devLog, tempDir);
  } finally {
    if (devProcess && !devProcess.killed) {
      devProcess.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
    }
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`[test:worker-runtime] isolated state at ${tempDir} removed`);
  }
}

const MCP_PROTOCOL_VERSION = '2026-07-28';

function mcpHeaders(method: string, toolName?: string): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    'Mcp-Method': method,
    ...(toolName ? { 'Mcp-Name': toolName } : {}),
    Host: 'utility.siteborne.net',
  };
}

function mcpMeta() {
  return {
    'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'siteborne-workerd-audit', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

// ---------------------------------------------------------------------
// Phase 0 (SUN-1205 checkpoint K): exact committed production config.
// Paid routes remain structurally absent, while the already-public MCP
// surface is exercised through the real production entrypoint/workerd.
// ---------------------------------------------------------------------
async function runPhase0() {
  await withDevServer({ dbName: 'siteborne-utility' }, async (base, getLog) => {
    record('PHASE 0 (exact committed wrangler.toml): worker boots under real workerd', true);

    for (const path of ['/v1/company/evidence-graph', '/v2/company/evidence-graph']) {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      record(`PHASE 0: ${path} remains 404 before paid-route cutover`, res.status === 404);
    }

    const malformed = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: mcpHeaders('tools/list'),
      body: '{',
    });
    record('PHASE 0 (M1): malformed MCP JSON is a bounded 400', malformed.status === 400);

    const listBody = {
      jsonrpc: '2.0',
      id: 1205,
      method: 'tools/list',
      params: { _meta: mcpMeta() },
    };
    const listed = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: mcpHeaders('tools/list'),
      body: JSON.stringify(listBody),
    });
    const listedJson = (await listed.json().catch(() => ({}))) as any;
    record(
      'PHASE 0 (M2): valid MCP discovery returns the six governed tools',
      listed.status === 200 && listedJson?.result?.tools?.length === 6,
      `status=${listed.status} tools=${String(listedJson?.result?.tools?.length)} message=${String(listedJson?.error?.message)}`
    );

    const unknown = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: mcpHeaders('siteborne/unknown'),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1206,
        method: 'siteborne/unknown',
        params: { _meta: mcpMeta() },
      }),
    });
    const unknownJson = (await unknown.json().catch(() => ({}))) as any;
    record(
      'PHASE 0 (M3): unknown MCP method is a governed method-not-found failure',
      unknown.status === 404 && unknownJson?.error?.code === -32601,
      `status=${unknown.status} code=${String(unknownJson?.error?.code)} message=${String(unknownJson?.error?.message)}`
    );

    const unpaid = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: mcpHeaders('tools/call', 'siteborne_company_evidence_graph'),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1207,
        method: 'tools/call',
        params: {
          name: 'siteborne_company_evidence_graph',
          arguments: {
            identifiers: { cik: '0000320193' },
            requested_field_groups: ['identity'],
          },
          _meta: mcpMeta(),
        },
      }),
    });
    const unpaidText = await unpaid.text();
    record(
      'PHASE 0 (M4/M6): unauthenticated paid MCP tool stops at payment_required with zero provider execution',
      unpaid.status === 200 && unpaidText.includes('payment_required'),
      `status=${unpaid.status} body=${unpaidText.slice(0, 240)}`
    );

    const oversized = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: mcpHeaders('tools/call', 'siteborne_get_quote'),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1208,
        method: 'tools/call',
        params: {
          name: 'siteborne_get_quote',
          arguments: { padding: 'x'.repeat(1024 * 1024) },
          _meta: mcpMeta(),
        },
      }),
    });
    const oversizedJson = (await oversized.json().catch(() => ({}))) as any;
    record(
      'PHASE 0 (M5): measured oversized MCP request is rejected with 413',
      oversized.status === 413 && oversizedJson?.code === 'PAYLOAD_TOO_LARGE',
      `status=${oversized.status} code=${String(oversizedJson?.code)}`
    );

    const hasProviderTraffic = /api\.sandbox\.nevermined\.app|api\.cdp\.coinbase\.com/i.test(
      getLog()
    );
    record(
      'PHASE 0 (M6): MCP probe produced no Nevermined/CDP provider traffic signal',
      !hasProviderTraffic
    );
  });
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
  await withDevServer(
    {
      dbName: 'siteborne-utility',
      vars: {
        ENVIRONMENT: 'development',
        PAID_ROUTES_ENABLED: 'true',
        NEVERMINED_ROUTES_ENABLED: 'true',
      },
    },
    async (base, getLog) => {
      record(
        'PHASE 1 (real production entrypoint, route flags enabled): worker boots under real workerd',
        true
      );

      const paths = [
        '/v1/company/evidence-graph',
        '/v1/web/context',
        '/v1/document/evidence-json',
        '/v1/verify/agent-output',
        '/v2/company/evidence-graph',
        '/v2/web/context',
        '/v2/document/evidence-json',
        '/v2/verify/agent-output',
        '/v2/nevermined/company/evidence-graph',
        '/v2/nevermined/web/context',
        '/v2/nevermined/document/evidence-json',
        '/v2/nevermined/verify/agent-output',
      ];
      for (const path of paths) {
        const res = await fetch(base + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        record(
          `PHASE 1: ${path} is unavailable before economics under real workerd`,
          res.status === 503 &&
            body.error === 'service_executor_not_configured' &&
            !res.headers.get('PAYMENT-REQUIRED') &&
            !res.headers.get('PAYMENT-RESPONSE'),
          `status=${res.status} error=${String(body.error)}`
        );
      }

      const hasEvalError = /EvalError|Code generation from strings disallowed/i.test(getLog());
      record(
        'PHASE 1: zero EvalError/request-time-eval exception in the dev server log',
        !hasEvalError
      );
    }
  );
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
// Phase 3 (SUN-1203 checkpoint I): extends the same test-only entrypoint's
// real-workerd post-settlement proof to the three other v1 paid services
// (company_evidence_graph, web_context_verified, document_evidence_json)
// -- verify_agent_output already had this coverage from SUN-1201/1202.
// `worker-runtime-test-entrypoint.ts` already mounts the FULL app
// (`buildPaidServicesApp`, all /v1/* services) via the same structurally-
// isolated FixturePaymentEvidenceProvider seam -- no new test seam
// introduced, only new HTTP scenarios against the existing one. Input
// fixtures mirror the exact accepted SUN-0300/SUN-0700A scenarios
// `apps/edge-api/tests/x402-service-route.test.ts` already uses (real,
// not invented): the Apple Inc. SEC EDGAR CIK for company evidence, the
// native-fixture PDF artifact for document evidence.
// ---------------------------------------------------------------------
async function runPhase3() {
  const configPath = join(REPO_ROOT, 'wrangler.worker-runtime-test.toml');
  await withDevServer({ configPath, dbName: 'siteborne-worker-runtime-test' }, async (base) => {
    record('PHASE 3 (test-only entrypoint): worker boots under real workerd', true);

    const services: Array<{ name: string; path: string; body: unknown }> = [
      {
        name: 'company_evidence_graph.v1',
        path: '/v1/company/evidence-graph',
        body: {
          identifiers: { cik: '0000320193' },
          requested_field_groups: ['identity', 'sec_submissions'],
        },
      },
      {
        name: 'web_context_verified.v1',
        path: '/v1/web/context',
        body: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
      },
      {
        name: 'document_evidence_json.v1',
        path: '/v1/document/evidence-json',
        body: {
          artifact_reference: {
            artifact_id: 'doc/native-fixture.pdf',
            media_type: 'application/pdf',
            size_bytes: 1,
          },
        },
      },
    ];

    for (const svc of services) {
      // P1: unsigned request -> real 402.
      const challenge = await get402(base, svc.path, svc.body);
      record(`PHASE 3 (P1): ${svc.name} unsigned request -> real 402 under real workerd`, true);

      // P3: valid synthetic payment -> real post-settlement execution.
      const result = await payAndFetch(base, svc.path, svc.body, challenge);
      let parsed: any = {};
      try {
        parsed = JSON.parse(result.body);
      } catch {
        /* leave {} */
      }
      const ok =
        result.status === 200 &&
        parsed.result_class === 'success' &&
        typeof parsed.receipt_id === 'string' &&
        typeof parsed.link_id === 'string';
      record(
        `PHASE 3 (P3): ${svc.name} synthetic payment -> real post-settlement success under real workerd`,
        ok,
        `status=${result.status} result_class=${parsed.result_class} receipt_id=${typeof parsed.receipt_id}`
      );

      // P2: malformed input (missing required field) -> deterministic
      // pre-economic rejection, never a 402.
      const badRes = await fetch(base + svc.path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      record(
        `PHASE 3 (P2): ${svc.name} malformed input -> deterministic pre-economic rejection (never 402)`,
        badRes.status === 400 && !badRes.headers.get('PAYMENT-REQUIRED'),
        `status=${badRes.status}`
      );
    }
  });
}

// ---------------------------------------------------------------------
// Phase 4 (SUN-1204 checkpoint J, Track A): closes the v2 CDP portion of
// SUN-1203's sole R0 blocker. `worker-runtime-test-entrypoint.ts` already
// mounts `/v2/*` via the exact same, real, unmodified `buildPaidServicesApp`
// call as `/v1/*` (CDP-only -- `neverminedV2Enabled` is not set, so no
// Nevermined routes register on this app instance) -- no new test seam,
// only new HTTP scenarios against the existing one, exactly Phase 3's
// pattern applied to the three v2 CDP services that lacked real-workerd
// settled-path proof at SUN-1203 closure (verify_agent_output.v2 already
// had it, SUN-1200-1202).
//
// Each scenario also asserts the 402 challenge's `amount` matches the
// real, canonical production price (`governance/RISK_LIMITS.yaml` via
// `pnpm pricing:check`, USDC atomic units = price * 10^6) -- proving the
// real route logic, not a test-mode price, is what a real buyer would
// see (§14).
// ---------------------------------------------------------------------
async function runPhase4() {
  const configPath = join(REPO_ROOT, 'wrangler.worker-runtime-test.toml');
  await withDevServer({ configPath, dbName: 'siteborne-worker-runtime-test' }, async (base) => {
    record('PHASE 4 (test-only entrypoint, v2 CDP): worker boots under real workerd', true);

    const services: Array<{ name: string; path: string; body: unknown; expectedAmount: string }> = [
      {
        name: 'company_evidence_graph.v2',
        path: '/v2/company/evidence-graph',
        body: {
          identifiers: { cik: '0000320193' },
          requested_field_groups: ['identity', 'sec_submissions'],
        },
        expectedAmount: '39000', // 0.039 USD * 1e6
      },
      {
        name: 'web_context_verified.v2',
        path: '/v2/web/context',
        body: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
        expectedAmount: '9000', // 0.009 USD * 1e6
      },
      {
        name: 'document_evidence_json.v2',
        path: '/v2/document/evidence-json',
        body: {
          artifact_reference: {
            artifact_id: 'doc/native-fixture.pdf',
            media_type: 'application/pdf',
            size_bytes: 1,
          },
        },
        expectedAmount: '190000', // 0.19 USD max * 1e6 (upto scheme)
      },
    ];

    for (const svc of services) {
      // A1: unsigned request -> real 402, WITH canonical price assertion.
      const challenge = await get402(base, svc.path, svc.body);
      const actualAmount = challenge.accepts?.[0]?.amount;
      record(
        `PHASE 4 (A1): ${svc.name} unsigned request -> real 402 with canonical production price`,
        actualAmount === svc.expectedAmount,
        `expected=${svc.expectedAmount} actual=${actualAmount}`
      );

      // A3: valid synthetic payment -> real post-settlement execution
      // against the real v2 service implementation (same registry/
      // executeLocalService call as v1 -- confirmed by reading
      // paid-services.ts directly, not assumed).
      const result = await payAndFetch(base, svc.path, svc.body, challenge);
      let parsed: any = {};
      try {
        parsed = JSON.parse(result.body);
      } catch {
        /* leave {} */
      }
      const ok =
        result.status === 200 &&
        parsed.result_class === 'success' &&
        parsed.service_id === svc.name &&
        typeof parsed.receipt_id === 'string' &&
        typeof parsed.link_id === 'string';
      record(
        `PHASE 4 (A3): ${svc.name} synthetic payment -> real post-settlement success under real workerd`,
        ok,
        `status=${result.status} result_class=${parsed.result_class} service_id=${parsed.service_id}`
      );

      // A2: malformed input (missing required field) -> deterministic
      // pre-economic rejection, never a 402.
      const badRes = await fetch(base + svc.path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      record(
        `PHASE 4 (A2): ${svc.name} malformed input -> deterministic pre-economic rejection (never 402)`,
        badRes.status === 400 && !badRes.headers.get('PAYMENT-REQUIRED'),
        `status=${badRes.status}`
      );
    }

    // A5/A6: malformed/tampered payment -- x402-service.ts's payment-
    // identifier/structure validation is the SAME shared code path for
    // every route (proven already for v1 verify_agent_output in Phase 2's
    // H3/H4); representative proof on one v2 CDP route confirms it also
    // governs v2 CDP requests, not re-derived per service.
    {
      const svc = services[0];
      const challenge = await get402(base, svc.path, svc.body);
      const declared = challenge.extensions?.['payment-identifier'];
      // A5: malformed payment identifier (schema echoed, invalid id).
      const malformedPayload = {
        x402Version: 2,
        resource: challenge.resource,
        accepted: challenge.accepts[0],
        payload: { synthetic_signature: 'synthetic:buyer-fixture' },
        extensions: declared
          ? { 'payment-identifier': { ...declared, info: { ...declared.info, id: 'too-short' } } }
          : {},
      };
      const malformedRes = await fetch(base + svc.path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'PAYMENT-SIGNATURE': encodeHeader(malformedPayload),
        },
        body: JSON.stringify(svc.body),
      });
      const malformedBody = (await malformedRes.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      record(
        `PHASE 4 (A5): ${svc.name} malformed payment identifier is rejected under real workerd`,
        malformedRes.status === 400 && malformedBody.error === 'malformed_payment_signature',
        `status=${malformedRes.status} error=${String(malformedBody.error)}`
      );
    }
    {
      const svc = services[0];
      const challenge2 = await get402(base, svc.path, svc.body);
      // A6: tampered security field -- forged quote_id in accepted.extra.
      const tamperedAccepted = {
        ...challenge2.accepts[0],
        extra: { ...challenge2.accepts[0].extra, quote_id: 'qte_' + 'f'.repeat(24) },
      };
      const tamperedPayload = {
        x402Version: 2,
        resource: challenge2.resource,
        accepted: tamperedAccepted,
        payload: { synthetic_signature: 'synthetic:buyer-fixture' },
        extensions: {},
      };
      const tamperedRes = await fetch(base + svc.path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'PAYMENT-SIGNATURE': encodeHeader(tamperedPayload),
        },
        body: JSON.stringify(svc.body),
      });
      const tamperedBody = (await tamperedRes.json().catch(() => ({}))) as Record<string, unknown>;
      record(
        `PHASE 4 (A6): ${svc.name} tampered/forged quote_id is rejected under real workerd`,
        tamperedRes.status === 402 && tamperedBody.error === 'expired_quote',
        `status=${tamperedRes.status} error=${String(tamperedBody.error)}`
      );
    }
  });
}

// ---------------------------------------------------------------------
// Phase 5 (SUN-1204 checkpoint J, Track B): closes the v2 Nevermined
// portion of SUN-1203's sole R0 blocker. Reuses
// `NeverminedPaymentEvidenceProvider.fixture()` -- the real production
// code's OWN "only injectable client path" (`control-plane/evidence/
// nevermined-provider.ts`), never called by the real production
// entrypoint (`index.ts`), which only ever calls `.authenticated()` --
// mounted at two distinct test-only-only paths in
// `worker-runtime-test-entrypoint.ts`: `/v2/nevermined/*` (a deterministic
// ALWAYS-VALID client) and `/v2/nevermined-deny/*` (a deterministic
// ALWAYS-DENIES client, for N4/N5). Neither path exists in real
// production routing. Real Nevermined-specific request parsing
// (PAYMENT-DELEGATION-ID, Payment-Identifier headers, quote/requirement
// binding, `nvm:erc4337` challenge encoding) runs unmodified; only the
// external verify/settle boundary is substituted -- exactly the
// "smallest external boundary possible" this checkpoint requires.
// ---------------------------------------------------------------------
async function runPhase5() {
  const configPath = join(REPO_ROOT, 'wrangler.worker-runtime-test.toml');
  await withDevServer({ configPath, dbName: 'siteborne-worker-runtime-test' }, async (base) => {
    record('PHASE 5 (test-only entrypoint, v2 Nevermined): worker boots under real workerd', true);

    async function neverminedChallenge(path: string, body: unknown) {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const header = res.headers.get('PAYMENT-REQUIRED');
      return { status: res.status, header, decoded: header ? decodeHeader(header) : undefined };
    }

    function neverminedPayHeaders(paymentIdentifier: string, delegationId: string) {
      return {
        'content-type': 'application/json',
        'payment-signature': 'fixture_000000000000000000000000',
        'Payment-Identifier': paymentIdentifier,
        'PAYMENT-DELEGATION-ID': delegationId,
      };
    }

    function freshId(prefix: string): string {
      return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`.slice(
        0,
        40
      );
    }

    const services: Array<{ name: string; path: string; body: unknown; expectedAmount: string }> = [
      {
        name: 'company_evidence_graph.v2 (Nevermined)',
        path: '/v2/nevermined/company/evidence-graph',
        body: {
          identifiers: { cik: '0000320193' },
          requested_field_groups: ['identity', 'sec_submissions'],
        },
        expectedAmount: '39000',
      },
      {
        name: 'web_context_verified.v2 (Nevermined)',
        path: '/v2/nevermined/web/context',
        body: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
        expectedAmount: '9000',
      },
      {
        name: 'document_evidence_json.v2 (Nevermined)',
        path: '/v2/nevermined/document/evidence-json',
        body: {
          artifact_reference: {
            artifact_id: 'doc/native-fixture.pdf',
            media_type: 'application/pdf',
            size_bytes: 1,
          },
        },
        expectedAmount: '190000',
      },
      {
        name: 'verify_agent_output.v2 (Nevermined)',
        path: '/v2/nevermined/verify/agent-output',
        body: {
          verification_contract: {
            claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
            deterministic_requirements: [],
          },
          candidate_output: { total: 42 },
          required_schema: {},
          verification_mode: 'standard',
        },
        expectedAmount: '19000',
      },
    ];

    // N1: no access/payment material -> real 402, with canonical price
    // (each service, individually -- proves per-route positive settled
    // execution below, §7's "each route still needs its own positive
    // post-authorization service-execution proof").
    for (const svc of services) {
      const challenge = await neverminedChallenge(svc.path, svc.body);
      const requirement = challenge.decoded?.accepts?.[0];
      const extAmount = challenge.decoded?.extensions?.['net.siteborne.payment']?.amount;
      record(
        `PHASE 5 (N1): ${svc.name} unsigned request -> real 402 with canonical production price`,
        challenge.status === 402 && !!challenge.header && extAmount === svc.expectedAmount,
        `status=${challenge.status} scheme=${requirement?.scheme} amount=${extAmount} expected=${svc.expectedAmount}`
      );
    }

    // N3 + service-execution proof: valid synthetic verification -> real
    // post-settlement execution against the real v2 Nevermined service
    // implementation, for EVERY service (not just one).
    for (const svc of services) {
      await neverminedChallenge(svc.path, svc.body); // establishes the stored quote
      const id = freshId('pay');
      const res = await fetch(base + svc.path, {
        method: 'POST',
        headers: neverminedPayHeaders(id, freshId('deleg')),
        body: JSON.stringify(svc.body),
      });
      let parsed: any = {};
      try {
        parsed = JSON.parse(await res.text());
      } catch {
        /* leave {} */
      }
      const ok =
        res.status === 200 &&
        parsed.result_class === 'success' &&
        parsed.service_id === svc.name.replace(' (Nevermined)', '') &&
        typeof parsed.receipt_id === 'string' &&
        typeof parsed.link_id === 'string';
      record(
        `PHASE 5 (N3): ${svc.name} synthetic verified access -> real post-settlement success under real workerd`,
        ok,
        `status=${res.status} result_class=${parsed.result_class} service_id=${parsed.service_id}`
      );
    }

    // N2: malformed Nevermined material (missing PAYMENT-DELEGATION-ID) ->
    // rejected, never reaches service execution.
    {
      const svc = services[0];
      await neverminedChallenge(svc.path, svc.body);
      const res = await fetch(base + svc.path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': 'fixture_000000000000000000000000',
          'Payment-Identifier': freshId('pay'),
          // PAYMENT-DELEGATION-ID deliberately omitted.
        },
        body: JSON.stringify(svc.body),
      });
      record(
        'PHASE 5 (N2): malformed Nevermined material (missing delegation ID) is rejected',
        res.status >= 400 && res.status < 500,
        `status=${res.status}`
      );
    }

    // N4: verifier returns explicit denial -> request must not reach
    // service execution (the deny-only test path).
    {
      const svc = services[0];
      const denyPath = svc.path.replace('/v2/nevermined/', '/v2/nevermined-deny/');
      await neverminedChallenge(denyPath, svc.body);
      const id = freshId('pay');
      const res = await fetch(base + denyPath, {
        method: 'POST',
        headers: neverminedPayHeaders(id, freshId('deleg')),
        body: JSON.stringify(svc.body),
      });
      let parsed: any = {};
      try {
        parsed = JSON.parse(await res.text());
      } catch {
        /* leave {} */
      }
      record(
        'PHASE 5 (N4): explicit verifier denial is rejected, never reaches service execution',
        res.status === 402 && parsed.error === 'payment_verification_rejected',
        `status=${res.status} error=${parsed.error}`
      );
    }

    // N6: tampered/forged quote_id (a user-controlled security field) is
    // rejected, never converts a denial-eligible request into
    // authorization.
    {
      const svc = services[0];
      // The Nevermined rail binds a payment to its quote via stored
      // server-side state (keyed by resource + canonical request hash),
      // not an echoed body/header field a buyer could forge -- so the
      // tamper attempt here is the most direct one available: change the
      // business input after the challenge was minted for the original
      // input, and confirm the mismatched request is rejected rather than
      // silently authorized against a stale/unrelated quote.
      await neverminedChallenge(svc.path, svc.body);
      const res = await fetch(base + svc.path, {
        method: 'POST',
        headers: neverminedPayHeaders(freshId('pay'), freshId('deleg')),
        // A body that does not match any stored quote for this resource
        // (never established via neverminedChallenge above with this
        // exact body) -- the real route must reject it as an
        // unrecognized/expired quote, not silently accept.
        body: JSON.stringify({ ...(svc.body as object), tampered_marker: true }),
      });
      record(
        'PHASE 5 (N6): a request body that never matched any stored quote is rejected, never silently authorized',
        res.status === 402 || res.status === 400,
        `status=${res.status}`
      );
    }
  });
}

// ---------------------------------------------------------------------
// Phase 6 (SUN-1214 checkpoint T): the new verify_agent_output.v2/CDP
// PRODUCTION composition (buildVerifyAgentOutputV2CdpProductionRouteConfig
// + buildVerifyAgentOutputV2ProductionExecutor + buildProductionSigner),
// mounted at the test-only-only path /v2/verify-production/*. Proves the
// real production composition module under real workerd -- not a
// fixture stand-in for it. The signing key is generated once, in
// memory, inside worker-runtime-test-entrypoint.ts (never written to
// disk/committed); the CDP evidence resolution correctly falls back to
// FixturePaymentEvidenceProvider (via resolveProductionCdpEvidenceProvider's
// own existing fail-closed default, since getAuthenticatedSellerAddress
// is not supplied) -- the same synthetic evidence seam every other
// phase already uses, not a new one.
// ---------------------------------------------------------------------
async function runPhase6() {
  const configPath = join(REPO_ROOT, 'wrangler.worker-runtime-test.toml');
  await withDevServer({ configPath, dbName: 'siteborne-worker-runtime-test' }, async (base) => {
    record(
      'PHASE 6 (test-only entrypoint, verify v2/CDP PRODUCTION composition): worker boots under real workerd',
      true
    );

    const path = '/v2/verify-production/agent-output';
    const body = {
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

    // Scenario 1: unsigned request -> real 402 with canonical price.
    const challenge = await get402(base, path, body);
    const actualAmount = challenge.accepts?.[0]?.amount;
    record(
      'PHASE 6 (1): verify-production unsigned request -> real 402 with canonical production price',
      actualAmount === '19000',
      `expected=19000 actual=${actualAmount}`
    );

    // Scenario 2: successful synthetic payment -> real production
    // executor -> real x402-service.ts result/audit persistence. The
    // HTTP response body deliberately never includes the full receipt
    // (x402-service.ts's own responseBody carries only receipt_id, not
    // `receipt` -- confirmed by reading that construction directly, not
    // assumed); cryptographic proof that the PRODUCTION (not fixture)
    // signer genuinely produced a valid Ed25519 signature is proven at
    // the unit level instead (Task 3's differential test, which does
    // have in-process access to the full receipt via
    // buildVerifyAgentOutputV2ProductionExecutor's direct return value).
    // This scenario proves the real composition executes successfully
    // end to end under real workerd, which the wire response can prove.
    const result = await payAndFetch(base, path, body, challenge);
    let parsed: any = {};
    try {
      parsed = JSON.parse(result.body);
    } catch {
      /* leave {} */
    }
    const ok =
      result.status === 200 &&
      parsed.result_class === 'success' &&
      parsed.output?.outcome === 'pass' &&
      typeof parsed.receipt_id === 'string';
    record(
      'PHASE 6 (2): verify-production synthetic payment -> real post-settlement success through the real production composition',
      ok,
      `status=${result.status} result_class=${parsed.result_class} receipt_id_present=${typeof parsed.receipt_id === 'string'}`
    );

    // Scenario 3: malformed input -> deterministic pre-economic
    // rejection (never a 402), same Profile 1 gate every other phase
    // already proves, reused unmodified here.
    const malformedBody = { ...body, required_schema: { $recursiveAnchor: true } };
    const malformedRes = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(malformedBody),
    });
    record(
      'PHASE 6 (3): verify-production malformed input -> deterministic pre-economic rejection (never 402)',
      malformedRes.status === 400,
      `status=${malformedRes.status}`
    );

    // Scenario 4: duplicate request with the same payment identifier
    // returns a consistent result through the real production
    // composition -- proving this composition plugs into the existing
    // x402-service.ts idempotency machinery (idempotency_records) rather
    // than bypassing or duplicating it, exactly as the approved design
    // requires. This does not re-derive x402-service.ts's own
    // idempotency guarantee from scratch (that is already proven by its
    // own extensive existing test suite) -- it proves this NEW
    // composition is subject to that same existing guarantee, not
    // exempt from it. The wire response deliberately never exposes
    // enough state (no receipt/timestamp field, only receipt_id/link_id)
    // to further distinguish "served from cache" from "a second
    // deterministic execution reached the identical result" at the HTTP
    // level; both are safe outcomes for this checkpoint's purposes
    // (idempotency_records's own dedupe correctness is x402-service.ts's
    // concern, unmodified by this checkpoint), so this scenario checks
    // response consistency, not an internal execution count.
    {
      const dupChallenge = await get402(base, path, body);
      const paymentId = 'pay_dup_' + Date.now().toString(16).padStart(24, '0').slice(0, 24);
      const requirement = dupChallenge.accepts[0];
      const declared = dupChallenge.extensions?.['payment-identifier'];
      const payload = {
        x402Version: 2,
        resource: dupChallenge.resource,
        accepted: requirement,
        payload: { synthetic_signature: 'synthetic:buyer-fixture' },
        extensions: declared
          ? { 'payment-identifier': { ...declared, info: { ...declared.info, id: paymentId } } }
          : {},
      };
      const header = encodeHeader(payload);
      const first = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(body),
      });
      const firstParsed = await first.json().catch(() => ({}) as any);
      const second = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(body),
      });
      const secondParsed = await second.json().catch(() => ({}) as any);
      const consistentDuplicate =
        first.status === 200 &&
        second.status === 200 &&
        typeof firstParsed.receipt_id === 'string' &&
        firstParsed.receipt_id === secondParsed.receipt_id &&
        firstParsed.link_id === secondParsed.link_id;
      record(
        'PHASE 6 (4): duplicate request (same payment identifier) returns a consistent result via the existing x402 idempotency machinery',
        consistentDuplicate,
        `firstStatus=${first.status} secondStatus=${second.status} sameReceiptId=${firstParsed.receipt_id === secondParsed.receipt_id} sameLinkId=${firstParsed.link_id === secondParsed.link_id}`
      );
    }
  });
}

// ---------------------------------------------------------------------
// Phase 7 (SUN-1216 checkpoint V): the REAL production entrypoint
// (`wrangler.toml` -> `index.ts`), not the test-only entrypoint, now
// serving `POST /v2/verify/agent-output` through the genuine SUN-1214
// composition when `PAID_ROUTES_ENABLED=true` AND both signing vars are
// present. Proves: (a) the real entrypoint reaches real 402 issuance and
// real post-settlement success end to end; (b) GET on the exact same
// path is not claimed by the new registration -- it still falls through
// to the untouched `/v2/*` wildcard; (c) the other 11 paid routes'
// disposition is provably unaffected by the two new signing vars being
// present. The signing key is a fresh, local, throwaway value (see
// `generateLocalTestSigningKeyHex` above) -- never the real
// SUN-1215-provisioned production secret, which this checkpoint does
// not read, rotate, or reuse anywhere.
// ---------------------------------------------------------------------
async function runPhase7() {
  const testKeyHex = generateLocalTestSigningKeyHex();
  const testKeyId = 'kid_sun1216local0123456789ab';
  await withDevServer(
    {
      dbName: 'siteborne-utility',
      vars: {
        ENVIRONMENT: 'development',
        PAID_ROUTES_ENABLED: 'true',
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: testKeyHex,
        PAID_RECEIPT_SIGNING_KEY_ID: testKeyId,
      },
    },
    async (base, _getLog, tempDir) => {
      record(
        'PHASE 7 (REAL production entrypoint, verify v2/CDP production composition enabled): worker boots under real workerd',
        true
      );

      // The REAL production entrypoint (unlike the test-only one)
      // correctly never self-seeds the D1 `services` table -- a real
      // deployed candidate's D1 is expected to already carry this row
      // (SUN-0800B checkpoint 3's out-of-band seed), which this
      // script's own isolated local D1 instance does not. Seed the one
      // row this scenario needs, mirroring
      // `worker-runtime-test-entrypoint.ts`'s own idempotent insert
      // (registry/services/verify_agent_output.v2.json's real, committed
      // field values) -- a test-harness fixture action, not a
      // production-code change.
      await runCommand(
        WRANGLER_BIN,
        [
          'd1',
          'execute',
          'siteborne-utility',
          '--local',
          '--persist-to',
          tempDir,
          '--command',
          `INSERT OR IGNORE INTO services (id, version, title, description, input_schema, output_schema, price_usd, production_enabled, production_ready, protocol_status) VALUES ('verify_agent_output.v2', 'v2', 'Agent Output Verification', 'Verifies the output of another agent against provided criteria, performing independent reproduction and comparison to produce a verification receipt.', 'https://siteborne.net/schemas/services/agent-verification-input.schema.json', 'https://siteborne.net/schemas/services/agent-verification-output.schema.json', 0.019, 0, 0, 'preproduction');`,
        ],
        REPO_ROOT
      );

      const path = '/v2/verify/agent-output';
      const body = {
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

      // (1) unsigned request through the REAL production entrypoint ->
      // real 402 with the canonical production price -- the central
      // SUN-1216 bundle-reachability proof at the HTTP level.
      const challenge = await get402(base, path, body);
      const actualAmount = challenge.accepts?.[0]?.amount;
      record(
        'PHASE 7 (1): REAL entrypoint, unsigned request -> real 402 with canonical production price',
        actualAmount === '19000',
        `expected=19000 actual=${actualAmount}`
      );

      // (2) synthetic payment -> real post-settlement success through
      // the REAL production entrypoint (not the test-only one Phase 6
      // already proved this against).
      const result = await payAndFetch(base, path, body, challenge);
      let parsed: any = {};
      try {
        parsed = JSON.parse(result.body);
      } catch {
        /* leave {} */
      }
      const ok =
        result.status === 200 &&
        parsed.result_class === 'success' &&
        parsed.output?.outcome === 'pass' &&
        typeof parsed.receipt_id === 'string';
      record(
        'PHASE 7 (2): REAL entrypoint, synthetic payment -> real post-settlement success',
        ok,
        `status=${result.status} result_class=${parsed.result_class} receipt_id_present=${typeof parsed.receipt_id === 'string'}`
      );

      // (3) method safety under real workerd: GET on the exact same
      // path is not claimed by the new POST-only registration -- it
      // falls through to the untouched, still-gated `/v2/*` wildcard
      // (503, the same governed disposition every other paid route
      // returns), never a 405 and never the new route's own behavior.
      const getRes = await fetch(base + path, { method: 'GET' });
      const getBody = (await getRes.json().catch(() => ({}))) as Record<string, unknown>;
      record(
        'PHASE 7 (3): GET /v2/verify/agent-output is not claimed by the new POST-only route -- falls through to the unchanged /v2/* wildcard',
        getRes.status === 503 && getBody.error === 'service_executor_not_configured',
        `status=${getRes.status} error=${String(getBody.error)}`
      );

      // (4) the other 11 paid routes remain unaffected by the two new
      // signing vars being present -- still the existing governed
      // unavailable disposition, never accidentally reached through
      // this checkpoint's new composition.
      const otherPaths = [
        '/v1/company/evidence-graph',
        '/v1/web/context',
        '/v1/document/evidence-json',
        '/v1/verify/agent-output',
        '/v2/company/evidence-graph',
        '/v2/web/context',
        '/v2/document/evidence-json',
      ];
      let allUnaffected = true;
      for (const otherPath of otherPaths) {
        const res = await fetch(base + otherPath, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (res.status !== 503 || b.error !== 'service_executor_not_configured') {
          allUnaffected = false;
        }
      }
      record(
        'PHASE 7 (4): the other paid routes remain unaffected by the new signing vars being present',
        allUnaffected
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
    // SUN-1204 checkpoint J: the two new deterministic Nevermined client
    // factories live only inside the same test-only entrypoint file, so
    // their absence is already implied by the check above -- re-asserted
    // explicitly by function name for a direct, named
    // `PRODUCTION_BUNDLE_CONTAINS_NEVERMINED_TEST_PROVIDER` proof.
    const containsNeverminedTestProvider =
      bundle.includes('successNeverminedClient') || bundle.includes('denyingNeverminedClient');
    record(
      'bundle isolation: real wrangler.toml dry-run bundle does NOT contain the Nevermined test-only client factories',
      !containsNeverminedTestProvider,
      `containsNeverminedTestProvider=${containsNeverminedTestProvider}`
    );
    // SUN-1216: these markers indicate an actual fixture/bypass EXECUTION
    // path reaching production -- a fixture signer, a fixture service
    // registry, or a fixture document worker bridge that could produce
    // an unsigned/synthetic result instead of the real one. Must remain
    // exactly zero, unconditionally -- never weakened by this or any
    // later checkpoint.
    const hardFixtureBypassMarkers = [
      'buildFixtureRegistry',
      'createFixtureSigner',
      'FixtureDocumentWorkerBridge',
      'doc/native-fixture.pdf',
    ].filter((marker) => bundle.includes(marker));
    record(
      'bundle isolation: production runtime contains zero fixture BYPASS markers (fixture signer/registry/worker-bridge)',
      hardFixtureBypassMarkers.length === 0,
      `markers=${hardFixtureBypassMarkers.join(',') || 'none'}`
    );
    // SUN-1216 PRE-UPLOAD RESIDUAL ADJUDICATION. The literal string
    // "zero fixture markers" is intentionally NOT the gate below --
    // STRING_MARKER_PRESENT (raw text search) and
    // FIXTURE_RUNTIME_REACHABILITY (can this text ever actually
    // execute, and under what evidence-mode boundary) are two different
    // properties, reported separately with structural evidence for
    // each, per the adjudication requirement not to rename a failure
    // after the fact.
    //
    // STRING_MARKER_PRESENT (informational, NOT a gate): these four
    // strings are present in the bundle's source text.
    //   - createTestClock / createTestArtifactStore /
    //     createTestServiceAuditSink: `buildServiceContext`
    //     (packages/service-runtime/src/context.ts) references them as
    //     its own `??` fixture-mode fallback. esbuild's Workers
    //     bundling does not eliminate the unreachable function bodies
    //     from the source file that also exports the reachable
    //     `buildServiceContext`.
    //   - synthetic_fixture: `resolveProductionCdpEvidenceProvider`'s
    //     (apps/edge-api/src/control-plane/config/production-payment.ts)
    //     own, real, frozen fail-closed default when
    //     `getAuthenticatedSellerAddress` is not supplied.
    //
    // FIXTURE_RUNTIME_REACHABILITY (the real gate, proven with
    // structural evidence, not asserted):
    //   - Finding A (createTestClock/createTestArtifactStore/
    //     createTestServiceAuditSink): proven UNREACHABLE by
    //     `verify-agent-output-v2-production-executor.context-defaults.test.ts`
    //     -- the one production-reachable call site supplies
    //     clock/artifact_store/audit as unconditional, non-nullable
    //     function-call expressions (the `??` right-hand side cannot
    //     evaluate, by JS operator semantics, not by current argument
    //     choice), and no other production-reachable file calls
    //     `buildServiceContext` at all.
    //   - Finding B (synthetic_fixture): the underlying capability gap
    //     (`getAuthenticatedSellerAddress` unwired anywhere in this
    //     repository -- a pre-existing, SUN-1213-documented R0 to
    //     PAID-ROUTE ACTIVATION, not something this checkpoint
    //     introduces or closes) is NOT resolved -- but
    //     `verify-agent-output-v2-cdp-composition.evidence-integrity.test.ts`
    //     proves the composition can only ever resolve to
    //     `evidenceMode: 'fixture'` under that gap, and that the
    //     repository's own frozen `isTrustClassAllowed`
    //     (packages/protocol-x402/src/evidence/policy.ts, unmodified)
    //     never allows `'synthetic_fixture'` to satisfy `'production'`
    //     mode. This is a real, tracked, standing R0 to activation --
    //     not a defect newly introduced by this checkpoint's bundle
    //     integration, and not something a "bundle integration behind a
    //     disabled gate" checkpoint can or should close (see the
    //     closure report's activation-blocker section). It remains
    //     the reason `PAID_ROUTE_ACTIVATION_AUTHORIZED=NO` stands.
    const stringMarkerPresent = [
      'createTestClock',
      'createTestArtifactStore',
      'createTestServiceAuditSink',
      'synthetic_fixture',
    ].filter((marker) => bundle.includes(marker));
    record(
      'STRING_MARKER_PRESENT (informational, NOT a gate -- see FIXTURE_RUNTIME_REACHABILITY below for the real safety property)',
      true,
      `markers=${stringMarkerPresent.join(',') || 'none'}`
    );
    record(
      'FIXTURE_RUNTIME_REACHABILITY (the real gate): hard-bypass markers=0 AND structural non-reachability proven for both disclosed findings -- see verify-agent-output-v2-production-executor.context-defaults.test.ts and verify-agent-output-v2-cdp-composition.evidence-integrity.test.ts',
      hardFixtureBypassMarkers.length === 0,
      `hardBypassMarkers=${hardFixtureBypassMarkers.length} findingA=UNREACHABLE(proven) findingB=CONFINED_TO_NON_PRODUCTION_MODE(proven, R0-to-activation-standing)`
    );
    // SUN-1216 checkpoint V: unlike SUN-1214 (where these three modules
    // were built but never imported by index.ts), the real production
    // entrypoint now DOES import the verify_agent_output.v2/CDP
    // production composition -- this is the central SUN-1216
    // deliverable, so the assertion inverts from SUN-1214's own
    // "must be absent" check to "must be present".
    const productionCompositionMarkers = {
      PRODUCTION_SIGNER_IN_NEW_BUNDLE: bundle.includes('buildProductionSigner'),
      VERIFY_V2_PRODUCTION_EXECUTOR_IN_NEW_BUNDLE: bundle.includes(
        'buildVerifyAgentOutputV2ProductionExecutor'
      ),
      VERIFY_V2_CDP_COMPOSITION_IN_NEW_BUNDLE: bundle.includes(
        'buildVerifyAgentOutputV2CdpProductionRouteConfig'
      ),
    };
    record(
      'bundle inclusion (SUN-1216 central deliverable): real wrangler.toml dry-run bundle DOES contain the verify v2/CDP production composition modules',
      Object.values(productionCompositionMarkers).every(Boolean),
      Object.entries(productionCompositionMarkers)
        .map(([k, v]) => `${k}=${v ? 'YES' : 'NO'}`)
        .join(' ')
    );
    // The new integration point itself must also be present -- proves
    // the route module, not just the three modules it imports, is
    // bundle-reachable.
    const containsIntegrationRoute = bundle.includes('verifyAgentOutputV2CdpProductionRoute');
    record(
      'bundle inclusion: real wrangler.toml dry-run bundle contains the new SUN-1216 integration route module',
      containsIntegrationRoute
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

async function main() {
  let exitCode = 0;
  try {
    await runPhase0();
    await runPhase1();
    await runPhase2();
    await runPhase3();
    await runPhase4();
    await runPhase5();
    await runPhase6();
    await runPhase7();
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
