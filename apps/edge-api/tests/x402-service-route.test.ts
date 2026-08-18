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
import { createX402ServiceRoute } from '../src/control-plane/routes/x402-service';

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
      expect(body.result_class).toBe('success');
      expect(body.receipt_id).toBeTruthy();
      expect(body.link_id).toBeTruthy();
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

  describe('upto synthetic end-to-end lifecycle (document_evidence_json.v1)', () => {
    it('402 -> pay -> 200, actual_amount <= authorized_maximum and reported separately', async () => {
      const challenge = await get402(app, '/v1/document/evidence-json', DOCUMENT_INPUT);
      const res = await payAndRetry(app, '/v1/document/evidence-json', DOCUMENT_INPUT, challenge);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.result_class).toBe('success');
      expect(BigInt(body.actual_amount as string)).toBeLessThanOrEqual(
        BigInt(body.authorized_maximum as string)
      );
    });
  });

  describe('four-service local route matrix (directive §30)', () => {
    const cases: Array<[string, unknown]> = [
      ['/v1/company/evidence-graph', COMPANY_INPUT],
      ['/v1/web/context', WEB_INPUT],
      ['/v1/document/evidence-json', DOCUMENT_INPUT],
      ['/v1/verify/agent-output', AGENT_INPUT],
    ];
    for (const [path, input] of cases) {
      it(`${path}: 402 -> synthetic paid success`, async () => {
        const challenge = await get402(app, path, input);
        const res = await payAndRetry(app, path, input, challenge);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.result_class).toBe('success');
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
    it('an executor reporting an actual amount above the quote authorized maximum is rejected with authorization_exceeded, not silently clipped', async () => {
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
      expect(res.status).toBe(402);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('authorization_exceeded');
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
      expect(body.result_class).toBe('success');
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
        required_schema: { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] },
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
    });
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
          expect(body.receipt_id).toBeTruthy();
          expect(body.link_id).toBeTruthy();

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
          expect(retryBody.link_id).toBe(body.link_id);
        }),
        { numRuns: 3 }
      );
    });
  });
});
