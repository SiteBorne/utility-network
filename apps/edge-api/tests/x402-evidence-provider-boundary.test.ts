/**
 * SUN-0700B checkpoint 1 preflight closure — HTTP-level regression proving
 * `createX402ServiceRoute` forwards the exact, already-structurally-
 * validated `PaymentPayload`/`PaymentRequirements` (and, for `upto`, the
 * post-execution `UsageResult`) through to the `PaymentEvidenceProvider`
 * boundary (directive §15-16), rather than a re-decoded or re-derived
 * copy. Runs against real D1/Miniflare, never the in-memory repository —
 * same discipline as x402-service-route.test.ts. No facilitator, no
 * network, no credential: the provider here is a local recording double.
 */
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import type {
  ExternalSettlementEvidence,
  ExternalVerificationEvidence,
  PaymentEvidenceProvider,
  PaymentRequired,
  PaymentSettlementContext,
  PaymentVerificationContext,
} from '@siteborne/protocol-x402';
import {
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  hashPaymentObject,
} from '@siteborne/protocol-x402';
import type { PaymentPayload } from '@siteborne/protocol-x402';
import { createX402ServiceRoute } from '../src/control-plane/routes/x402-service';
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

function buildBuyerPayload(challenge: PaymentRequired, id?: string): PaymentPayload {
  const requirement = challenge.accepts[0];
  const extensions = buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {}, id);
  return {
    x402Version: 2,
    resource: challenge.resource,
    accepted: requirement,
    payload: { synthetic_signature: 'synthetic:buyer-fixture-boundary-test' },
    extensions,
  };
}

/**
 * Records every `verify`/`settle` call it receives and returns
 * `synthetic_fixture`-trust-class evidence — deliberately still
 * `providerKind: 'external'` (so this test also exercises that a
 * fixture-mode route accepts an externally-kinded provider), but it is
 * itself only a local recorder: no network call, no facilitator, no
 * credential.
 */
class RecordingProvider implements PaymentEvidenceProvider {
  readonly providerKind = 'external' as const;
  verifyCalls: PaymentVerificationContext[] = [];
  settleCalls: { context: PaymentSettlementContext; actualAmount: string }[] = [];

  async verify(context: PaymentVerificationContext): Promise<ExternalVerificationEvidence> {
    this.verifyCalls.push(context);
    return {
      x402_version: 2,
      scheme: context.scheme,
      network: context.network,
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      verified: true,
      verifier_identity: 'synthetic:recording-provider',
      evidence_timestamp: context.nowIso,
      raw_evidence_hash: 'sha256:' + '1'.repeat(64),
      trust_class: 'synthetic_fixture',
    };
  }

  async settle(
    context: PaymentSettlementContext,
    verificationEvidence: ExternalVerificationEvidence,
    actualAmount: string
  ): Promise<ExternalSettlementEvidence> {
    this.settleCalls.push({ context, actualAmount });
    // Bound to the *actual* preceding verification evidence's hash, same
    // discipline FixturePaymentEvidenceProvider itself follows — settlement
    // must never be evaluated independently of a prior, accepted
    // verification (canAdvanceToSettled's 'verification_not_accepted' gate).
    const verificationEvidenceHash = await hashPaymentObject(verificationEvidence);
    return {
      x402_version: 2,
      scheme: context.scheme,
      network: context.network,
      asset: context.asset,
      payee: context.payee,
      actual_amount: actualAmount,
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      success: true,
      settled_at: context.nowIso,
      facilitator_identity: 'synthetic:recording-provider',
      raw_evidence_hash: 'sha256:' + '2'.repeat(64),
      verification_evidence_hash: verificationEvidenceHash,
      trust_class: 'synthetic_fixture',
    };
  }
}

describe('PaymentEvidenceProvider HTTP boundary wiring (SUN-0700B checkpoint 1 preflight closure)', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  const clockValue = '2026-08-11T00:00:00.000Z';

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-x402-evidence-boundary-'));
    const dbPath = join(tempDir, 'test.db');
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      d1Persist: dbPath,
    });
    db = await mf.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    // `jobs.service_id` carries a real FK to `services(id)` — seed the
    // four frozen services the same way buildPaidServicesApp always does
    // (this test mounts its own routes on a bare Hono app to inject a
    // recording provider, but must share the same seeded `db`).
    await buildPaidServicesApp({ db, evidenceMode: 'fixture', clock: () => clockValue });
  }, 30_000);

  afterAll(async () => {
    await mf.dispose();
  });

  it('exact scheme: verify() and settle() both receive the exact PaymentPayload and PaymentRequirements the buyer sent (directive §15)', async () => {
    const provider = new RecordingProvider();
    const app = new Hono();
    createX402ServiceRoute(app, {
      serviceId: 'company_evidence_graph.v1',
      scheme: 'exact',
      pricingKey: 'company_evidence_graph',
      network: 'eip155:8453',
      asset: '0xUSDC',
      path: '/v1/company/evidence-graph',
      inputSchema: { type: 'object' },
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      executor: async () => ({
        result: {
          result_class: 'success',
          output: { ok: true },
          output_hash: 'sha256:' + '3'.repeat(64),
          receipt_id: 'rcpt_' + '1'.repeat(24),
          receipt: { fake: true },
        },
      }),
    });

    const input = { probe: 'exact-boundary' };
    const res402 = await app.request('/v1/company/evidence-graph', {
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
    const res = await app.request('/v1/company/evidence-graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(200);

    expect(provider.verifyCalls).toHaveLength(1);
    expect(provider.settleCalls).toHaveLength(1);

    // Not the literal same JS object (the route decodes the header into a
    // fresh object) — but every field, including the buyer's accepted
    // requirement, must match exactly, and the payload actually carries
    // the buyer's own encoded content, never a server-reconstructed
    // approximation.
    const verifyCall = provider.verifyCalls[0]!;
    expect(verifyCall.paymentPayload.payload).toEqual({
      synthetic_signature: 'synthetic:buyer-fixture-boundary-test',
    });
    expect(verifyCall.paymentRequirements).toEqual(challenge.accepts[0]);
    expect(verifyCall.paymentRequirements).toEqual(verifyCall.paymentPayload.accepted);

    const settleCall = provider.settleCalls[0]!;
    expect(settleCall.context.paymentPayload).toEqual(verifyCall.paymentPayload);
    expect(settleCall.context.paymentRequirements).toEqual(verifyCall.paymentRequirements);
    expect(settleCall.context.usageResult).toBeUndefined();
    // exact scheme: actual amount always equals the quoted amount.
    expect(settleCall.actualAmount).toBe(challenge.accepts[0]!.amount);
  });

  it('upto scheme: settle() receives the original PaymentPayload/requirements plus the usage-result binding, with actual_amount kept separate from authorized_maximum (directive §16)', async () => {
    const provider = new RecordingProvider();
    const app = new Hono();
    const ACTUAL_AMOUNT = '4000';
    createX402ServiceRoute(app, {
      serviceId: 'document_evidence_json.v1',
      scheme: 'upto',
      pricingKey: 'document_evidence_json_max_job',
      network: 'eip155:8453',
      asset: '0xUSDC',
      path: '/v1/document/evidence-json',
      inputSchema: { type: 'object' },
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:' + '4'.repeat(64),
      outputSchemaHash: 'sha256:' + '5'.repeat(64),
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      executor: async () => ({
        result: {
          result_class: 'success',
          output: { ok: true },
          output_hash: 'sha256:' + '6'.repeat(64),
          receipt_id: 'rcpt_' + '2'.repeat(24),
          receipt: { fake: true },
        },
        actualAmountAtomic: ACTUAL_AMOUNT,
      }),
    });

    const input = { probe: 'upto-boundary' };
    const res402 = await app.request('/v1/document/evidence-json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(res402.status).toBe(402);
    const decoded = decodePaymentRequiredHeaderSafe(res402.headers.get('PAYMENT-REQUIRED')!);
    expect(decoded.ok).toBe(true);
    const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
    const authorizedMaximum = challenge.accepts[0]!.amount;
    expect(authorizedMaximum).not.toBe(ACTUAL_AMOUNT);

    const payload = buildBuyerPayload(challenge);
    const header = encodePaymentSignatureHeaderSafe(payload);
    const res = await app.request('/v1/document/evidence-json', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
      body: JSON.stringify(input),
    });
    expect(res.status).toBe(200);

    expect(provider.settleCalls).toHaveLength(1);
    const settleCall = provider.settleCalls[0]!;
    expect(settleCall.context.paymentPayload.accepted).toEqual(challenge.accepts[0]);
    expect(settleCall.context.usageResult).toBeDefined();
    expect(settleCall.context.usageResult!.actual_amount).toBe(ACTUAL_AMOUNT);
    expect(settleCall.context.usageResult!.authorized_maximum).toBe(authorizedMaximum);
    expect(settleCall.actualAmount).toBe(ACTUAL_AMOUNT);
    // The two must never be silently collapsed to the same value.
    expect(settleCall.actualAmount).not.toBe(settleCall.context.usageResult!.authorized_maximum);
  });
});
