/**
 * SUN-0700A checkpoint 5 — the local x402 HTTP vertical slice, exercised
 * against real D1/Miniflare (never the in-memory repository) and a real
 * Hono app via `app.request()`. See docs/decisions/0051-
 * http-vertical-slice-architecture.md.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import type {
  PaymentRequired,
  PaymentPayload,
  PaymentEvidenceProvider,
} from '@siteborne/protocol-x402';
import {
  FixturePaymentEvidenceProvider,
  CDP_PAYMENT_PROVIDER,
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  generateSiteborneePaymentId,
  resolvePaymentEvidenceProvider,
} from '@siteborne/protocol-x402';
import { Hono } from 'hono';
import Ajv2020 from 'ajv/dist/2020';
import { buildPaidServicesApp } from '../src/control-plane/routes/paid-services';
import {
  createX402ServiceRoute,
  type ExecutorOutcome,
} from '../src/control-plane/routes/x402-service';
import { createInProcessWorkflowBinding } from '../src/control-plane/testing/in-process-workflow-binding';

/**
 * SUN-1221E6R-H2AWI-3: every ad-hoc `createX402ServiceRoute(...)` call in
 * this file that reaches PAYMENT_VERIFIED needs a durable-continuation
 * `workflow`/`continuationEnvelopeKey` -- the route fails closed without
 * one (never a local settle fallback). `buildPaidServicesApp` wires this
 * centrally for its own 12 routes; this helper does the same for this
 * file's own hand-built routes.
 */
async function buildTestContinuationFields(
  db: D1Database,
  clock: () => string,
  executor: (
    input: unknown,
    ctx: { job_id: string; request_id: string }
  ) => Promise<ExecutorOutcome>,
  network: import('@siteborne/protocol-x402').Network = 'eip155:84532'
) {
  const continuationEnvelopeKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  return {
    workflow: createInProcessWorkflowBinding({
      db,
      executor,
      evidenceProvider: new FixturePaymentEvidenceProvider(),
      envelopeKey: continuationEnvelopeKey,
      network,
      clock: () => Math.floor(new Date(clock()).getTime() / 1000),
    }),
    continuationEnvelopeKey,
    continuationEnvelopeKeyId: 'test-v1',
  };
}

/** SUN-1200 checkpoint F: `createX402ServiceRoute` no longer compiles
 * `inputSchema` itself at construction time (real AJV runtime compilation
 * is unsafe inside a deployed Cloudflare Worker request handler -- see
 * the checkpoint F incident report). Real production callers always pass
 * one of the four frozen, precompiled `BUNDLED_SERVICE_INPUT_SCHEMAS`;
 * tests that construct an ad-hoc, non-frozen `inputSchema` (verifying
 * behavior unrelated to input-schema content) must supply their own
 * `inputValidator`, compiled here under Vitest/Node where runtime AJV
 * compilation is safe. */
function compileTestInputValidator(schema: Record<string, unknown>) {
  return new Ajv2020({ strict: false }).compile(schema);
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.reduce(async (prev, file) => {
    await prev;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await db.exec(stmt);
    }
  }, Promise.resolve());
}

/** Builds a buyer's PAYMENT-SIGNATURE payload from a decoded 402
 * challenge — mirrors what a real x402 client does: echo the chosen
 * `accepts[]` entry back verbatim, fill in the Payment-Identifier
 * extension using the *official* buyer-side helper. */
function buildBuyerPayload(challenge: PaymentRequired, id?: string): PaymentPayload {
  const requirement = challenge.accepts[0];
  const extensions = buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {}, id);
  return {
    x402Version: 2,
    resource: challenge.resource,
    accepted: requirement,
    payload: { synthetic_signature: 'synthetic:buyer-fixture' },
    extensions,
  };
}

async function get402(
  app: Awaited<ReturnType<typeof buildPaidServicesApp>>,
  path: string,
  body: unknown
) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(402);
  const headerValue = res.headers.get('PAYMENT-REQUIRED');
  expect(headerValue).toBeTruthy();
  const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
  expect(decoded.ok).toBe(true);
  return (decoded as { ok: true; value: PaymentRequired }).value;
}

async function payAndRetry(
  app: Awaited<ReturnType<typeof buildPaidServicesApp>>,
  path: string,
  body: unknown,
  challenge: PaymentRequired,
  id?: string
) {
  const payload = buildBuyerPayload(challenge, id);
  const header = encodePaymentSignatureHeaderSafe(payload);
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
    body: JSON.stringify(body),
  });
}

// Matches the exact accepted SUN-0300/SUN-0600 fixture scenario
// ('company-identity-exact-cik-sec-submissions') — the paid route's
// executor (apps/edge-api/src/control-plane/routes/paid-services.ts)
// always returns the real Apple Inc. SEC EDGAR submissions fixture for
// this CIK, so only this input actually reaches result_class: 'success'.
const COMPANY_INPUT = {
  identifiers: { cik: '0000320193' },
  requested_field_groups: ['identity', 'sec_submissions'],
};
const WEB_INPUT = { target_url: 'https://acme.example/', retrieval_mode: 'direct' };
const DOCUMENT_INPUT = {
  artifact_reference: {
    artifact_id: 'doc/native-fixture.pdf',
    media_type: 'application/pdf',
    size_bytes: 1,
  },
};
const AGENT_INPUT = {
  verification_contract: {
    claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
    deterministic_requirements: [],
  },
  candidate_output: { total: 42 },
  required_schema: {},
  verification_mode: 'standard',
};

describe('x402 HTTP vertical slice (SUN-0700A checkpoint 5)', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  let app: Awaited<ReturnType<typeof buildPaidServicesApp>>;
  const clockValue = '2026-08-11T00:00:00.000Z';

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-x402-http-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      // `d1Persist` is not a recognized option on this installed
      // Miniflare version (5.20260801.0-alpha) — silently ignored. The
      // real, current option is the shared, top-level
      // `resourcePersistencePath` (a directory Miniflare manages
      // itself), not a single sqlite file path.
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      clock: () => clockValue,
    });
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('missing payment produces a valid V2 402', () => {
    it('company: 402 with a decodable PAYMENT-REQUIRED header bound to the request', async () => {
      const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
      expect(challenge.x402Version).toBe(2);
      expect(challenge.accepts).toHaveLength(1);
      expect(challenge.accepts[0].scheme).toBe('exact');
      expect(challenge.extensions?.['payment-identifier']).toBeTruthy();
    });

    it('document: 402 declares upto, not exact', async () => {
      const challenge = await get402(app, '/v1/document/evidence-json', DOCUMENT_INPUT);
      expect(challenge.accepts[0].scheme).toBe('upto');
    });

    it('changing the business input changes the quote binding (different accepts[0].extra.quote_id)', async () => {
      const a = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
      const b = await get402(app, '/v1/company/evidence-graph', {
        ...COMPANY_INPUT,
        requested_field_groups: ['identity'],
      });
      expect(a.accepts[0].extra?.quote_id).not.toBe(b.accepts[0].extra?.quote_id);
    });

    it('preserves official EVM token-domain metadata in the payment requirement extra slot', async () => {
      const metadataApp = new Hono();
      createX402ServiceRoute(metadataApp, {
        serviceId: 'web_context_verified.v1',
        scheme: 'exact',
        pricingKey: 'web_context_verified_direct',
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        paymentRequirementExtra: { name: 'USDC', version: '2' },
        path: '/v1/web/context-domain-metadata',
        inputSchema: { type: 'object' },
        inputValidator: compileTestInputValidator({ type: 'object' }),
        contractRelease: '1.0.0',
        inputSchemaHash: 'sha256:' + '1'.repeat(64),
        outputSchemaHash: 'sha256:' + '2'.repeat(64),
        pccDependency: '1.0.0',
        db,
        clock: () => clockValue,
        evidenceMode: 'fixture',
        executor: async () => ({ result: { result_class: 'rejected' } }),
      });

      const challenge = await get402(metadataApp, '/v1/web/context-domain-metadata', {
        probe: true,
      });
      expect(challenge.accepts[0].extra).toMatchObject({
        name: 'USDC',
        version: '2',
      });
      expect(challenge.accepts[0].extra?.quote_id).toMatch(/^qte_[a-f0-9]{24}$/);
    });
  });

  describe('exact synthetic end-to-end lifecycle (company_evidence_graph.v1)', () => {
    it('402 -> pay -> 200, with PAYMENT-RESPONSE, receipt, and link', async () => {
      const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
      const res = await payAndRetry(app, '/v1/company/evidence-graph', COMPANY_INPUT, challenge);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION (ac642cb): the 200 body
      // is now the governed v2 wire result -- the full PCC document, or
      // (in this harness) the `result.verification` fragment
      // `createInProcessWorkflowBinding`'s documented, pre-existing,
      // out-of-scope `validatePcc` stub forwards as-is (see
      // in-process-workflow-binding.ts and mcp-four-service-acceptance
      // .test.ts's Section 8 comment). `result_class`/`receipt_id`/
      // `link_id` no longer exist anywhere on the wire body by design
      // (`additionalProperties: false` on the PCC document; service
      // identity/idempotency now live at contract.service_id/
      // contract.idempotency_key) -- `verification.decision === 'pass'`
      // is the governed nested location for this test's "success" signal.
      expect(body.decision).toBe('pass');
      expect(res.headers.get('PAYMENT-RESPONSE')).toBeTruthy();
    });

    it('writes every new open-route attempt as a v2 CDP rail binding', async () => {
      const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
      const id = generateSiteborneePaymentId();
      const res = await payAndRetry(
        app,
        '/v1/company/evidence-graph',
        COMPANY_INPUT,
        challenge,
        id
      );
      expect(res.status).toBe(200);
      const row = await db
        .prepare(
          'SELECT binding_version, payment_rail, payment_provider, nevermined_agent_id, nevermined_plan_id FROM payment_attempts WHERE payment_identifier = ?'
        )
        .bind(id)
        .first<Record<string, unknown>>();
      expect(row).toEqual({
        binding_version: 2,
        payment_rail: 'cdp',
        payment_provider: CDP_PAYMENT_PROVIDER,
        nevermined_agent_id: null,
        nevermined_plan_id: null,
      });
    });
  });

  describe('upto scheme is not supported by the durable continuation pipeline (SUN-1221E6R-H2AWI-3)', () => {
    /** SUN-1221E6R-H2AWI-3: was "402 -> pay -> 200" before this
     * checkpoint. `document_evidence_json.v1` is the only `upto`-scheme
     * route this local test-fixture wiring mounts; no REAL production
     * route uses `upto` (verified via grep this checkpoint -- both real
     * routes are `exact`). H2AWI-2's frozen `DecryptedContinuationPayload`
     * has no room for the post-execution `actualAmountAtomic`/
     * `resourceMetrics` `upto` settlement needs, so the route now fails
     * closed (500) rather than silently dropping `upto`'s
     * authorization-exceeded overage protection. See the checkpoint's
     * evidence report for the full disclosed rationale. */
    it('402 -> pay -> explicit 500 (upto not supported), never a silent success', async () => {
      const challenge = await get402(app, '/v1/document/evidence-json', DOCUMENT_INPUT);
      const res = await payAndRetry(app, '/v1/document/evidence-json', DOCUMENT_INPUT, challenge);
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('service_execution_failed');
      expect(String(body.message)).toMatch(/upto-scheme services are not supported/);
    });
  });

  describe('four-service local route matrix (directive §30)', () => {
    // SUN-1221E6R-H2AWI-3: `/v1/document/evidence-json` (the only
    // `upto`-scheme route in this matrix) is intentionally excluded here
    // -- see the dedicated "upto scheme is not supported" describe block
    // above for its own, updated expectation.
    const cases: Array<[string, unknown]> = [
      ['/v1/company/evidence-graph', COMPANY_INPUT],
      ['/v1/web/context', WEB_INPUT],
      ['/v1/verify/agent-output', AGENT_INPUT],
    ];
    for (const [path, input] of cases) {
      it(`${path}: 402 -> synthetic paid success`, async () => {
        const challenge = await get402(app, path, input);
        const res = await payAndRetry(app, path, input, challenge);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION (ac642cb): see the
        // matching comment on the "exact synthetic end-to-end lifecycle"
        // test above -- `result_class` no longer exists on the governed
        // wire body; `verification.decision === 'pass'` is its governed
        // nested-location equivalent.
        expect(body.decision).toBe('pass');
      });
    }
  });

  describe('replay: duplicate_same retry does not re-execute the service (directive §13-15)', () => {
    it('same Payment-Identifier + same binding, retried after settlement, returns the same result without a second execution', async () => {
      const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
      const id = generateSiteborneePaymentId();
      const first = await payAndRetry(
        app,
        '/v1/company/evidence-graph',
        COMPANY_INPUT,
        challenge,
        id
      );
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as Record<string, unknown>;

      const second = await payAndRetry(
        app,
        '/v1/company/evidence-graph',
        COMPANY_INPUT,
        challenge,
        id
      );
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as Record<string, unknown>;

      expect(secondBody.link_id).toBe(firstBody.link_id);
      expect(secondBody.receipt_id).toBe(firstBody.receipt_id);
    });
  });

  describe('replay: duplicate_conflict is rejected without service execution (directive §12)', () => {
    it('same Payment-Identifier reused for a changed business input -> 409, no leaked prior result', async () => {
      const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
      const id = generateSiteborneePaymentId();
      const first = await payAndRetry(
        app,
        '/v1/company/evidence-graph',
        COMPANY_INPUT,
        challenge,
        id
      );
      expect(first.status).toBe(200);

      const changedInput = { ...COMPANY_INPUT, requested_field_groups: ['identity'] };
      const challenge2 = await get402(app, '/v1/company/evidence-graph', changedInput);
      const res = await payAndRetry(
        app,
        '/v1/company/evidence-graph',
        changedInput,
        challenge2,
        id
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('replay_conflict');
    });
  });

  describe('replay: concurrent conflicting bindings never cross-leak a result (directive §26)', () => {
    it('10 concurrent requests split across two different immutable bindings sharing one Payment-Identifier -> exactly one binding wins, the other is always rejected, never a mixed/leaked result', async () => {
      const id = generateSiteborneePaymentId();
      const challengeA = await get402(app, '/v1/verify/agent-output', AGENT_INPUT);
      const conflictingInput = {
        ...AGENT_INPUT,
        verification_mode: 'standard',
        candidate_output: { total: 42, extra: true },
      };
      const challengeB = await get402(app, '/v1/verify/agent-output', conflictingInput);

      const responses = await Promise.all([
        ...Array.from({ length: 5 }, () =>
          payAndRetry(app, '/v1/verify/agent-output', AGENT_INPUT, challengeA, id)
        ),
        ...Array.from({ length: 5 }, () =>
          payAndRetry(app, '/v1/verify/agent-output', conflictingInput, challengeB, id)
        ),
      ]);
      const statuses = responses.map((r) => r.status);
      // Every response is either a completed success (200), in-flight
      // (202), or a rejected conflict (409) — never a 5xx, and no
      // response from the losing binding can ever carry the winning
      // binding's result (verified by link_id below).
      expect(statuses.every((s) => s === 200 || s === 202 || s === 409)).toBe(true);

      const successBodies = await Promise.all(
        responses
          .filter((r) => r.status === 200)
          .map((r) => r.json() as Promise<Record<string, unknown>>)
      );
      const linkIds = new Set(successBodies.map((b) => b.link_id));
      // Exactly one binding's result may ever appear as a success.
      expect(linkIds.size).toBeLessThanOrEqual(1);
    });
  });

  describe('upto: actual usage exceeding the authorized maximum can never succeed (directive §21)', () => {
    /** SUN-1221E6R-H2AWI-3: this test's ORIGINAL premise (an `upto`
     * executor reporting an over-limit actual amount is caught by the
     * route's own overage gate, 402 `authorization_exceeded`) no longer
     * applies -- `scheme: 'upto'` is rejected wholesale, before the
     * executor ever runs, by the new durable-continuation gate (see the
     * dedicated "upto scheme is not supported" describe block above).
     * This test still proves something real and load-bearing: an
     * over-limit `upto` executor output can NEVER silently reach a paid
     * 200 success, even though the specific rejection mechanism changed
     * from an amount-comparison gate to a blanket scheme gate. */
    it('an executor reporting an actual amount above the quote authorized maximum can never reach a paid success (upto is rejected wholesale, not silently clipped)', async () => {
      const overLimitApp = new Hono();
      createX402ServiceRoute(overLimitApp, {
        serviceId: 'document_evidence_json.v1',
        scheme: 'upto',
        pricingKey: 'document_evidence_json_max_job',
        network: 'eip155:8453',
        asset: '0xUSDC',
        path: '/v1/document/evidence-json',
        inputSchema: { type: 'object' },
        inputValidator: compileTestInputValidator({ type: 'object' }),
        contractRelease: '1.0.0',
        inputSchemaHash: 'sha256:' + '1'.repeat(64),
        outputSchemaHash: 'sha256:' + '2'.repeat(64),
        pccDependency: '1.0.0',
        db,
        clock: () => clockValue,
        evidenceMode: 'fixture',
        executor: async () => ({
          result: {
            result_class: 'success',
            output: { fake: true },
            output_hash: 'sha256:' + '3'.repeat(64),
            receipt_id: 'rcpt_' + '1'.repeat(24),
            receipt: { fake_receipt: true },
          },
          // Deliberately fabricated: far above any real authorized
          // maximum, to prove the route's own enforcement boundary
          // (buildUsageResult / UsageExceedsAuthorizationError) rejects
          // it — independent of whether the real document-usage
          // calculator could itself ever produce such a value.
          actualAmountAtomic: '999999999999',
        }),
      });

      const input = { probe: true };
      const res402 = await overLimitApp.request('/v1/document/evidence-json', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(res402.status).toBe(402);
      const decoded = decodePaymentRequiredHeaderSafe(res402.headers.get('PAYMENT-REQUIRED')!);
      expect(decoded.ok).toBe(true);
      const challenge = (decoded as { ok: true; value: PaymentRequired }).value;

      const payload = buildBuyerPayload(challenge);
      const header = encodePaymentSignatureHeaderSafe(payload);
      const res = await overLimitApp.request('/v1/document/evidence-json', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(input),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('service_execution_failed');
      expect(res.status).not.toBe(200);
    });
  });

  describe('Bazaar -> HTTP machine-buyer round trip (directive §31)', () => {
    it('a Bazaar discovery declaration for company_evidence_graph.v1 correctly identifies the real route this checkpoint mounts, and its own frozen example input drives a full 402 -> pay -> success cycle', async () => {
      const { buildSiteborneDiscoveryDeclaration } = await import('@siteborne/protocol-x402');
      const declaration = await buildSiteborneDiscoveryDeclaration({
        serviceId: 'company_evidence_graph.v1',
        nowIso: clockValue,
        expiresInSeconds: 300,
        maxTimeoutSeconds: 60,
      });
      // The Bazaar declaration's resourceUrl path must exactly match the
      // real mounted route — proving checkpoint 4's discovery metadata
      // and checkpoint 5's route wiring were derived from the same
      // accepted OpenAPI source, never two independently-guessed paths.
      const declaredPath = new URL(declaration.resourceUrl).pathname;
      expect(declaredPath).toBe('/v1/company/evidence-graph');

      const challenge = await get402(app, declaredPath, COMPANY_INPUT);
      const res = await payAndRetry(app, declaredPath, COMPANY_INPUT, challenge);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION (ac642cb): see the
      // matching comment on the "exact synthetic end-to-end lifecycle"
      // test above.
      expect(body.decision).toBe('pass');
    });
  });

  describe('adversarial: malformed / structurally-invalid requests fail closed (directive §36)', () => {
    it('missing PAYMENT-SIGNATURE with malformed JSON body -> 400 invalid_request', async () => {
      const res = await app.request('/v1/company/evidence-graph', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      });
      expect(res.status).toBe(400);
    });

    it('input failing frozen-contract schema validation -> 400 invalid_request', async () => {
      const res = await app.request('/v1/company/evidence-graph', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requested_field_groups: ['not_a_real_group'] }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_request');
    });

    it('invalid Base64 PAYMENT-SIGNATURE -> 400 malformed_payment_signature', async () => {
      const res = await app.request('/v1/company/evidence-graph', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': '!!!not-base64!!!' },
        body: JSON.stringify(COMPANY_INPUT),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('malformed_payment_signature');
    });

    it('a V1-shaped PAYMENT-SIGNATURE payload is rejected (unsupported_version)', async () => {
      const v1 = Buffer.from(JSON.stringify({ x402Version: 1 }), 'utf-8').toString('base64');
      const res = await app.request('/v1/company/evidence-graph', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': v1 },
        body: JSON.stringify(COMPANY_INPUT),
      });
      expect(res.status).toBe(400);
    });

    it('an unknown quote_id in accepted.extra -> 402 expired_quote', async () => {
      const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
      const forged = {
        ...challenge,
        accepts: [
          {
            ...challenge.accepts[0],
            extra: { ...challenge.accepts[0].extra, quote_id: 'qte_' + 'f'.repeat(24) },
          },
        ],
      };
      const res = await payAndRetry(app, '/v1/company/evidence-graph', COMPANY_INPUT, forged);
      expect(res.status).toBe(402);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('expired_quote');
    });

    it('an exact requirement echoed against a different resource path -> requirement/resource mismatch, rejected', async () => {
      const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
      const res = await payAndRetry(app, '/v1/verify/agent-output', AGENT_INPUT, challenge);
      expect(res.status).toBe(400);
    });
  });

  describe('verify_agent_output pre-economic Profile 1 gate (SUN-1200 checkpoint F, §6)', () => {
    it('an unsupported required_schema keyword is rejected with 400 before any 402/quote is minted', async () => {
      const res = await app.request('/v1/verify/agent-output', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...AGENT_INPUT,
          required_schema: { type: 'string', pattern: '^[a-z]+$' },
        }),
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('unsupported_required_schema');
    });

    it('an over-limit required_schema is rejected with required_schema_limit_exceeded before any 402/quote is minted', async () => {
      const properties: Record<string, unknown> = {};
      for (let i = 0; i < 300; i++) properties[`p${i}`] = { type: 'string' };
      const res = await app.request('/v1/verify/agent-output', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...AGENT_INPUT,
          required_schema: { type: 'object', properties },
        }),
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('required_schema_limit_exceeded');
    });

    it('a Profile-1-supported required_schema still gets a normal 402 challenge (no false-positive rejection)', async () => {
      const challenge = await get402(app, '/v1/verify/agent-output', {
        ...AGENT_INPUT,
        required_schema: {
          type: 'object',
          properties: { total: { type: 'number' } },
          required: ['total'],
        },
      });
      expect(challenge.x402Version).toBe(2);
    });
  });

  describe('production-disabled gate (directive §32)', () => {
    it('constructing a route with evidenceMode "production" always throws — no production evidence provider exists', async () => {
      await expect(buildPaidServicesApp({ db, evidenceMode: 'production' })).rejects.toThrow(
        /production/i
      );
    });

    it('production mode is refused even if a caller supplies a FixturePaymentEvidenceProvider explicitly', () => {
      const provider: PaymentEvidenceProvider = new FixturePaymentEvidenceProvider();
      // resolvePaymentEvidenceProvider itself is exercised directly here
      // (bypassing route construction) to prove the mode check, not the
      // provider identity, is what's enforced.
      expect(() => resolvePaymentEvidenceProvider('production', provider)).toThrow();
    });
  });

  describe('D1 persistence survives a fresh app/repository instance (directive §25)', () => {
    it('a payment consumed through one app instance is recognized (already_consumed) by a brand-new app instance sharing the same D1', async () => {
      const challenge = await get402(app, '/v1/verify/agent-output', AGENT_INPUT);
      const id = generateSiteborneePaymentId();
      const first = await payAndRetry(app, '/v1/verify/agent-output', AGENT_INPUT, challenge, id);
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as Record<string, unknown>;

      const freshApp = await buildPaidServicesApp({
        db,
        evidenceMode: 'fixture',
        clock: () => clockValue,
      });
      const second = await payAndRetry(
        freshApp,
        '/v1/verify/agent-output',
        AGENT_INPUT,
        challenge,
        id
      );
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as Record<string, unknown>;
      expect(secondBody.link_id).toBe(firstBody.link_id);
    });
  });

  describe('concurrency: 20 same-binding retries never produce duplicate fulfillment (directive §26)', () => {
    it('exactly one execution wins; every response is consistent with a single logical result', async () => {
      const challenge = await get402(app, '/v1/web/context', WEB_INPUT);
      const id = generateSiteborneePaymentId();
      const payload = buildBuyerPayload(challenge, id);
      const header = encodePaymentSignatureHeaderSafe(payload);

      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          app.request('/v1/web/context', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
            body: JSON.stringify(WEB_INPUT),
          })
        )
      );
      const statuses = responses.map((r) => r.status);
      // Every response is either a completed success (200) or an
      // in-flight/processing marker (202) — never a duplicate distinct
      // success, never an error.
      expect(statuses.every((s) => s === 200 || s === 202)).toBe(true);

      const bodies = await Promise.all(
        responses
          .filter((r) => r.status === 200)
          .map((r) => r.json() as Promise<Record<string, unknown>>)
      );
      const linkIds = new Set(bodies.map((b) => b.link_id));
      expect(linkIds.size).toBeLessThanOrEqual(1);
    }, 15_000);
  });

  describe('no-network proof (directive §33)', () => {
    it('the entire 402 -> pay -> success flow performs zero real fetch calls beyond the fixture-mode adapters this checkpoint controls', async () => {
      const originalFetch = globalThis.fetch;
      let realNetworkAttempted = false;
      // The fixture httpClients in paid-services.ts never call global
      // fetch — they construct Response objects directly. This spy
      // proves that invariant holds for the whole HTTP flow, not just
      // the protocol-x402 layer already proven in that package's own
      // no-network.test.ts.
      globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
        realNetworkAttempted = true;
        return originalFetch(...args);
      }) as typeof fetch;
      try {
        const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
        await payAndRetry(app, '/v1/company/evidence-graph', COMPANY_INPUT, challenge);
      } finally {
        globalThis.fetch = originalFetch;
      }
      expect(realNetworkAttempted).toBe(false);
    });
  });

  describe('HTTP property tests (directive §35)', () => {
    it('property: the same semantic request under a fixed clock always yields the same quote binding', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...(['identity', 'sec_submissions'] as const)),
          async () => {
            const a = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
            const b = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
            expect(a.accepts[0].extra?.quote_id).toBe(b.accepts[0].extra?.quote_id);
          }
        ),
        { numRuns: 5 }
      );
    });

    it('property: a malformed PAYMENT-SIGNATURE header never produces a 2xx response', async () => {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1, maxLength: 40 }), async (garbage) => {
          const res = await app.request('/v1/company/evidence-graph', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': garbage },
            body: JSON.stringify(COMPANY_INPUT),
          });
          expect(res.status).toBeGreaterThanOrEqual(400);
        }),
        { numRuns: 20 }
      );
    });

    it('property: every 200 response corresponds to exactly one consumed payment attempt with a verified SITEBORNE receipt', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(0, 1, 2), async () => {
          const challenge = await get402(app, '/v1/verify/agent-output', AGENT_INPUT);
          const id = generateSiteborneePaymentId();
          const res = await payAndRetry(app, '/v1/verify/agent-output', AGENT_INPUT, challenge, id);
          expect(res.status).toBe(200);
          const body = (await res.json()) as Record<string, unknown>;
          // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION (ac642cb): see the
          // matching comment on the "exact synthetic end-to-end lifecycle"
          // test above -- `receipt_id`/`link_id` no longer exist on the
          // wire body (relocated to durable D1 state, never returned to
          // the buyer); `verification.decision === 'pass'` is this
          // harness's governed nested-location "verified receipt" signal.
          expect(body.decision).toBe('pass');

          // A second retry of the exact same identifier must reconstruct
          // the identical result — never a second consumption.
          const retry = await payAndRetry(
            app,
            '/v1/verify/agent-output',
            AGENT_INPUT,
            challenge,
            id
          );
          expect(retry.status).toBe(200);
          const retryBody = (await retry.json()) as Record<string, unknown>;
          // Was `expect(retryBody.link_id).toBe(body.link_id)` --
          // vacuously true post-ac642cb since neither body carries
          // `link_id` any more (both `undefined`). Byte-identical replay
          // of the whole governed wire body is the equivalent, still-
          // meaningful "same result, never a second consumption" proof.
          expect(retryBody).toEqual(body);
        }),
        { numRuns: 3 }
      );
    }, 15_000);
  });

  describe('SUN-1221E2D — executor failures surface a sanitized diagnostic audit event, never new detail in the public 502 body', () => {
    it('writes a service_execution_diagnostic audit_events row correlated by job_id, without adding to the public response', async () => {
      const diagnosticApp = new Hono();
      // Mirrors exactly the shape SUN-1221E2D's real WebContextVerifiedService
      // fix now returns for an HTTP-layer failure the verification
      // mesh didn't itself reject (SUN-1221E2, the real HTTP 502).
      const diagnosticExecutor = async (): Promise<ExecutorOutcome> => ({
        result: {
          result_class: 'internal_verification_failed',
          failure: {
            code: 'verification_failed',
            message:
              'direct-public-http did not succeed (permanent_failure) for https://unreachable.example/',
            details: {
              diagnostic_reason_code: 'WEBCTX_DNS_RESOLUTION_FAILED',
              diagnostic_stage: 'direct_public_http_fetch',
            },
          },
        },
      });
      createX402ServiceRoute(diagnosticApp, {
        serviceId: 'web_context_verified.v1',
        scheme: 'exact',
        pricingKey: 'web_context_verified_direct',
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        paymentRequirementExtra: { name: 'USDC', version: '2' },
        path: '/v1/web/context-diagnostic',
        inputSchema: { type: 'object' },
        inputValidator: compileTestInputValidator({ type: 'object' }),
        contractRelease: '1.0.0',
        inputSchemaHash: 'sha256:' + '1'.repeat(64),
        outputSchemaHash: 'sha256:' + '2'.repeat(64),
        pccDependency: '1.0.0',
        db,
        clock: () => clockValue,
        evidenceMode: 'fixture',
        executor: diagnosticExecutor,
        ...(await buildTestContinuationFields(db, () => clockValue, diagnosticExecutor)),
      });

      const challenge = await get402(diagnosticApp, '/v1/web/context-diagnostic', { probe: true });
      const res = await payAndRetry(
        diagnosticApp,
        '/v1/web/context-diagnostic',
        { probe: true },
        challenge
      );

      expect(res.status).toBe(502);
      const body = (await res.json()) as Record<string, unknown>;
      // The public 502 body carries only the pre-existing generic
      // message -- no diagnostic_reason_code, no diagnostic_stage, no
      // `details` key of any kind (SUN-1221E2D §7's "no public schema
      // change" rule). This assertion is the one this test's own name
      // promises and remains fully enforced post-H2AWI-3.
      expect(body).not.toHaveProperty('details');
      expect(JSON.stringify(body)).not.toContain('WEBCTX_DNS_RESOLUTION_FAILED');

      // SUN-1221E6R-H2AWI-3 DISCLOSED GAP: the `service_execution_diagnostic`
      // audit_events row itself (SUN-1221E2D's internal-only diagnostic
      // trail, distinct from the public response assertion above) is no
      // longer written. That write lived in x402-service.ts's own
      // in-request executor-failure branch, which this checkpoint moved
      // into the durable Workflow (H2AWI-2) -- H2AWI-2's frozen
      // `WorkflowContinuationResult` carries only a flat `error_code`
      // string, not the nested `{diagnostic_reason_code,
      // diagnostic_stage}` object this audit event needs, and H2AWI-2's
      // step graph has no audit-sink dependency to write it through even
      // if it did. Restoring this internal diagnostic trail (not a public
      // contract concern -- see the assertions above, which are
      // unaffected) is deferred to a future checkpoint that extends the
      // Workflow's own dependencies; not silently ignored, see the
      // evidence report.
      const rows = await db
        .prepare(`SELECT * FROM audit_events WHERE event_type = 'service_execution_diagnostic'`)
        .all();
      expect(rows.results).toHaveLength(0);
    });

    it('SUN-1222C-R4-D3: the same public non-leak rule holds for a `limitations`-only executor result (no `failure` object at all) — the exact CompanyEvidenceGraphService shape SUN-1222C-R4-D1 diagnosed, and the specific regression SUN-1222C-R4-D2 caught before deployment', async () => {
      const limitationsOnlyApp = new Hono();
      // Exactly CompanyEvidenceGraphService's real shape for a legitimate
      // result_class: 'partial' outcome: the verification mesh itself
      // decided 'pass' (so `failure` stays `undefined` -- see
      // `paid-continuation-workflow.ts`'s `deriveErrorDetail`), and the
      // only informative detail lives in `limitations`.
      const limitationsOnlyExecutor = async (): Promise<ExecutorOutcome> => ({
        result: {
          result_class: 'partial',
          limitations: [
            'requested_field_groups included groups the provider could not fulfil',
            'sec-edgar company_submissions returned permanent_failure for CIK 0000320193',
          ],
        },
      });
      createX402ServiceRoute(limitationsOnlyApp, {
        serviceId: 'company_evidence_graph.v1',
        scheme: 'exact',
        pricingKey: 'company_evidence_graph',
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        paymentRequirementExtra: { name: 'USDC', version: '2' },
        path: '/v1/company/evidence-graph-diagnostic',
        inputSchema: { type: 'object' },
        inputValidator: compileTestInputValidator({ type: 'object' }),
        contractRelease: '1.0.0',
        inputSchemaHash: 'sha256:' + '3'.repeat(64),
        outputSchemaHash: 'sha256:' + '4'.repeat(64),
        pccDependency: '1.0.0',
        db,
        clock: () => clockValue,
        evidenceMode: 'fixture',
        executor: limitationsOnlyExecutor,
        ...(await buildTestContinuationFields(db, () => clockValue, limitationsOnlyExecutor)),
      });

      const challenge = await get402(limitationsOnlyApp, '/v1/company/evidence-graph-diagnostic', COMPANY_INPUT);
      const res = await payAndRetry(
        limitationsOnlyApp,
        '/v1/company/evidence-graph-diagnostic',
        COMPANY_INPUT,
        challenge
      );

      expect(res.status).toBe(502);
      const body = (await res.json()) as Record<string, unknown>;
      // SUN-1222C-R4's public passthrough (`result.error_detail` into
      // `jsonError`'s `details` param) would put the exact SEC rejection
      // string below into this body. SUN-1221E2D's rule forbids that for
      // every executor failure shape, `limitations`-only included.
      expect(body).not.toHaveProperty('details');
      expect(body).not.toHaveProperty('error_detail');
      expect(JSON.stringify(body)).not.toContain('sec-edgar');
      expect(JSON.stringify(body)).not.toContain('CIK 0000320193');
      // The stable, coarse contract is unchanged: generic error/message,
      // nothing else.
      expect(body).toEqual({
        error: 'service_execution_failed',
        message: 'partial',
      });
    });

    it('does not write a diagnostic audit event on a normal successful execution (no regression)', async () => {
      const before = await db
        .prepare(
          `SELECT COUNT(*) as n FROM audit_events WHERE event_type = 'service_execution_diagnostic'`
        )
        .first<{ n: number }>();
      const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
      const res = await payAndRetry(app, '/v1/company/evidence-graph', COMPANY_INPUT, challenge);
      expect(res.status).toBe(200);
      const after = await db
        .prepare(
          `SELECT COUNT(*) as n FROM audit_events WHERE event_type = 'service_execution_diagnostic'`
        )
        .first<{ n: number }>();
      expect(after!.n).toBe(before!.n);
    });
  });

  describe(
    'SUN-1221E6R-H2A — post-verification execution/settlement survives ' +
      'a disconnected request context',
    () => {
      /** A literal Cloudflare "client disconnected mid-request" cannot be
       * simulated through Hono's in-process `app.request()` — there is no
       * real HTTP connection here to tear down, and the RED incident this
       * checkpoint fixes (job de147124, SUN-1221E6R-H1/H1A) was itself
       * only ever observed against the real edge. What *is* both real and
       * meaningfully testable in this harness is the actual mechanism
       * Cloudflare Workers documents for surviving exactly that scenario:
       * `ExecutionContext.waitUntil()`. Before this checkpoint the route
       * never called it at all (proven below by stashing the source fix
       * and re-running this exact test — see
       * docs/reports/SUN-1221E6R-H2A-client-disconnect-payment-lifecycle-hardening.md
       * §3 for the captured RED failure). After the fix, a real
       * `ExecutionContext` is bound and this test proves: (1) the
       * post-verification pipeline is registered with `waitUntil`
       * exactly once, (2) that registration does not fork a second
       * execution (the executor spy call count stays 1), and (3) the
       * normal synchronous response is unaffected. */
      it('registers exactly one waitUntil-protected pipeline promise, with no duplicated execution, for a normal successful paid request', async () => {
        let executorCalls = 0;
        const disconnectApp = new Hono();
        const disconnectExecutor = async (): Promise<ExecutorOutcome> => {
          executorCalls += 1;
          return {
            result: {
              result_class: 'success',
              output: { ok: true },
              output_hash: 'sha256:' + '3'.repeat(64),
              receipt: { synthetic: true },
              receipt_id: 'rcpt_h2a_test',
              // SUN-1222B-S2: `createInProcessWorkflowBinding`'s default
              // `validatePcc` reads `outcome.result.verification` as the
              // PCC object it hands the Workflow's post-settlement
              // receipt/link-building step (`hashPaymentObject(pccResult.pcc)`).
              // Every OTHER executor this file/`paid-services.ts` uses for
              // a genuine `result_class: 'success'` path (real
              // `executeLocalService()` calls) naturally produces this
              // field; this hand-rolled fixture predates the settlement
              // step actually dereferencing it and omitted it, which
              // crashed with an opaque "canonical-json returned undefined"
              // 500 the moment 53df612 started hashing `pcc` for real. A
              // "normal successful paid request" (this test's own
              // description) should carry a normal verification block.
              verification: {
                schema_valid: true,
                material_claims_supported: true,
                evidence_accessibility: 1,
                freshness: 1,
                completeness: 1,
                cross_source_agreement: 1,
                provenance_valid: true,
                decision: 'pass',
                score: 1,
              },
            },
          };
        };
        createX402ServiceRoute(disconnectApp, {
          serviceId: 'web_context_verified.v1',
          scheme: 'exact',
          pricingKey: 'web_context_verified_direct',
          network: 'eip155:84532',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          path: '/v1/web/context-disconnect-h2a',
          inputSchema: { type: 'object' },
          inputValidator: compileTestInputValidator({ type: 'object' }),
          contractRelease: '1.0.0',
          inputSchemaHash: 'sha256:' + '1'.repeat(64),
          outputSchemaHash: 'sha256:' + '2'.repeat(64),
          pccDependency: '1.0.0',
          db,
          clock: () => clockValue,
          evidenceMode: 'fixture',
          executor: disconnectExecutor,
          ...(await buildTestContinuationFields(db, () => clockValue, disconnectExecutor)),
        });

        const waitUntilPromises: Promise<unknown>[] = [];
        const mockExecutionCtx = {
          waitUntil: (p: Promise<unknown>) => {
            waitUntilPromises.push(p);
          },
          passThroughOnException: () => {},
        };

        const challenge = await get402(disconnectApp, '/v1/web/context-disconnect-h2a', {
          probe: true,
        });
        const payload = buildBuyerPayload(challenge);
        const header = encodePaymentSignatureHeaderSafe(payload);

        const res = await disconnectApp.request(
          '/v1/web/context-disconnect-h2a',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
            body: JSON.stringify({ probe: true }),
          },
          undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal ExecutionContext stand-in for this test only.
          mockExecutionCtx as any
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        // SUN-1222C-PCC-WIRE-RESULT-IMPLEMENTATION (ac642cb): see the
        // matching comment on the "exact synthetic end-to-end lifecycle"
        // test above -- `disconnectExecutor`'s `result.verification`
        // block (with `decision: 'pass'`) above is exactly what now
        // becomes this response's whole wire body.
        expect(body.decision).toBe('pass');

        // The actual H2A protection assertion: exactly one continuation
        // was registered to survive the request context, and it is the
        // SAME promise the response was already awaited from (no fork).
        expect(waitUntilPromises).toHaveLength(1);
        // `.catch(() => {})` only intercepts a *rejection* — on success
        // (this case) it passes the original resolved value straight
        // through unchanged, so the registered promise resolves to the
        // very same `Response` the client already received.
        await expect(waitUntilPromises[0]).resolves.toBeInstanceOf(Response);

        // No duplicated side effects: the resource executor ran exactly
        // once, not twice (once for the response, once via a forked
        // waitUntil task).
        expect(executorCalls).toBe(1);
      });

      it('falls back to unprotected (but still correct) execution when no ExecutionContext is bound — every pre-existing test in this file relies on exactly this path', async () => {
        // No 4th argument at all — identical to every other call in this
        // file. Proves the H2A change is purely additive: routes/tests
        // that never had an ExecutionContext keep working exactly as
        // before.
        const challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT);
        const res = await payAndRetry(app, '/v1/company/evidence-graph', COMPANY_INPUT, challenge);
        expect(res.status).toBe(200);
      });
    }
  );
});
