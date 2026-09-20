/**
 * FIRST-PAID-VERIFY-FACILITATOR-SUBCLASSIFICATION-01 — the umbrella
 * `facilitator_verify_unavailable` must be separable into a precise, safe,
 * durable sub-cause, with the public 402 contract untouched and no secret or
 * payment material persisted.
 *
 * Full real stack (`buildPaidServicesApp`, Miniflare D1, real CDP provider)
 * driving the REAL `@x402/core` `HTTPFacilitatorClient` (and, for the JWT
 * case, the real `@coinbase/cdp-sdk` `createCdpFacilitatorClient` fed a
 * syntactically-invalid throwaway key string). Only `globalThis.fetch` is
 * stubbed, so the SDK's genuine error shapes are what gets classified.
 * No network, no real credentials, no signature.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
import {
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  type PaymentPayload,
  type PaymentRequired,
  type ProductionAuthorizationInput,
} from '@siteborne/protocol-x402';
import { resolveProductionCdpEvidenceProvider } from '../src/control-plane/config/production-payment';
import { buildPaidServicesApp } from '../src/control-plane/routes/paid-services';
import { classifyFacilitatorVerifyFailure } from '../src/control-plane/evidence/cdp-facilitator-failure';

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

const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const PAYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';
const WEB_INPUT = { target_url: 'https://acme.example/', retrieval_mode: 'direct' };
const SIGNATURE_MARKER = 'synthetic:subclassification-test-signature-marker';
const FAKE_KEY_ID = 'subclass-test-key-id';
const FAKE_KEY_SECRET = 'subclass-test-key-secret-not-a-key';
const FAKE_JWT = 'eyJhbGciOiJFUzI1NiJ9.fake-payload.fake-signature';
const BODY_LEAK = 'facilitator-body-leak-marker with Bearer eyJhbGciOi.secret';

const FULLY_AUTHORIZED: ProductionAuthorizationInput = {
  environment: 'production',
  productionEnabled: true,
  humanBootstrapAuthorized: true,
  productionCredentialsApproved: true,
};

const BINDINGS = {
  SELLER_WALLET_ADDRESS: SELLER,
  CDP_API_KEY_ID: FAKE_KEY_ID,
  CDP_API_KEY_SECRET: FAKE_KEY_SECRET,
};

type FetchStub = (url: string, init: RequestInit) => Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A real `HTTPFacilitatorClient` with a stub auth-header factory that never
 * touches a real key. */
function realClient(timeoutMs?: number): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: 'https://facilitator.invalid/platform/v2/x402',
    ...(timeoutMs ? { timeoutMs } : {}),
    createAuthHeaders: async () => ({
      verify: { Authorization: `Bearer ${FAKE_JWT}` },
      settle: { Authorization: `Bearer ${FAKE_JWT}` },
      supported: { Authorization: `Bearer ${FAKE_JWT}` },
    }),
  });
}

describe('facilitator verify failure subclassification', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-verify-subclass-'));
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function run(client: HTTPFacilitatorClient, fetchStub: FetchStub) {
    const cdp = await resolveProductionCdpEvidenceProvider(FULLY_AUTHORIZED, BINDINGS, {
      createFacilitatorClient: () => client,
    });
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: cdp.evidenceMode,
      evidenceProvider: cdp.evidenceProvider,
      productionAuthorization: FULLY_AUTHORIZED,
    });
    const first = await app.request('/v2/web/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(first.status).toBe(402);
    const decoded = decodePaymentRequiredHeaderSafe(first.headers.get('PAYMENT-REQUIRED')!);
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    const payload: PaymentPayload = {
      x402Version: 2,
      resource: challenge.resource,
      accepted: challenge.accepts[0]!,
      payload: { synthetic_signature: SIGNATURE_MARKER },
      extensions: buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {}),
    };
    const header = encodePaymentSignatureHeaderSafe(payload);
    const calls: { url: string; authorization: string | null }[] = [];
    const realFetch = globalThis.fetch;
    let res: Response;
    try {
      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith('https://facilitator.invalid/')) {
          return realFetch(input as RequestInfo, init);
        }
        calls.push({
          url,
          authorization: new Headers(init?.headers).get('authorization'),
        });
        return fetchStub(url, init ?? {});
      }) as typeof fetch;
      res = await app.request('/v2/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(WEB_INPUT),
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    const bodyText = await res.text();
    const paymentId = (payload.extensions as { 'payment-identifier'?: { info?: { id?: string } } })[
      'payment-identifier'
    ]?.info?.id;
    return { res, bodyText, header, paymentId, calls };
  }

  async function auditRows(paymentId: string | undefined, eventType?: string) {
    const rows = await db
      .prepare('SELECT event_type, details FROM audit_events WHERE details LIKE ?')
      .bind(`%${paymentId}%`)
      .all<{ event_type: string; details: string }>();
    return (rows.results ?? []).filter((r) => !eventType || r.event_type === eventType);
  }

  async function failedDetails(paymentId: string | undefined): Promise<Record<string, unknown>> {
    const rows = await auditRows(paymentId, 'payment_verification_failed');
    expect(rows).toHaveLength(1);
    return JSON.parse(rows[0]!.details) as Record<string, unknown>;
  }

  const UNAVAILABLE = {
    reason: 'verification_not_successful',
    verification_reason: 'facilitator_verify_unavailable',
    trust_class: 'external_unverified',
    verification_provider: 'cdp:facilitator',
  };

  it('A: JWT/auth-header construction failure (real CDP SDK client) -> jwt_generation_failed, no HTTP sent', async () => {
    const client = createCdpFacilitatorClient({
      apiKeyId: FAKE_KEY_ID,
      apiKeySecret: FAKE_KEY_SECRET, // syntactically invalid; generateJwt must reject it
    });
    const { res, paymentId, calls } = await run(client, async () => jsonResponse(200, {}));
    expect(res.status).toBe(402);
    expect(calls).toHaveLength(0);
    const d = await failedDetails(paymentId);
    expect(d).toMatchObject({
      ...UNAVAILABLE,
      verification_subreason: 'facilitator_jwt_generation_failed',
      verification_retryability: 'operator_action_required',
    });
    expect(d).not.toHaveProperty('transport_status');
  });

  it('B: HTTP 401 -> authentication_rejected + status', async () => {
    const { res, paymentId, calls } = await run(realClient(), async () =>
      jsonResponse(401, { errorType: 'unauthorized', errorMessage: BODY_LEAK })
    );
    expect(res.status).toBe(402);
    expect(calls).toHaveLength(1);
    expect(await failedDetails(paymentId)).toMatchObject({
      ...UNAVAILABLE,
      verification_subreason: 'facilitator_authentication_rejected',
      transport_status: 401,
      verification_retryability: 'operator_action_required',
    });
  });

  it('C: HTTP 403 -> authorization_rejected + status', async () => {
    const { paymentId } = await run(realClient(), async () =>
      jsonResponse(403, { message: BODY_LEAK })
    );
    expect(await failedDetails(paymentId)).toMatchObject({
      ...UNAVAILABLE,
      verification_subreason: 'facilitator_authorization_rejected',
      transport_status: 403,
    });
  });

  it('D: HTTP 400 without a verify body -> http_4xx', async () => {
    const { paymentId } = await run(realClient(), async () =>
      jsonResponse(400, { message: BODY_LEAK })
    );
    expect(await failedDetails(paymentId)).toMatchObject({
      ...UNAVAILABLE,
      verification_subreason: 'facilitator_http_4xx',
      transport_status: 400,
      verification_retryability: 'non_retryable',
    });
  });

  it('E: HTTP 429 -> rate_limited', async () => {
    const { paymentId } = await run(realClient(), async () => jsonResponse(429, 'slow down'));
    expect(await failedDetails(paymentId)).toMatchObject({
      ...UNAVAILABLE,
      verification_subreason: 'facilitator_rate_limited',
      transport_status: 429,
      verification_retryability: 'transient',
    });
  });

  it.each([500, 503])('F: HTTP %i -> http_5xx', async (status) => {
    const { paymentId } = await run(realClient(), async () =>
      jsonResponse(status, { message: BODY_LEAK })
    );
    expect(await failedDetails(paymentId)).toMatchObject({
      ...UNAVAILABLE,
      verification_subreason: 'facilitator_http_5xx',
      transport_status: status,
      verification_retryability: 'transient',
    });
  });

  it('G: connection/DNS failure -> network_unavailable, no status', async () => {
    const { paymentId } = await run(realClient(), async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error(BODY_LEAK), { code: 'ENOTFOUND' }),
      });
    });
    const d = await failedDetails(paymentId);
    expect(d).toMatchObject({
      ...UNAVAILABLE,
      verification_subreason: 'facilitator_network_unavailable',
      verification_retryability: 'transient',
    });
    expect(d).not.toHaveProperty('transport_status');
  });

  it('H: deadline exceeded (real SDK timeout) -> timeout', async () => {
    const { paymentId } = await run(
      realClient(25),
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'TimeoutError'))
          );
        })
    );
    expect(await failedDetails(paymentId)).toMatchObject({
      ...UNAVAILABLE,
      verification_subreason: 'facilitator_timeout',
      verification_retryability: 'transient',
    });
  });

  it.each([
    ['schema-invalid JSON', () => jsonResponse(200, { unexpected: BODY_LEAK })],
    ['non-JSON body', () => jsonResponse(200, `<html>${BODY_LEAK}</html>`)],
  ])('I: malformed 2xx facilitator response (%s) -> response_invalid', async (_n, make) => {
    const { paymentId } = await run(realClient(), async () => make());
    expect(await failedDetails(paymentId)).toMatchObject({
      ...UNAVAILABLE,
      verification_subreason: 'facilitator_response_invalid',
    });
  });

  it('J1: facilitator answers 200 isValid:false -> reachable; invalidReason kept apart from transport errors', async () => {
    const { res, paymentId } = await run(realClient(), async () =>
      jsonResponse(200, {
        isValid: false,
        invalidReason: 'invalid_exact_evm_payload_signature',
        invalidMessage: BODY_LEAK,
        payer: PAYER,
      })
    );
    expect(res.status).toBe(402);
    const d = await failedDetails(paymentId);
    expect(d).toMatchObject({
      reason: 'verification_not_successful',
      verification_reason: 'invalid_exact_evm_payload_signature',
      verification_subreason: 'facilitator_verify_invalid',
      trust_class: 'external_verified',
      verification_provider: 'cdp:facilitator',
      verification_retryability: 'non_retryable',
    });
    expect(d).not.toHaveProperty('transport_status');
  });

  it('J2: facilitator answers HTTP 400 with an isValid:false body -> verify_invalid + status', async () => {
    const { paymentId } = await run(realClient(), async () =>
      jsonResponse(400, {
        isValid: false,
        invalidReason: 'invalid_exact_evm_payload_signature',
        payer: PAYER,
      })
    );
    expect(await failedDetails(paymentId)).toMatchObject({
      verification_reason: 'invalid_exact_evm_payload_signature',
      verification_subreason: 'facilitator_verify_invalid',
      trust_class: 'external_verified',
      transport_status: 400,
    });
  });

  it('K: facilitator answers isValid:true -> no payment_verification_failed audit', async () => {
    const { paymentId } = await run(realClient(), async (url) =>
      url.endsWith('/verify')
        ? jsonResponse(200, { isValid: true, payer: PAYER })
        : jsonResponse(500, 'settle must not be reached in this test')
    );
    expect(await auditRows(paymentId, 'payment_verification_failed')).toHaveLength(0);
    expect(await auditRows(paymentId, 'payment_verification_requested')).toHaveLength(1);
  });

  it('L: no JWT, Authorization header, signature, key material or facilitator body reaches any audit row', async () => {
    const scenarios: FetchStub[] = [
      async () => jsonResponse(401, { message: BODY_LEAK }),
      async () => jsonResponse(500, BODY_LEAK),
      async () => {
        throw Object.assign(new TypeError(BODY_LEAK), { code: 'ECONNRESET' });
      },
      async () => jsonResponse(200, { junk: BODY_LEAK }),
    ];
    for (const stub of scenarios) {
      const { header, paymentId, calls } = await run(realClient(), stub);
      // The stub really did receive a bearer token; it must still not be persisted.
      expect(calls[0]?.authorization).toContain(FAKE_JWT);
      const serialized = JSON.stringify(await auditRows(paymentId));
      expect(serialized.length).toBeGreaterThan(0);
      for (const forbidden of [
        header,
        SIGNATURE_MARKER,
        FAKE_KEY_ID,
        FAKE_KEY_SECRET,
        FAKE_JWT,
        'eyJhbGciOi',
        'Bearer',
        'Authorization',
        'PAYMENT-SIGNATURE',
        'BODY_LEAK',
        'facilitator-body-leak-marker',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });

  it('M: public 402 body is identical for every failure class and reveals no sub-cause', async () => {
    const bodies: string[] = [];
    for (const stub of [
      async () => jsonResponse(401, {}),
      async () => jsonResponse(503, {}),
      async () =>
        jsonResponse(200, { isValid: false, invalidReason: 'invalid_exact_evm_payload_signature' }),
      async () => {
        throw new TypeError('fetch failed');
      },
    ] as FetchStub[]) {
      const { res, bodyText } = await run(realClient(), stub);
      expect(res.status).toBe(402);
      bodies.push(bodyText);
    }
    for (const b of bodies) {
      expect(b).toContain('payment_verification_rejected');
      expect(b).toContain('verification_not_successful');
      expect(b).not.toMatch(/facilitator_|401|503|invalid_exact_evm|transport_status|retryab/);
    }
  });

  describe('classifier unit table (pure)', () => {
    it.each([
      [Object.assign(new Error('x'), { name: 'FacilitatorTimeoutError' }), 'facilitator_timeout'],
      [
        new Error('Facilitator verify failed (401): anything'),
        'facilitator_authentication_rejected',
      ],
      [new Error('Facilitator verify failed (502): anything'), 'facilitator_http_5xx'],
      [new Error('Facilitator verify failed (999): anything'), 'facilitator_unknown_error'],
      [new Error('something else entirely'), 'facilitator_unknown_error'],
      ['not even an error', 'facilitator_unknown_error'],
      [null, 'facilitator_unknown_error'],
    ])('%#', (error, expected) => {
      expect(classifyFacilitatorVerifyFailure(error).subreason).toBe(expected);
    });

    it('never returns any part of the error message', () => {
      const out = classifyFacilitatorVerifyFailure(
        new Error(`Facilitator verify failed (401): ${BODY_LEAK}`)
      );
      expect(JSON.stringify(out)).not.toContain('leak');
      expect(Object.keys(out).sort()).toEqual(['retryability', 'subreason', 'transport_status']);
    });
  });
});
