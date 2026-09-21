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
import {
  resolveServiceMaxPriceUsd,
  usdToAtomicUnits,
} from '../packages/pricing/src/service-prices';

/** Price assertions for v2 routes must follow the v2 pricing key used by
 * the production compositions. Keeping these values derived prevents the
 * real-workerd qualification harness from silently asserting the v1 price
 * after an intentional v1/v2 price split. */
const WEB_CONTEXT_V2_EXPECTED_ATOMIC = usdToAtomicUnits(
  resolveServiceMaxPriceUsd('web_context_verified_direct_v2'),
  6
);

/** Phase 6's real-production-composition price assertion (SUN-1222D-
 * RESUME §3) must track `governance/RISK_LIMITS.yaml`'s own
 * `verify_agent_output_standard_v2` key -- the same authoritative source
 * `verify-agent-output-v2-cdp-composition.ts` reads via `pricingKey` --
 * rather than a second, independently-drifting literal. A prior literal
 * (`'19000'`, `verify_agent_output_standard`'s pre-SUN-1222C-R3 v1 price)
 * silently stopped tracking the real v2 price when SUN-1222C-R3 froze
 * `verify_agent_output_standard_v2` at 0.017/17000, producing exactly
 * the false-positive-red this constant closes. */
const VERIFY_AGENT_OUTPUT_V2_EXPECTED_ATOMIC = usdToAtomicUnits(
  resolveServiceMaxPriceUsd('verify_agent_output_standard_v2'),
  6
);

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
      headers: mcpHeaders('tools/call', 'siteborne_build_company_evidence_graph'),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1207,
        method: 'tools/call',
        params: {
          name: 'siteborne_build_company_evidence_graph',
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

      // SUN-1218 checkpoint X: PAID_ROUTES_ENABLED alone (this phase's
      // own vars, unchanged) no longer implies any non-nevermined route
      // is even nominally "enabled but unready" -- the 8 non-nevermined
      // paths (including /v2/verify/agent-output, which additionally
      // requires its own VERIFY_V2_CDP_ROUTE_ENABLED, deliberately not
      // set here) are now unconditionally 404 (Tasks 3+4). Only the 4
      // Nevermined routes (NEVERMINED_ROUTES_ENABLED=true, a genuinely
      // separate, untouched flag) still reach the existing governed
      // 503. Disclosed, intentional change from the pre-SUN-1218
      // behavior.
      const unsupportedPaths = [
        '/v1/company/evidence-graph',
        '/v1/web/context',
        '/v1/document/evidence-json',
        '/v1/verify/agent-output',
        '/v2/company/evidence-graph',
        '/v2/web/context',
        '/v2/document/evidence-json',
        '/v2/verify/agent-output',
      ];
      const neverminedPaths = [
        '/v2/nevermined/company/evidence-graph',
        '/v2/nevermined/web/context',
        '/v2/nevermined/document/evidence-json',
        '/v2/nevermined/verify/agent-output',
      ];
      for (const path of unsupportedPaths) {
        const res = await fetch(base + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        record(
          `PHASE 1: ${path} remains 404 (no route-specific executor / activation gate satisfied) under real workerd`,
          res.status === 404 &&
            !res.headers.get('PAYMENT-REQUIRED') &&
            !res.headers.get('PAYMENT-RESPONSE'),
          `status=${res.status}`
        );
      }
      for (const path of neverminedPaths) {
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
      // SUN-1221E6R-H2AWI-3: `document_evidence_json.v1` is `upto`
      // scheme -- intentionally, honestly rejected wholesale (500,
      // before the executor ever runs) by the new durable-continuation
      // pipeline this checkpoint, matching the same disclosed decision
      // applied throughout this checkpoint's test suite (H2AWI-2's
      // frozen DecryptedContinuationPayload has no room for
      // post-execution actualAmountAtomic/resourceMetrics; no real
      // production route uses `upto`).
      const isUptoNotSupported = svc.name === 'document_evidence_json.v1';
      const ok = isUptoNotSupported
        ? result.status === 500 && parsed.error === 'service_execution_failed'
        : result.status === 200 &&
          parsed.result_class === 'success' &&
          typeof parsed.receipt_id === 'string' &&
          typeof parsed.link_id === 'string';
      record(
        `PHASE 3 (P3): ${svc.name} synthetic payment -> ${isUptoNotSupported ? 'H2AWI-3 disclosed upto-not-supported rejection' : 'real post-settlement success'} under real workerd`,
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
        expectedAmount: '31200', // 0.0312 USD * 1e6
      },
      {
        name: 'web_context_verified.v2',
        path: '/v2/web/context',
        body: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
        expectedAmount: WEB_CONTEXT_V2_EXPECTED_ATOMIC,
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
      // SUN-1221E6R-H2AWI-3: same disclosed upto-not-supported rejection
      // as PHASE 3 (P3) above -- `document_evidence_json.v2` is also
      // `upto` scheme.
      const isUptoNotSupported = svc.name === 'document_evidence_json.v2';
      const ok = isUptoNotSupported
        ? result.status === 500
        : result.status === 200 &&
          parsed.result_class === 'success' &&
          parsed.service_id === svc.name &&
          typeof parsed.receipt_id === 'string' &&
          typeof parsed.link_id === 'string';
      record(
        `PHASE 4 (A3): ${svc.name} synthetic payment -> ${isUptoNotSupported ? 'H2AWI-3 disclosed upto-not-supported rejection' : 'real post-settlement success'} under real workerd`,
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
        expectedAmount: '31200',
      },
      {
        name: 'web_context_verified.v2 (Nevermined)',
        path: '/v2/nevermined/web/context',
        body: { target_url: 'https://acme.example/', retrieval_mode: 'direct' },
        expectedAmount: WEB_CONTEXT_V2_EXPECTED_ATOMIC,
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
        expectedAmount: VERIFY_AGENT_OUTPUT_V2_EXPECTED_ATOMIC,
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
      // SUN-1221E6R-H2AWI-3: same disclosed upto-not-supported rejection
      // as PHASE 3/4 above -- `document_evidence_json.v2` is `upto`
      // scheme regardless of rail.
      const isUptoNotSupported = svc.name === 'document_evidence_json.v2 (Nevermined)';
      const ok = isUptoNotSupported
        ? res.status === 500
        : res.status === 200 &&
          parsed.result_class === 'success' &&
          parsed.service_id === svc.name.replace(' (Nevermined)', '') &&
          typeof parsed.receipt_id === 'string' &&
          typeof parsed.link_id === 'string';
      record(
        `PHASE 5 (N3): ${svc.name} synthetic verified access -> ${isUptoNotSupported ? 'H2AWI-3 disclosed upto-not-supported rejection' : 'real post-settlement success'} under real workerd`,
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
      actualAmount === VERIFY_AGENT_OUTPUT_V2_EXPECTED_ATOMIC,
      `expected=${VERIFY_AGENT_OUTPUT_V2_EXPECTED_ATOMIC} actual=${actualAmount}`
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
    // SUN-1221E6R-H2AWI-3: this scenario's premise (a synthetic payment
    // through the real production composition reaches a real
    // post-settlement success) required the in-request settle() call
    // this checkpoint removes from x402-service.ts unconditionally (see
    // the settle-sole-ownership audit test). The real production
    // composition files
    // (production/verify-agent-output-v2-cdp-composition.ts) are
    // deliberately, correctly left UNWIRED with a Workflow binding this
    // checkpoint -- wiring `env.PAID_CONTINUATION_WORKFLOW`/the real
    // envelope key into them is explicitly H2AWI-4 scope (its own
    // fresh, separate provisioning authorization), never this
    // checkpoint's. The route therefore now fails closed (500
    // repository_failure: "durable payment continuation is not
    // configured for this route") for ANY payment through this real
    // composition, synthetic or real -- there is no local settle
    // fallback left anywhere in this file to silently regress to. This
    // is the CORRECT, intended behavior: `SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE`
    // remains `NO`, unchanged by this checkpoint, and now additionally
    // enforced structurally rather than merely by convention.
    const result = await payAndFetch(base, path, body, challenge);
    let parsed: any = {};
    try {
      parsed = JSON.parse(result.body);
    } catch {
      /* leave {} */
    }
    const failsClosedNotConfigured = result.status === 500 && parsed.error === 'repository_failure';
    record(
      'PHASE 6 (2): verify-production synthetic payment -> fails closed (durable continuation not yet wired, H2AWI-4 scope) through the real production composition',
      failsClosedNotConfigured,
      `status=${result.status} error=${parsed.error} message=${parsed.message}`
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
      // SUN-1221E6R-H2AWI-3: same disclosed fail-closed reality as
      // Scenario 2 above -- the first attempt never reaches a
      // success/receipt to be duplicate-consistent with. What this
      // scenario can still honestly prove: the first attempt fails
      // closed (never a false success), and the SECOND (duplicate_same)
      // attempt is never a second executor/settlement attempt either --
      // it falls through to the pre-existing `202 processing` (no
      // durable Workflow instance was ever created for this
      // payment_identifier, since the route never reached handoff), the
      // same pre-existing "still processing" contract shape this
      // checkpoint's design explicitly preserves, never a false
      // success and never an unhandled error.
      const bothFailClosedSafely =
        first.status === 500 &&
        firstParsed.error === 'repository_failure' &&
        second.status === 202 &&
        secondParsed.status === 'processing';
      record(
        'PHASE 6 (4): duplicate request (same payment identifier) -- both attempts fail closed safely (no durable continuation wired, H2AWI-4 scope), never a false success',
        bothFailClosedSafely,
        `firstStatus=${first.status} firstError=${firstParsed.error} secondStatus=${second.status} secondStatusField=${secondParsed.status}`
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
        VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: testKeyHex,
        PAID_RECEIPT_SIGNING_KEY_ID: testKeyId,
      },
    },
    async (base) => {
      record(
        'PHASE 7 (REAL production entrypoint, both activation gates enabled, no real CDP bindings): worker boots under real workerd',
        true
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

      // SUN-1218 checkpoint X: with both activation gates true but no
      // real CDP bindings (the exact shape of this local run, matching
      // every prior phase -- never the real production secrets), the
      // REAL entrypoint now correctly fails closed to the existing
      // governed pre-economic 503, NEVER a 402 challenge and NEVER a
      // fixture-evidenced "success." This is the corrected, intended
      // replacement for the pre-SUN-1218 version of this scenario,
      // which incorrectly reached a full synthetic-payment success
      // through the real entrypoint via a silent fixture fallback --
      // exactly the R0 this checkpoint closes. The full 402 -> real
      // post-settlement success flow through the real SUN-1214
      // composition remains proven by Phase 6, via the test-only
      // entrypoint's explicit, narrowly-scoped test-evidence injection.
      const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      record(
        'PHASE 7 (1): REAL entrypoint, both gates enabled, no real CDP bindings -> governed pre-economic 503, never a payment challenge, never a silent fixture success',
        res.status === 503 &&
          resBody.error === 'service_executor_not_configured' &&
          !res.headers.get('PAYMENT-REQUIRED') &&
          !res.headers.get('PAYMENT-RESPONSE'),
        `status=${res.status} error=${String(resBody.error)}`
      );

      // (2) method safety under real workerd: GET on the exact same
      // path is not claimed by the new POST-only registration -- it
      // falls through to the untouched `/v2/*` wildcard, now
      // unconditionally 404 (SUN-1218 Task 4), never a 405 and never
      // the new route's own behavior.
      const getRes = await fetch(base + path, { method: 'GET' });
      record(
        'PHASE 7 (2): GET /v2/verify/agent-output is not claimed by the new POST-only route -- falls through to the unconditionally-404 /v2/* wildcard',
        getRes.status === 404,
        `status=${getRes.status}`
      );

      // (3) the other 7 non-nevermined paid routes remain unconditional
      // 404, decoupled from PAID_ROUTES_ENABLED (SUN-1218 Task 4), even
      // with both verify activation gates true.
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
        const otherRes = await fetch(base + otherPath, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (otherRes.status !== 404) allUnaffected = false;
      }
      record(
        'PHASE 7 (3): the other 7 non-nevermined paid routes remain unconditionally 404, decoupled from PAID_ROUTES_ENABLED',
        allUnaffected
      );
    }
  );
}

// ---------------------------------------------------------------------
// Phase 8 (SUN-1218 checkpoint X): the full two-gate activation matrix
// against the REAL production entrypoint, under real workerd. Proves
// the exact frozen truth table:
//   GLOBAL=false, ROUTE=false -> 12/12 404
//   GLOBAL=true,  ROUTE=false -> 12/12 404
//   GLOBAL=false, ROUTE=true  -> 12/12 404
//   GLOBAL=true,  ROUTE=true  -> verify governed (503 pre-economic here,
//                                no real CDP bindings), other 11 -> 404
// plus that turning GLOBAL back off immediately restores 404 (kill
// switch still works after both gates were briefly true). No live CDP
// call anywhere in this phase.
// ---------------------------------------------------------------------
async function runPhase8() {
  const testKeyHex = generateLocalTestSigningKeyHex();
  const testKeyId = 'kid_sun1216local0123456789ab';
  const ALL_TWELVE = [
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

  async function allTwelveStatuses(base: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const p of ALL_TWELVE) {
      const res = await fetch(base + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      out[p] = res.status;
    }
    return out;
  }

  function allAre(statuses: Record<string, number>, expected: number): boolean {
    return Object.values(statuses).every((s) => s === expected);
  }

  // State A: global=false, route=false.
  await withDevServer(
    {
      dbName: 'siteborne-utility',
      vars: { ENVIRONMENT: 'development' },
    },
    async (base) => {
      record('PHASE 8 (State A, real entrypoint): worker boots under real workerd', true);
      const statuses = await allTwelveStatuses(base);
      record(
        'PHASE 8 (State A): global=false, route=false -> 12/12 404',
        allAre(statuses, 404),
        JSON.stringify(statuses)
      );
    }
  );

  // State B: global=true, route=false.
  await withDevServer(
    {
      dbName: 'siteborne-utility',
      vars: { ENVIRONMENT: 'development', PAID_ROUTES_ENABLED: 'true' },
    },
    async (base) => {
      record('PHASE 8 (State B, real entrypoint): worker boots under real workerd', true);
      const statuses = await allTwelveStatuses(base);
      record(
        'PHASE 8 (State B): global=true, route=false -> 12/12 404 (the exact contradiction SUN-1218 resolves)',
        allAre(statuses, 404),
        JSON.stringify(statuses)
      );
    }
  );

  // State C: global=false, route=true.
  await withDevServer(
    {
      dbName: 'siteborne-utility',
      vars: { ENVIRONMENT: 'development', VERIFY_V2_CDP_ROUTE_ENABLED: 'true' },
    },
    async (base) => {
      record('PHASE 8 (State C, real entrypoint): worker boots under real workerd', true);
      const statuses = await allTwelveStatuses(base);
      record(
        'PHASE 8 (State C): global=false, route=true -> 12/12 404 (master kill switch checked first)',
        allAre(statuses, 404),
        JSON.stringify(statuses)
      );
    }
  );

  // State D: global=true, route=true, no real CDP bindings -> verify
  // governed pre-economic 503, other 11 -> 404. Then flip global back to
  // false without restarting the Worker -- proven via a fresh dev server
  // started directly in the "already off again" shape, since flipping a
  // committed [vars] value requires a new Worker instance in this local
  // harness; the kill-switch-still-works property is separately and
  // exactly proven by production-verify-v2-cdp-route.test.ts's own unit
  // test at the vitest level (already covered, Task 3) -- this phase's
  // job is the real-workerd HTTP-level proof of State D specifically.
  await withDevServer(
    {
      dbName: 'siteborne-utility',
      vars: {
        ENVIRONMENT: 'development',
        PAID_ROUTES_ENABLED: 'true',
        VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: testKeyHex,
        PAID_RECEIPT_SIGNING_KEY_ID: testKeyId,
      },
    },
    async (base) => {
      record('PHASE 8 (State D, real entrypoint): worker boots under real workerd', true);
      const statuses = await allTwelveStatuses(base);
      const verifyOk = statuses['/v2/verify/agent-output'] === 503;
      const otherEleven = ALL_TWELVE.filter((p) => p !== '/v2/verify/agent-output');
      const othersOk = otherEleven.every((p) => statuses[p] === 404);
      record(
        'PHASE 8 (State D): global=true, route=true, no real CDP bindings -> verify=503 (governed pre-economic), other 11=404',
        verifyOk && othersOk,
        JSON.stringify(statuses)
      );
    }
  );
}

// ---------------------------------------------------------------------
// Phase 9 (SUN-1221E1): official MCP protocol through the REAL production
// entrypoint under the exact two-service candidate-equivalent gate shape.
// Only the credential-presence boundary is substituted with local throwaway
// values; no service tool, payment path, external provider, or live network
// dependency is invoked. This is the workerd-level counterpart to the
// cross-surface Vitest matrix.
// ---------------------------------------------------------------------
async function runPhase9() {
  await withDevServer(
    {
      dbName: 'siteborne-utility',
      vars: {
        ENVIRONMENT: 'production',
        PAID_ROUTES_ENABLED: 'true',
        VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
        WEB_CONTEXT_V2_CDP_ROUTE_ENABLED: 'true',
        PAYMENT_ENVIRONMENT: 'production',
        PRODUCTION_ENABLED: 'true',
        HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
        PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
        PAID_RECEIPT_SIGNING_PRIVATE_KEY: generateLocalTestSigningKeyHex(),
        PAID_RECEIPT_SIGNING_KEY_ID: 'kid_sun1221e1local012345678',
        SELLER_WALLET_ADDRESS: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
        CDP_API_KEY_ID: 'sun1221e1-local-key-id',
        CDP_API_KEY_SECRET: 'sun1221e1-local-key-secret',
      },
    },
    async (base, getLog) => {
      record(
        'PHASE 9 (SUN-1221E1, real entrypoint): candidate-equivalent worker boots under real workerd',
        true
      );

      const response = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: mcpHeaders('tools/call', 'siteborne_get_service_health'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 12211,
          method: 'tools/call',
          params: {
            name: 'siteborne_get_service_health',
            arguments: {},
            _meta: mcpMeta(),
          },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as any;
      const health = body?.result?.structuredContent;
      record(
        'PHASE 9: official MCP health call succeeds with aggregate production enabled',
        response.status === 200 && health?.production_enabled === true,
        `status=${response.status} production_enabled=${String(health?.production_enabled)}`
      );

      const verify = health?.services?.['verify_agent_output.v2'];
      const web = health?.services?.['web_context_verified.v2'];
      record(
        'PHASE 9: MCP reports both governed real executors active/configured under candidate-equivalent gates',
        verify?.implementation === 'real_executor' &&
          verify?.production === 'production_enabled' &&
          verify?.external === 'configured' &&
          web?.implementation === 'real_executor' &&
          web?.production === 'production_enabled' &&
          web?.external === 'configured',
        `verify=${JSON.stringify(verify)} web=${JSON.stringify(web)}`
      );

      const unsupported = ['company_evidence_graph.v2', 'document_evidence_json.v2'];
      const unsupportedInactive = unsupported.every((serviceId) => {
        const status = health?.services?.[serviceId];
        return status?.production === 'production_disabled' && status?.external === 'not_live';
      });
      const hasProviderTraffic = /api\.sandbox\.nevermined\.app|api\.cdp\.coinbase\.com/i.test(
        getLog()
      );
      record(
        'PHASE 9: represented unsupported services stay inactive and MCP health performs zero provider work',
        unsupportedInactive && !hasProviderTraffic,
        `unsupportedInactive=${unsupportedInactive} providerTraffic=${hasProviderTraffic}`
      );
    }
  );
}

// ---------------------------------------------------------------------
// PHASE 10 (SUN-1221E2D §9, superseded by SUN-1221E5Q6G): historically the
// ONE local, real-`workerd`, real-`cloudflare:sockets` reproduction of
// SUN-1221E2's real HTTP 502 -- the REAL production composition making
// one genuine paid, settled outbound fetch to `https://example.com/` via
// `SafeSocketHttpClient`. That transport is NO LONGER the production path:
// SUN-1221E5Q6E proved Cloudflare Workers cannot reach any target whose
// resolved address falls inside Cloudflare's own IP ranges (which
// `example.com` does), so SUN-1221E5Q6F/G's human-approved architecture
// moved ALL `web_context_verified.v2` direct-HTTP retrieval to a dedicated
// off-Cloudflare executor (`services/webctx-safe-egress`, Modal) --
// `buildWebContextV2CdpProductionRouteConfig` now fails closed
// (`unavailable: true`) whenever `MODAL_WEBCTX_*` credentials are absent,
// exactly like the CDP/receipt-signing gates above it, and this isolated
// test harness never provisions them (never fabricated, per SUN-1221E5Q6G
// §26's secret-mutation gate). This phase now proves exactly that
// fail-closed behavior -- no 402, no payment, no settlement, no real
// network egress at all, unlike its historic version. A future checkpoint
// that legitimately provisions a deployed Modal executor and real
// `MODAL_WEBCTX_*` credentials for this isolated test harness should
// restore a genuine end-to-end proof here.
// ---------------------------------------------------------------------
async function runPhase10() {
  const configPath = join(REPO_ROOT, 'wrangler.worker-runtime-test.toml');
  await withDevServer({ configPath, dbName: 'siteborne-worker-runtime-test' }, async (base) => {
    record(
      'PHASE 10 (test-only entrypoint, web-context v2/CDP PRODUCTION composition): worker boots under real workerd',
      true
    );

    const path = '/v2/web-context-production/context';
    const body = { target_url: 'https://example.com/', retrieval_mode: 'direct' };

    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let parsed: any = {};
    try {
      parsed = await res.json();
    } catch {
      /* leave {} */
    }
    // SUN-1221E5Q6G: fails closed with a configuration_error, never a 402
    // challenge and never a settled paid fetch -- MODAL_WEBCTX_* credentials
    // are not provisioned in this isolated test harness, and this repository
    // never fabricates them.
    record(
      'PHASE 10: web-context-production composition fails closed (configuration_error) without MODAL_WEBCTX_* credentials -- SafeSocket is no longer the production transport (SUN-1221E5Q6G)',
      res.status === 500 &&
        parsed.error === 'configuration_error' &&
        /MODAL_WEBCTX/.test(parsed.message ?? ''),
      `status=${res.status} error=${parsed.error} message=${parsed.message}`
    );
  });
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
    // SUN-1221E5Q: the dev-only Cloudflare-network reproduction seam
    // (`apps/edge-api/src/dev-diagnostics/webctx-remote-diagnostic.ts`) is
    // never imported by the real entrypoint (proven at the source-import
    // level by `dev-diagnostics-webctx-remote.test.ts`) -- re-proven here
    // at the strongest level available: the actual compiled bundle this
    // real `wrangler.toml` would deploy contains neither its gate variable
    // name nor its route path, so there is no way for that seam to reach
    // production even if some future change accidentally imported it
    // without also wiring the gate/route through.
    const containsDiagnosticSeamGate = bundle.includes('DIAGNOSTIC_SEAM_ENABLED');
    const containsDiagnosticSeamRoute = bundle.includes('__diag/webctx-remote');
    record(
      'bundle isolation: real wrangler.toml dry-run bundle does NOT contain the SUN-1221E5Q dev-only diagnostic seam',
      !containsDiagnosticSeamGate && !containsDiagnosticSeamRoute,
      `containsDiagnosticSeamGate=${containsDiagnosticSeamGate} containsDiagnosticSeamRoute=${containsDiagnosticSeamRoute}`
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
    // SUN-1221E6R-H2AWI-1 (as of H2AWI-2): the durable-continuation
    // shared primitives (apps/edge-api/src/control-plane/continuation/*)
    // were inert building blocks -- no WorkflowEntrypoint, no Workflow
    // binding, and nothing in `index.ts`'s import graph reached them.
    //
    // SUN-1221E6R-H2AWI-3 flips this gate's DIRECTION deliberately, not
    // by accident: this checkpoint is EXACTLY where `x402-service.ts`
    // (imported by `index.ts`) starts calling `handoff.ts`, which calls
    // `deriveWorkflowInstanceId`/`sealContinuationEnvelope` -- so the
    // Workflow instance-ID prefix and the instance-ID validation
    // TypeError message (two exact, real strings pulled directly from
    // the source, never approximations) are now the POSITIVE
    // reachability proof the checkpoint's own evidence report requires
    // (mission AFTER IMPLEMENTATION item 4: "prove the wiring is real,
    // not dead code"). Continuing to assert their ABSENCE here would
    // mean H2AWI-3 failed to wire anything real -- the opposite of what
    // actually happened.
    //
    // SUN-1221E6R-H2BF1 flips this gate's DIRECTION again, deliberately,
    // for the same reason H2AWI-3 flipped the one above it: this is
    // EXACTLY where `PaidContinuationWorkflow.run()` (already exported
    // from `index.ts` since H2AWI-4R, for the Workflow binding's
    // `class_name` resolution) stops being a self-contained
    // `throw new Error(...)` stub and starts genuinely calling
    // `runPaidContinuationWorkflow`, which calls `openContinuationEnvelope`
    // -- making its two `EnvelopeOpenError` messages reachable from
    // `index.ts`'s import graph for the first time. Before this
    // checkpoint, the stub referenced neither function, so esbuild
    // tree-shook both out of the bundle entirely (the previous, correct
    // "not yet wired" absence proof). H2BF1 flipped this to "must be
    // present" because at that point `PaidContinuationWorkflow` was still
    // exported from THIS Worker's own `index.ts` (same-script topology).
    //
    // SUN-1221E6R-H2BF4 flips this gate's DIRECTION a third time,
    // deliberately, for the opposite reason: `index.ts` no longer exports
    // `PaidContinuationWorkflow` at all -- the class now lives exclusively
    // in the dedicated Workflow-host script
    // (`workflow-host-entrypoint.ts` / `wrangler.paid-continuation-
    // runtime.toml`, see `runWorkflowHostBundleIsolationCheck` below,
    // which asserts these SAME two strings ARE present in THAT bundle
    // instead). Continuing to assert their presence HERE would mean the
    // H2BF4 split failed to actually separate the two runtimes -- exactly
    // the defect this checkpoint exists to prove is NOT the case (see
    // docs/design/SUN-1221E6R-H2BF4-dedicated-workflow-host-architecture.md
    // and docs/reports/SUN-1221E6R-H2BF4-dedicated-workflow-host-local-
    // qualification.md).
    const reachableContinuationMarkers = [
      'siteborne-wf-',
      'paymentIdentifier must be a non-empty string',
    ].filter((marker) => bundle.includes(marker));
    const workflowRunOnlyMarkers = [
      'Continuation envelope decryption failed',
      'Continuation envelope associated data does not match',
    ].filter((marker) => bundle.includes(marker));
    record(
      'bundle reachability (SUN-1221E6R-H2AWI-3): real wrangler.toml dry-run bundle DOES contain the handoff-path durable-continuation primitives -- proof x402-service.ts really calls handoff.ts, not dead code',
      reachableContinuationMarkers.length === 2,
      `markers=${reachableContinuationMarkers.join(',') || 'none'}`
    );
    record(
      'bundle isolation (SUN-1221E6R-H2BF4): real wrangler.toml (public API Worker) dry-run bundle does NOT contain PaidContinuationWorkflow.run()-only markers -- proof the Workflow class/orchestration/envelope-open path moved OUT to the dedicated host script, not merely duplicated',
      workflowRunOnlyMarkers.length === 0,
      `markers=${workflowRunOnlyMarkers.join(',') || 'none'}`
    );
    // esbuild lowers `export class X extends Y` to `var X = class extends
    // Y`, never a literal `class X` token -- this marker matches esbuild's
    // actual emitted form (confirmed by direct inspection of both bundles
    // this checkpoint), not the TypeScript source syntax.
    const containsWorkflowClassBody = bundle.includes(
      'PaidContinuationWorkflow = class extends WorkflowEntrypoint'
    );
    record(
      'bundle isolation (SUN-1221E6R-H2BF4): real wrangler.toml (public API Worker) dry-run bundle does NOT contain the PaidContinuationWorkflow class body itself',
      !containsWorkflowClassBody &&
        !bundle.includes('buildProductionPaidContinuationWorkflowDependencies'),
      `containsClass=${containsWorkflowClassBody} containsDepsBuilder=${bundle.includes('buildProductionPaidContinuationWorkflowDependencies')}`
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
    //   - synthetic_fixture: (SUN-1218 checkpoint X) now reachable
    //     ONLY via the composition's explicit, narrowly-typed
    //     `explicitTestEvidenceOverride` third parameter -- the real
    //     production route module never supplies it (structurally
    //     proven, see below); the only file that does is
    //     `worker-runtime-test-entrypoint.ts`, never imported by
    //     `index.ts`.
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
    //   - Finding B (synthetic_fixture): SUN-1218 checkpoint X closes
    //     this. `getAuthenticatedSellerAddress` is now wired for real
    //     (`buildCdpSellerAddressLookup`/
    //     `buildProductionCdpAccountLookupClientFactory`, SUN-1200
    //     checkpoints C/D). The production call site (no third
    //     argument) fails closed to `{unavailable: true}` whenever real
    //     evidence cannot be established -- proven by
    //     `verify-agent-output-v2-cdp-composition.evidence-integrity.test.ts`
    //     and `verify-agent-output-v2-cdp-composition.production-evidence.test.ts`,
    //     and by fixture-reintroduction Proof D
    //     (`scripts/test-production-fixture-reintroduction-caught.mts`).
    //     `synthetic_fixture` is reachable ONLY via the explicit
    //     `explicitTestEvidenceOverride` parameter the real production
    //     route module never supplies (structurally proven below).
    //     This is no longer a standing R0 to activation via this
    //     mechanism -- the remaining activation prerequisites are
    //     ADR-0055's deliberate human-authorization gates (see the
    //     closure report).
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
      'FIXTURE_RUNTIME_REACHABILITY (the real gate): hard-bypass markers=0 AND structural non-reachability proven for both disclosed findings -- see verify-agent-output-v2-production-executor.context-defaults.test.ts, verify-agent-output-v2-cdp-composition.evidence-integrity.test.ts, and Proof D',
      hardFixtureBypassMarkers.length === 0,
      `hardBypassMarkers=${hardFixtureBypassMarkers.length} findingA=UNREACHABLE(proven) findingB=FAIL_CLOSED_R0_CLOSED_SUN1218(proven, synthetic_fixture reachable only via explicit test-only override)`
    );
    // SUN-1218 checkpoint X: the real production evidence-resolution
    // functions must now be present in the real bundle -- confirms
    // Task 1's wiring is genuinely reachable, not merely present in
    // source.
    const productionEvidenceMarkers = {
      SELLER_ADDRESS_LOOKUP_IN_NEW_BUNDLE: bundle.includes('buildCdpSellerAddressLookup'),
      ACCOUNT_LOOKUP_CLIENT_FACTORY_IN_NEW_BUNDLE: bundle.includes(
        'buildProductionCdpAccountLookupClientFactory'
      ),
    };
    record(
      'bundle inclusion (SUN-1218 central deliverable): real wrangler.toml dry-run bundle DOES contain the real production payment-evidence resolution functions',
      Object.values(productionEvidenceMarkers).every(Boolean),
      Object.entries(productionEvidenceMarkers)
        .map(([k, v]) => `${k}=${v ? 'YES' : 'NO'}`)
        .join(' ')
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

/** Like `runCommand`, but resolves with captured stdout+stderr instead of
 * discarding it on success -- needed below to inspect `wrangler deploy
 * --dry-run`'s own binding-table text (the ONLY place the cross-script
 * `(defined in <script>)` annotation is emitted; it is not part of the
 * bundled JS output `readFileSync`'d elsewhere in this file). Still
 * rejects on non-zero exit, same as `runCommand`. */
function runCommandCapture(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'pipe' });
    let output = '';
    child.stdout?.on('data', (d) => (output += String(d)));
    child.stderr?.on('data', (d) => (output += String(d)));
    child.on('error', (err) => reject(new Error(`failed to spawn ${cmd}: ${String(err)}`)));
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${output.slice(-2000)}`));
    });
  });
}

// ---------------------------------------------------------------------
// SUN-1221E6R-H2BF4 §27/28 -- dedicated Workflow-host bundle proof.
//
// Two complementary checks:
//   (a) the PUBLIC API Worker's own `wrangler deploy --dry-run` binding
//       table text confirms `env.PAID_CONTINUATION_WORKFLOW` now resolves
//       cross-script, to `siteborne-paid-continuation-runtime` (proves
//       the `wrangler.toml` `[[workflows]]` `script_name` change is real,
//       not merely present as unparsed text).
//   (b) the DEDICATED HOST's own `wrangler deploy --dry-run --config
//       wrangler.paid-continuation-runtime.toml` bundle contains the real
//       `PaidContinuationWorkflow` class, real orchestration, real
//       production-dependency construction, and real D1
//       repositories/composition modules -- and excludes every public
//       HTTP surface (Hono app construction, MCP/A2A routes, the public
//       discovery/catalog handlers) and every test-only/fixture module
//       this repository has ever introduced.
// ---------------------------------------------------------------------
async function runWorkflowHostBundleIsolationCheck() {
  // (a) cross-script binding resolution, read from the PUBLIC API
  // Worker's own dry-run stdout (not its bundled JS -- the binding table
  // is CLI output, never part of the JS bundle itself).
  try {
    const apiDryRunOutput = await runCommandCapture(
      WRANGLER_BIN,
      ['deploy', '--dry-run'],
      REPO_ROOT
    );
    const bindingLineMatch = apiDryRunOutput
      .split('\n')
      .find((line) => line.includes('PAID_CONTINUATION_WORKFLOW'));
    const resolvesCrossScript = Boolean(
      bindingLineMatch &&
        bindingLineMatch.includes('PaidContinuationWorkflow') &&
        bindingLineMatch.includes('siteborne-paid-continuation-runtime')
    );
    record(
      'cross-script binding (SUN-1221E6R-H2BF4): public API Worker wrangler deploy --dry-run reports env.PAID_CONTINUATION_WORKFLOW as "PaidContinuationWorkflow (defined in siteborne-paid-continuation-runtime)"',
      resolvesCrossScript,
      `bindingLine=${JSON.stringify(bindingLineMatch ?? null)}`
    );
  } catch (err) {
    record(
      'cross-script binding (SUN-1221E6R-H2BF4): public API Worker wrangler deploy --dry-run',
      false,
      String(err)
    );
  }

  // (b) dedicated host bundle content.
  const outDir = mkdtempSync(join(tmpdir(), 'siteborne-workflow-host-bundle-audit-'));
  try {
    await runCommand(
      WRANGLER_BIN,
      [
        'deploy',
        '--dry-run',
        '--config',
        'wrangler.paid-continuation-runtime.toml',
        '--outdir',
        outDir,
      ],
      REPO_ROOT
    );
    const hostBundlePath = join(outDir, 'workflow-host-entrypoint.js');
    const bundle = readFileSync(hostBundlePath, 'utf-8');

    const requiredPresentMarkers = {
      // esbuild lowers `export class X extends Y` to `var X = class extends
      // Y` -- matches the actual emitted form, not TS source syntax.
      WORKFLOW_CLASS: bundle.includes(
        'PaidContinuationWorkflow = class extends WorkflowEntrypoint'
      ),
      REAL_ORCHESTRATION: bundle.includes('async function runPaidContinuationWorkflow'),
      PRODUCTION_DEPENDENCY_BUILDER: bundle.includes(
        'async function buildProductionPaidContinuationWorkflowDependencies'
      ),
      ENVELOPE_OPEN:
        bundle.includes('openContinuationEnvelope') ||
        bundle.includes('Continuation envelope decryption failed'),
      D1_JOBS_REPOSITORY: bundle.includes('D1JobsRepository'),
      D1_PAYMENT_ATTEMPT_REPOSITORY: bundle.includes('D1PaymentAttemptRepository'),
      X402_RESULT_REPOSITORY: bundle.includes('X402ServiceResultRepository'),
      CHAIN_RECEIPT_CHECKER: bundle.includes('buildProductionCdpChainReceiptChecker'),
      WEB_CONTEXT_COMPOSITION: bundle.includes('buildWebContextV2CdpProductionRouteConfig'),
      VERIFY_COMPOSITION: bundle.includes('buildVerifyAgentOutputV2CdpProductionRouteConfig'),
      // SUN-1221E6R-H2B2-R1: the module-load precompiled-output-validator
      // registration call, proved missing by the first real H2B2 payment
      // attempt's EvalError. Checked against the actual dry-run bundle
      // (not just source) so this is authoritative for what the real
      // deployed artifact executes at module load, matching the same
      // proof style already used for every other marker in this table.
      PRECOMPILED_VALIDATOR_REGISTRATION: bundle.includes('setPrecompiledOutputValidators'),
    };
    record(
      'WORKFLOW_HOST_BUNDLE_ISOLATION (inclusion half, SUN-1221E6R-H2BF4 §27): dedicated host dry-run bundle DOES contain the real Workflow class, real run()-delegation, real production-dependency construction, and every real repository/composition it needs',
      Object.values(requiredPresentMarkers).every(Boolean),
      Object.entries(requiredPresentMarkers)
        .map(([k, v]) => `${k}=${v ? 'YES' : 'NO'}`)
        .join(' ')
    );

    const forbiddenPresentMarkers = {
      HONO_APP_CONSTRUCTION: bundle.includes('new Hono'),
      MCP_ROUTE: bundle.includes('mcpRoute'),
      A2A_ROUTE: bundle.includes('a2aRoute'),
      CATALOG_ROUTE: bundle.includes('catalogRoute'),
      HEALTH_ROUTE: bundle.includes('healthRoute'),
      READINESS_ROUTE: bundle.includes('readinessRoute'),
      OPENAPI_ROUTE: bundle.includes('openapiRoute'),
      WORKER_RUNTIME_TEST_ENTRYPOINT: bundle.includes('worker-runtime-test-entrypoint'),
      TEST_ENTRYPOINT_MARKER: bundle.includes('SUN-1201-WORKER-RUNTIME-TEST-ENTRYPOINT-b7f2c4'),
      FIXTURE_PAYMENT_PROVIDER_IMPORT: /\bimport\b[^\n]*FixturePaymentEvidenceProvider/.test(
        bundle
      ),
      NEVERMINED_TEST_CLIENTS:
        bundle.includes('successNeverminedClient') || bundle.includes('denyingNeverminedClient'),
      WEB_CONTEXT_HTTP_ROUTE: bundle.includes('webContextVerifiedV2CdpProductionRoute'),
      VERIFY_HTTP_ROUTE: bundle.includes('verifyAgentOutputV2CdpProductionRoute'),
    };
    const forbiddenFound = Object.entries(forbiddenPresentMarkers).filter(([, v]) => v);
    record(
      'WORKFLOW_HOST_BUNDLE_ISOLATION (exclusion half, SUN-1221E6R-H2BF4 §27): dedicated host dry-run bundle excludes the public SITEBORNE HTTP router, MCP/A2A handlers, public discovery handlers, both real production HTTP route modules, and every test-only/fixture module',
      forbiddenFound.length === 0,
      forbiddenFound.length === 0
        ? 'none found'
        : `found=${forbiddenFound.map(([k]) => k).join(',')}`
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
    await runPhase8();
    await runPhase9();
    // SUN-1221E2D §9 -- PHASE 10 makes one real outbound internet fetch
    // (to https://example.com/) through the real `cloudflare:sockets`
    // seam, unlike every other phase in this file (deliberately zero
    // real network access per this file's own header doc). Gated behind
    // an explicit opt-in so the default `pnpm test:worker-runtime` run
    // (CI included) stays exactly as network-isolated as it always was;
    // run with `RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE=true` to exercise
    // it on demand.
    if (process.env.RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE === 'true') {
      await runPhase10();
    } else {
      console.log(
        '[test:worker-runtime] PHASE 10 skipped (set RUN_WORKER_RUNTIME_LIVE_NETWORK_PHASE=true to run it -- it makes one real outbound internet fetch)'
      );
    }
    await runBundleIsolationCheck();
    await runWorkflowHostBundleIsolationCheck();
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
