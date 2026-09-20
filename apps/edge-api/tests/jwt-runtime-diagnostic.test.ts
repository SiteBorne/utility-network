/**
 * FIRST-PAID-VERIFY-JWT-RUNTIME-VS-BOUND-SECRET-DIAGNOSTIC-01 — same-invocation
 * local JWT controls: synthetic control, bound-credential shape, bound direct
 * mint, and the createAuthHeaders outcome, persisted only as closed-vocabulary
 * enums. Real SDK primitives, real CDP provider, real `HTTPFacilitatorClient`,
 * Miniflare D1; only `globalThis.fetch` is stubbed. No network, no real
 * credentials, no signature.
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { HTTPFacilitatorClient } from '@x402/core/server';
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
import {
  describeThrown,
  runJwtDiagnostic,
  sanitizeJwtDiagnostic,
  type JwtDiagnosticDeps,
} from '../src/control-plane/evidence/cdp-jwt-diagnostic';
import {
  buildRealJwtDiagnosticDeps,
  SYNTHETIC_CONTROL_KEY_ID,
  syntheticControlSecret,
} from '../src/control-plane/evidence/cdp-jwt-diagnostic-sdk';
import * as composition from '../src/control-plane/production/verify-agent-output-v2-cdp-composition';
import { verifyAgentOutputV2CdpProductionRoute } from '../src/control-plane/routes/production-verify-v2-cdp-route';
import { Hono } from 'hono';
import {
  classifyFailingSymbol,
  describeThrown,
  JWT_PATH_SYMBOLS,
} from '../src/control-plane/evidence/cdp-jwt-diagnostic';
import type { Env } from '../src/control-plane/config/env';

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
const WEB_INPUT = { target_url: 'https://acme.example/', retrieval_mode: 'direct' };
const SIGNATURE_MARKER = 'synthetic:jwt-diagnostic-test-signature-marker';
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

const BOUND_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const BOUND_SENTINEL_SECRET = 'SENTINEL-bound-credential-must-never-appear';

/** Runtime-generated throwaway Ed25519 pair in the SDK's 64-byte base64 form. */
function throwawayEd25519Secret(): string {
  const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }) as {
    d: string;
    x: string;
  };
  return Buffer.concat([Buffer.from(jwk.d, 'base64url'), Buffer.from(jwk.x, 'base64url')]).toString(
    'base64'
  );
}

const realDeps = buildRealJwtDiagnosticDeps();

function diagDeps(overrides: Partial<JwtDiagnosticDeps> = {}): JwtDiagnosticDeps {
  return { ...realDeps, ...overrides };
}

/** A real facilitator client whose auth-header factory behaves as instructed. */
function clientWith(authHeaders: () => Promise<unknown>): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient({
    url: 'https://facilitator.invalid/platform/v2/x402',
    createAuthHeaders: authHeaders as never,
  });
}
const goodHeaders = async () => ({
  verify: { Authorization: `Bearer ${FAKE_JWT}` },
  settle: { Authorization: `Bearer ${FAKE_JWT}` },
  supported: { Authorization: `Bearer ${FAKE_JWT}` },
});

describe('same-invocation JWT runtime-vs-bound diagnostic (pure)', () => {
  const okId = BOUND_ID;

  it('A: synthetic control PASSES with the real SDK primitive and makes 0 network calls', async () => {
    const fetchSpy = vi.fn(async () => new Response('x'));
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const d = await runJwtDiagnostic(
        { apiKeyId: okId, apiKeySecret: throwawayEd25519Secret() },
        realDeps
      );
      expect(d.synthetic_jwt_control).toBe('PASS');
      expect(d.synthetic_failure_class).toBe('NONE');
      expect(d.bound_direct_jwt_mint).toBe('PASS');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('B: a synthetic runtime failure is reported as a control FAIL with a closed shape', async () => {
    const d = await runJwtDiagnostic(
      { apiKeyId: okId, apiKeySecret: throwawayEd25519Secret() },
      diagDeps({
        createSyntheticAuthHeaders: async () => {
          throw new TypeError('crypto.subtle.importKey is not a function');
        },
      })
    );
    expect(d).toMatchObject({
      synthetic_jwt_control: 'FAIL',
      synthetic_thrown_value_class: 'TYPE_ERROR',
      synthetic_error_shape: 'NOT_A_FUNCTION',
      synthetic_failure_class: 'cdp_jwt_unknown_failure',
    });
    expect(JSON.stringify(d)).not.toContain('crypto.subtle');
  });

  it('C: a missing bound credential is reported without any value', async () => {
    const none = await runJwtDiagnostic({ apiKeyId: undefined, apiKeySecret: undefined }, realDeps);
    expect(none).toMatchObject({
      env_binding: 'NON_STRING',
      binding_present: 'NO',
      binding_algorithm: 'UNKNOWN',
      binding_format: 'UNKNOWN',
      bound_direct_jwt_mint: 'FAIL',
      bound_direct_failure_class: 'cdp_key_id_missing',
    });
    const empty = await runJwtDiagnostic({ apiKeyId: '', apiKeySecret: '' }, realDeps);
    expect(empty).toMatchObject({ env_binding: 'MISSING', binding_present: 'NO' });
  });

  it('D: outer format problems are classified by enum only', async () => {
    const ed = throwawayEd25519Secret();
    const quoted = await runJwtDiagnostic({ apiKeyId: okId, apiKeySecret: `"${ed}"` }, realDeps);
    expect(quoted).toMatchObject({
      binding_quoted: 'YES',
      binding_format: 'INVALID',
    });
    // Node's Buffer base64 decoder ignores stray quotes, so the SDK may still
    // mint locally: exactly the kind of runtime-dependent leniency the
    // worker-side diagnostic exists to expose. Format INVALID must still show.
    const padded = await runJwtDiagnostic({ apiKeyId: okId, apiKeySecret: `${ed}\n` }, realDeps);
    expect(padded.binding_whitespace).toBe('YES');
    const crlf = await runJwtDiagnostic({ apiKeyId: okId, apiKeySecret: `${ed}\r\n` }, realDeps);
    expect(crlf.binding_crlf).toBe('YES');
    const junk = await runJwtDiagnostic(
      { apiKeyId: okId, apiKeySecret: BOUND_SENTINEL_SECRET },
      realDeps
    );
    expect(junk).toMatchObject({
      binding_format: 'INVALID',
      bound_direct_failure_class: 'cdp_key_format_invalid',
    });
    expect(JSON.stringify(junk)).not.toContain(BOUND_SENTINEL_SECRET);
  });

  it('E/F: bound direct mint parse and signing failures are separated, with the failing target', async () => {
    const parse = await runJwtDiagnostic(
      { apiKeyId: okId, apiKeySecret: throwawayEd25519Secret() },
      diagDeps({
        mintJwt: async () => {
          throw new Error('Failed to generate Ed25519 JWT: Invalid keyData');
        },
      })
    );
    expect(parse).toMatchObject({
      bound_direct_jwt_mint: 'FAIL',
      bound_direct_failure_class: 'cdp_key_parse_failed',
      bound_direct_failing_target: 'VERIFY',
    });
    let n = 0;
    const sign = await runJwtDiagnostic(
      { apiKeyId: okId, apiKeySecret: throwawayEd25519Secret() },
      diagDeps({
        mintJwt: async () => {
          n += 1;
          if (n === 3) throw new Error('Failed to generate Ed25519 JWT: signing exploded');
          return 'discarded';
        },
      })
    );
    expect(sign).toMatchObject({
      bound_direct_failure_class: 'cdp_jwt_signing_failed',
      bound_direct_failing_target: 'SUPPORTED',
    });
  });

  it('G: bound direct mint PASSES for a valid Ed25519 credential; NOT_AVAILABLE without the helper', async () => {
    const pass = await runJwtDiagnostic(
      { apiKeyId: okId, apiKeySecret: throwawayEd25519Secret() },
      realDeps
    );
    expect(pass).toMatchObject({
      binding_algorithm: 'ED25519',
      binding_format: 'VALID',
      binding_quoted: 'NO',
      binding_whitespace: 'NO',
      binding_crlf: 'NO',
      bound_direct_jwt_mint: 'PASS',
      bound_direct_failure_class: 'NONE',
      bound_direct_failing_target: 'NONE',
    });
    const na = await runJwtDiagnostic(
      { apiKeyId: okId, apiKeySecret: throwawayEd25519Secret() },
      diagDeps({ mintJwt: undefined })
    );
    expect(na).toMatchObject({
      bound_direct_jwt_mint: 'NOT_AVAILABLE',
      bound_direct_failure_class: 'NOT_AVAILABLE',
    });
  });

  it('I/J: thrown-value classes: non-Error, ordinary Error with unknown message, DOMException-like', () => {
    expect(describeThrown('a string')).toMatchObject({ thrown_value_class: 'NON_ERROR_THROW' });
    expect(describeThrown(undefined)).toMatchObject({ thrown_value_class: 'NON_ERROR_THROW' });
    expect(describeThrown({ weird: BOUND_SENTINEL_SECRET })).toMatchObject({
      thrown_value_class: 'UNKNOWN',
    });
    const plain = describeThrown(new Error(`totally unrecognised ${BOUND_SENTINEL_SECRET}`));
    expect(plain).toEqual({
      thrown_value_class: 'ERROR',
      failure_class: 'cdp_jwt_unknown_failure',
      error_shape: 'OTHER',
      failing_symbol: 'NONE',
      failing_stage: 'NONE',
    });
    expect(describeThrown(new ReferenceError('Buffer is not defined'))).toMatchObject({
      thrown_value_class: 'REFERENCE_ERROR',
      error_shape: 'NOT_DEFINED',
    });
    const dom = Object.assign(new Error('nope'), { name: 'NotSupportedError' });
    expect(describeThrown(dom)).toMatchObject({
      thrown_value_class: 'DOM_EXCEPTION',
      error_shape: 'NOT_SUPPORTED',
    });
    expect(JSON.stringify(plain)).not.toContain(BOUND_SENTINEL_SECRET);
  });

  it('never yields a value outside the closed vocabulary', async () => {
    const d = await runJwtDiagnostic(
      { apiKeyId: okId, apiKeySecret: BOUND_SENTINEL_SECRET },
      realDeps
    );
    for (const v of Object.values(sanitizeJwtDiagnostic(d))) expect(v).toMatch(/^[A-Za-z0-9_]+$/);
    expect(Object.keys(sanitizeJwtDiagnostic(d))).toHaveLength(Object.keys(d).length);
  });

  it('the synthetic control key is the published RFC 8032 public test vector, not a SITEBORNE key', () => {
    expect(SYNTHETIC_CONTROL_KEY_ID).toContain('synthetic');
    expect(Buffer.from(syntheticControlSecret(), 'base64')).toHaveLength(64);
  });
});

describe('failing-symbol / stage classification (allow-listed enums only)', () => {
  it('A: an allow-listed symbol that is not a function maps to its stage', () => {
    for (const [msg, sym, stage] of [
      ['getRandomValues is not a function', 'getRandomValues', 'NONCE_GENERATION'],
      ['getRandomValues2 is not a function', 'getRandomValues', 'NONCE_GENERATION'],
      ['importJWK is not a function', 'importJWK', 'KEY_IMPORT'],
      ['(0 , jose.importPKCS8) is not a function', 'importPKCS8', 'KEY_IMPORT'],
      ['SignJWT is not a function', 'SignJWT', 'JWT_SIGNING'],
      ['Buffer.from is not a function', 'Buffer', 'KEY_TYPE_DETECTION'],
    ] as const) {
      const d = describeThrown(new TypeError(msg));
      expect(d).toMatchObject({
        failing_symbol: sym,
        failing_stage: stage,
        error_shape: 'NOT_A_FUNCTION',
      });
    }
  });

  it('B/C/D: unknown symbols, non-callable phrasing and other errors never echo text', () => {
    expect(classifyFailingSymbol('somethingSecret123 is not a function')).toBe('OTHER');
    expect(describeThrown(new TypeError('x is not iterable'))).toMatchObject({
      failing_symbol: 'NONE',
    });
    expect(describeThrown(new RangeError('bad'))).toMatchObject({ failing_symbol: 'NONE' });
    const d = describeThrown(new TypeError(`${BOUND_SENTINEL_SECRET} is not a function`));
    expect(JSON.stringify(d)).not.toContain(BOUND_SENTINEL_SECRET);
    expect(JWT_PATH_SYMBOLS).toContain(d.failing_symbol);
  });

  it('G/H: synthetic and bound failing at the same symbol => parity PASS; different => FAIL', async () => {
    const same = new TypeError('getRandomValues is not a function');
    const r1 = await runJwtDiagnostic(
      {
        apiKeyId: BOUND_ID,
        apiKeySecret: throwawayEd25519Secret(),
        authStageFailure: { thrown: same },
      },
      diagDeps({
        createSyntheticAuthHeaders: async () => {
          throw same;
        },
        mintJwt: async () => {
          throw same;
        },
      })
    );
    expect(r1).toMatchObject({
      synthetic_failing_symbol: 'getRandomValues',
      bound_direct_failing_symbol: 'getRandomValues',
      create_auth_headers_failing_symbol: 'getRandomValues',
      failure_stage_parity: 'PASS',
    });
    const r2 = await runJwtDiagnostic(
      { apiKeyId: BOUND_ID, apiKeySecret: throwawayEd25519Secret() },
      diagDeps({
        createSyntheticAuthHeaders: async () => {
          throw same;
        },
        mintJwt: async () => {
          throw new TypeError('importJWK is not a function');
        },
      })
    );
    expect(r2.failure_stage_parity).toBe('FAIL');
  });

  it('N: a fully successful path reports NONE and NOT_APPLICABLE parity', async () => {
    const r = await runJwtDiagnostic(
      { apiKeyId: BOUND_ID, apiKeySecret: throwawayEd25519Secret() },
      diagDeps()
    );
    expect(r).toMatchObject({
      synthetic_jwt_control: 'PASS',
      synthetic_failing_symbol: 'NONE',
      bound_direct_failing_stage: 'NONE',
      failure_stage_parity: 'NOT_APPLICABLE',
    });
  });
});

describe('diagnostic through the real CDP provider and audit trail (full stack)', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-jwt-diag-'));
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

  async function run(
    client: HTTPFacilitatorClient,
    fetchStub: FetchStub,
    diagnostic?: { apiKeyId: unknown; apiKeySecret: unknown; deps?: JwtDiagnosticDeps }
  ) {
    const cdp = await resolveProductionCdpEvidenceProvider(FULLY_AUTHORIZED, BINDINGS, {
      createFacilitatorClient: () => client,
      ...(diagnostic
        ? {
            jwtDiagnostic: {
              apiKeyId: diagnostic.apiKeyId,
              apiKeySecret: diagnostic.apiKeySecret,
              deps: diagnostic.deps ?? realDeps,
            },
          }
        : {}),
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
    const allFetches: string[] = [];
    const realFetch = globalThis.fetch;
    let res: Response;
    try {
      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith('https://facilitator.invalid/')) {
          allFetches.push(url);
          return realFetch(input as RequestInfo, init);
        }
        allFetches.push(url);
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
    return { res, bodyText, header, paymentId, allFetches };
  }

  async function auditRows(paymentId: string | undefined) {
    const rows = await db
      .prepare('SELECT event_type, details FROM audit_events WHERE details LIKE ?')
      .bind(`%${paymentId}%`)
      .all<{ event_type: string; details: string }>();
    return rows.results ?? [];
  }

  async function failedDetails(paymentId: string | undefined): Promise<Record<string, unknown>> {
    const rows = (await auditRows(paymentId)).filter(
      (r) => r.event_type === 'payment_verification_failed'
    );
    expect(rows).toHaveLength(1);
    return JSON.parse(rows[0]!.details) as Record<string, unknown>;
  }

  const boundEd = throwawayEd25519Secret();

  it('H: createAuthHeaders fails although the bound credential mints directly (wrapper/wiring class)', async () => {
    const client = clientWith(async () => {
      throw new Error('opaque wrapper failure'); // not an SDK message shape
    });
    const { res, paymentId, allFetches } = await run(client, async () => jsonResponse(200, {}), {
      apiKeyId: BOUND_ID,
      apiKeySecret: boundEd,
    });
    expect(res.status).toBe(402);
    expect(allFetches).toHaveLength(0); // no facilitator contact, and no diagnostic network
    const d = await failedDetails(paymentId);
    expect(d).toMatchObject({
      verification_subreason: 'facilitator_jwt_generation_failed',
      verification_jwt_subreason: 'cdp_jwt_unknown_failure',
      jwt_diag_synthetic_jwt_control: 'PASS',
      jwt_diag_binding_format: 'VALID',
      jwt_diag_binding_algorithm: 'ED25519',
      jwt_diag_bound_direct_jwt_mint: 'PASS',
      jwt_diag_create_auth_headers: 'FAIL',
      jwt_diag_thrown_value_class: 'ERROR',
      jwt_diag_create_auth_headers_error_shape: 'OTHER',
      jwt_diag_facilitator_contact_attempted: 'NO',
    });
  });

  it('I: a non-Error thrown by the auth-header code is distinguished safely', async () => {
    const client = clientWith(async () => {
      throw BOUND_SENTINEL_SECRET;
    });
    const { paymentId } = await run(client, async () => jsonResponse(200, {}), {
      apiKeyId: BOUND_ID,
      apiKeySecret: boundEd,
    });
    const d = await failedDetails(paymentId);
    expect(d).toMatchObject({
      verification_jwt_subreason: 'cdp_jwt_unknown_failure',
      jwt_diag_thrown_value_class: 'NON_ERROR_THROW',
      jwt_diag_create_auth_headers: 'FAIL',
    });
    expect(JSON.stringify(d)).not.toContain(BOUND_SENTINEL_SECRET);
  });

  it('symbol and stage enums survive the redactor into the durable audit row', async () => {
    const boom = new TypeError('getRandomValues is not a function');
    const client = clientWith(async () => {
      throw boom;
    });
    const { paymentId } = await run(client, async () => jsonResponse(200, {}), {
      apiKeyId: BOUND_ID,
      apiKeySecret: boundEd,
      deps: diagDeps({
        createSyntheticAuthHeaders: async () => {
          throw boom;
        },
        mintJwt: async () => {
          throw boom;
        },
      }),
    });
    const d = await failedDetails(paymentId);
    expect(d).toMatchObject({
      jwt_diag_synthetic_failing_symbol: 'getRandomValues',
      jwt_diag_synthetic_failing_stage: 'NONCE_GENERATION',
      jwt_diag_bound_direct_failing_symbol: 'getRandomValues',
      jwt_diag_create_auth_headers_failing_symbol: 'getRandomValues',
      jwt_diag_failure_stage_parity: 'PASS',
    });
    expect(JSON.stringify(d)).not.toContain('[REDACTED]');
  });

  it('B(full): synthetic control FAIL inside the same invocation is persisted', async () => {
    const client = clientWith(async () => {
      throw new Error('opaque');
    });
    const { paymentId } = await run(client, async () => jsonResponse(200, {}), {
      apiKeyId: BOUND_ID,
      apiKeySecret: boundEd,
      deps: diagDeps({
        createSyntheticAuthHeaders: async () => {
          throw new ReferenceError('Buffer is not defined');
        },
      }),
    });
    expect(await failedDetails(paymentId)).toMatchObject({
      jwt_diag_synthetic_jwt_control: 'FAIL',
      jwt_diag_synthetic_thrown_value_class: 'REFERENCE_ERROR',
      jwt_diag_synthetic_error_shape: 'NOT_DEFINED',
    });
  });

  it('K: createAuthHeaders PASSES and the facilitator layer becomes the next stage', async () => {
    const client = clientWith(goodHeaders);
    const { res, paymentId, allFetches } = await run(
      client,
      async () => jsonResponse(401, { message: BODY_LEAK }),
      { apiKeyId: BOUND_ID, apiKeySecret: boundEd }
    );
    expect(res.status).toBe(402);
    expect(allFetches).toHaveLength(1); // exactly the facilitator request; diagnostics add none
    const d = await failedDetails(paymentId);
    expect(d).toMatchObject({
      verification_subreason: 'facilitator_authentication_rejected',
      transport_status: 401,
      jwt_diag_create_auth_headers: 'PASS',
      jwt_diag_create_auth_headers_failure_class: 'NONE',
      jwt_diag_thrown_value_class: 'NONE',
      jwt_diag_facilitator_contact_attempted: 'YES',
      jwt_diag_synthetic_jwt_control: 'PASS',
    });
    expect(JSON.stringify(d)).not.toContain('facilitator-body-leak-marker');
  });

  it('K2: a facilitator answering isValid:false also carries the controls', async () => {
    const client = clientWith(goodHeaders);
    const { paymentId } = await run(
      client,
      async () =>
        jsonResponse(200, { isValid: false, invalidReason: 'invalid_exact_evm_payload_signature' }),
      { apiKeyId: BOUND_ID, apiKeySecret: boundEd }
    );
    expect(await failedDetails(paymentId)).toMatchObject({
      verification_subreason: 'facilitator_verify_invalid',
      jwt_diag_create_auth_headers: 'PASS',
      jwt_diag_facilitator_contact_attempted: 'YES',
    });
  });

  it('L: no credential, JWT, signature, header or thrown text reaches any audit row', async () => {
    const client = clientWith(async () => {
      throw new Error(`leaky ${BOUND_SENTINEL_SECRET} ${FAKE_JWT}`);
    });
    const { header, paymentId } = await run(client, async () => jsonResponse(200, {}), {
      apiKeyId: BOUND_ID,
      apiKeySecret: BOUND_SENTINEL_SECRET,
    });
    const serialized = JSON.stringify(await auditRows(paymentId));
    for (const forbidden of [
      header,
      SIGNATURE_MARKER,
      BOUND_SENTINEL_SECRET,
      BOUND_ID,
      FAKE_JWT,
      syntheticControlSecret(),
      'eyJhbGciOi',
      'Bearer',
      'Authorization',
      'PAYMENT-SIGNATURE',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain('jwt_diag_binding_format');
  });

  it('M: the local controls make 0 network calls even when every control fails', async () => {
    const client = clientWith(async () => {
      throw new Error('opaque');
    });
    const { allFetches } = await run(client, async () => jsonResponse(200, {}), {
      apiKeyId: BOUND_ID,
      apiKeySecret: BOUND_SENTINEL_SECRET,
      deps: diagDeps({
        createSyntheticAuthHeaders: async () => {
          throw new Error('opaque');
        },
      }),
    });
    expect(allFetches).toHaveLength(0);
  });

  it('N: the public 402 body is byte-identical with the diagnostic on or off', async () => {
    const failing = () =>
      clientWith(async () => {
        throw new Error('opaque');
      });
    const off = await run(failing(), async () => jsonResponse(200, {}));
    const on = await run(failing(), async () => jsonResponse(200, {}), {
      apiKeyId: BOUND_ID,
      apiKeySecret: boundEd,
    });
    expect(on.res.status).toBe(off.res.status);
    const strip = (t: string) => t.replace(/(qte|req|pay)_[0-9a-f]+/g, '$1_X');
    expect(strip(on.bodyText)).toBe(strip(off.bodyText));
    expect(on.bodyText).not.toContain('jwt_diag');
    expect(on.bodyText).not.toContain('facilitator_jwt_generation_failed');
  });

  it('diagnostic disabled: no jwt_diag fields are ever written', async () => {
    const client = clientWith(async () => {
      throw new Error('opaque');
    });
    const { paymentId } = await run(client, async () => jsonResponse(200, {}));
    const d = await failedDetails(paymentId);
    expect(Object.keys(d).filter((k) => k.startsWith('jwt_diag_'))).toEqual([]);
    expect(d.verification_subreason).toBe('facilitator_jwt_generation_failed');
  });
});

describe('diagnostic flag wiring', () => {
  it('the route forwards JWT_RUNTIME_DIAGNOSTIC_ENABLED to the composition, and only that flag', async () => {
    const spy = vi
      .spyOn(composition, 'buildVerifyAgentOutputV2CdpProductionRouteConfig')
      .mockResolvedValue({ unavailable: true, reason: 'stubbed' });
    const app = new Hono<{ Bindings: Env }>();
    app.all('/v2/verify/agent-output', verifyAgentOutputV2CdpProductionRoute);
    const env = {
      DB: {},
      PAID_ROUTES_ENABLED: 'true',
      PRODUCTION_ENABLED: 'true',
      VERIFY_V2_CDP_ROUTE_ENABLED: 'true',
      JWT_RUNTIME_DIAGNOSTIC_ENABLED: 'true',
      CDP_API_KEY_ID: 'x',
    } as unknown as Env;
    await app.request('/v2/verify/agent-output', { method: 'POST' }, env);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]![0]).toMatchObject({ JWT_RUNTIME_DIAGNOSTIC_ENABLED: 'true' });
    spy.mockRestore();
  });

  it('web-context and other compositions do not reference the diagnostic', () => {
    for (const f of [
      'production/web-context-v2-cdp-composition.ts',
      'production/company-evidence-graph-v2-cdp-composition.ts',
      'production/document-evidence-json-v2-cdp-composition.ts',
    ]) {
      const src = readFileSync(join(__dirname, '..', 'src', 'control-plane', f), 'utf8');
      expect(src).not.toContain('JWT_RUNTIME_DIAGNOSTIC');
    }
  });
});
