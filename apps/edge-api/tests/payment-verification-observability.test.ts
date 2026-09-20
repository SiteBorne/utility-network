/**
 * FIRST-PAID-VERIFY-REJECTION-OBSERVABILITY-01 — a failed facilitator
 * verification must leave a durable, safe, classifiable audit reason
 * (distinguishing "facilitator answered isValid:false" from "facilitator
 * unavailable / unauthenticated") without changing the public 402 contract
 * and without persisting any payment material. Full real stack
 * (`buildPaidServicesApp`, real Miniflare D1, real CDP provider) with the
 * facilitator client injected as a deterministic double; no network.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import type { HTTPFacilitatorClient } from '@x402/core/server';
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
const SIGNATURE_MARKER = 'synthetic:observability-test-signature-marker';
const SECRET_KEY_ID = 'obs-test-key-id';
const SECRET_KEY_SECRET = 'obs-test-key-secret';
const FREE_FORM = 'internal detail with PAYMENT-SIGNATURE and bearer eyJhbGciOi.secret';

const FULLY_AUTHORIZED: ProductionAuthorizationInput = {
  environment: 'production',
  productionEnabled: true,
  humanBootstrapAuthorized: true,
  productionCredentialsApproved: true,
};

const BINDINGS = {
  SELLER_WALLET_ADDRESS: SELLER,
  CDP_API_KEY_ID: SECRET_KEY_ID,
  CDP_API_KEY_SECRET: SECRET_KEY_SECRET,
};

function facilitator(verify: () => Promise<unknown>): {
  client: HTTPFacilitatorClient;
  calls: { settle: number };
} {
  const calls = { settle: 0 };
  const client = {
    verify,
    async settle() {
      calls.settle += 1;
      throw new Error('settle must not be reached in a rejected verification');
    },
    async getSupported() {
      return { kinds: [], extensions: [], signers: {} };
    },
  } as unknown as HTTPFacilitatorClient;
  return { client, calls };
}

describe('payment_verification_failed safe observability', () => {
  let mf: Miniflare;
  let db: D1Database;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-verify-observability-'));
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

  async function run(verify: () => Promise<unknown>) {
    const { client, calls } = facilitator(verify);
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
    const res = await app.request('/v2/web/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
      body: JSON.stringify(WEB_INPUT),
    });
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

  it('CASE 1: facilitator isValid:false with a normalized reason is persisted safely', async () => {
    const { res, paymentId } = await run(async () => ({
      isValid: false,
      invalidReason: 'invalid_exact_evm_payload_signature',
      payer: PAYER,
    }));
    expect(res.status).toBe(402);
    const rows = await auditRows(paymentId, 'payment_verification_failed');
    expect(rows).toHaveLength(1);
    const details = JSON.parse(rows[0]!.details) as Record<string, unknown>;
    expect(details).toMatchObject({
      reason: 'verification_not_successful',
      verification_reason: 'invalid_exact_evm_payload_signature',
      trust_class: 'external_verified',
      verification_provider: 'cdp:facilitator',
    });
  });

  it('CASE 2: facilitator request throws -> facilitator_verify_unavailable / external_unverified', async () => {
    const { res, paymentId } = await run(async () => {
      throw new Error(FREE_FORM);
    });
    expect(res.status).toBe(402);
    const rows = await auditRows(paymentId, 'payment_verification_failed');
    expect(rows).toHaveLength(1);
    const details = JSON.parse(rows[0]!.details) as Record<string, unknown>;
    expect(details).toMatchObject({
      reason: 'verification_not_successful',
      verification_reason: 'facilitator_verify_unavailable',
      trust_class: 'external_unverified',
      verification_provider: 'cdp:facilitator',
    });
  });

  it('CASE 2b: facilitator HTTP auth failure without a machine code is still classed unavailable', async () => {
    const { paymentId } = await run(async () => {
      throw Object.assign(new Error(FREE_FORM), { statusCode: 401 });
    });
    const rows = await auditRows(paymentId, 'payment_verification_failed');
    const details = JSON.parse(rows[0]!.details) as Record<string, unknown>;
    expect(details.verification_reason).toBe('facilitator_verify_unavailable');
    expect(details.trust_class).toBe('external_unverified');
  });

  it('CASE 3: facilitator success creates no payment_verification_failed audit', async () => {
    const { paymentId } = await run(async () => ({ isValid: true, payer: PAYER }));
    const failed = await auditRows(paymentId, 'payment_verification_failed');
    expect(failed).toHaveLength(0);
    const requested = await auditRows(paymentId, 'payment_verification_requested');
    expect(requested).toHaveLength(1);
  });

  it('CASE 4: no payment signature, credentials, or free-form facilitator text is persisted', async () => {
    const { header, paymentId } = await run(async () => {
      throw Object.assign(new Error(FREE_FORM), { statusCode: 500 });
    });
    const rows = await auditRows(paymentId);
    expect(rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(rows);
    for (const forbidden of [
      header,
      SIGNATURE_MARKER,
      SECRET_KEY_ID,
      SECRET_KEY_SECRET,
      'PAYMENT-SIGNATURE',
      'eyJhbGciOi',
      FREE_FORM,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('CASE 5: public 402 contract is unchanged', async () => {
    const { res, bodyText } = await run(async () => ({
      isValid: false,
      invalidReason: 'invalid_exact_evm_payload_signature',
    }));
    expect(res.status).toBe(402);
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    expect(JSON.stringify(body)).toContain('payment_verification_rejected');
    expect(JSON.stringify(body)).toContain('verification_not_successful');
    // The precise internal reason must not leak into the public response.
    expect(bodyText).not.toContain('invalid_exact_evm_payload_signature');
    expect(bodyText).not.toContain('facilitator_verify_unavailable');
  });
});
