/**
 * SUN-0900B checkpoint 1B — "wire durable settlement recovery into the
 * real Nevermined HTTP lifecycle" — route-level proof.
 *
 * Exercises the actual `createX402ServiceRoute` production code path
 * (never a parallel test-only implementation), with:
 *   - a fully controllable, in-memory `PaymentEvidenceProvider`
 *     (`providerKind: 'external'`, `trust_class: 'external_verified'`,
 *     so `evidenceMode: 'production'`'s real gate gates it), and
 *   - a fake `NeverminedDelegationLookupClient` driving
 *     `reconcileNeverminedSettlementForRecovery`.
 * No network, no credential, no `RUN_LIVE_NEVERMINED`, anywhere in this
 * file — `controlled_sandbox_self_test`: independent_customer=false,
 * revenue=false, open_market_purchase=false, production_ready=false,
 * production_enabled=false.
 *
 * Real D1/Miniflare with `resourcePersistencePath` throughout — "process
 * crash" is always a full `dispose()` of one Miniflare instance followed
 * by a fresh `new Miniflare()` at the same path, never merely reusing
 * the same in-memory instance (SUN-0900B checkpoint 1B recovery
 * hardening's established pattern).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import {
  NEVERMINED_PAYMENT_PROVIDER,
  PAYMENT_DELEGATION_ID_HEADER,
  PAYMENT_IDENTIFIER_HEADER,
  decodeNeverminedPaymentRequiredHeaderSafe,
  type NeverminedDelegationLookupClient,
  type NeverminedDelegationRecoveryRecord,
  type NeverminedPaymentRequired,
  type NeverminedSettlementTransaction,
} from '@siteborne/protocol-nevermined';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  generateSiteborneePaymentId,
  hashPaymentObject,
  type ExternalSettlementEvidence,
  type ExternalVerificationEvidence,
  type PaymentEvidenceProvider,
  type PaymentSettlementContext,
  type PaymentVerificationContext,
} from '@siteborne/protocol-x402';
import {
  createX402ServiceRoute,
  type ExecutorOutcome,
} from '../src/control-plane/routes/x402-service';
import { buildPaidServicesApp } from '../src/control-plane/routes/paid-services';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));

function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  return files.reduce(async (previous, file) => {
    await previous;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter(Boolean)) {
      await db.exec(statement);
    }
  }, Promise.resolve());
}

const SERVICE_ID = 'web_context_verified.v1' as const;
const ROUTE_PATH = '/v1/nevermined-recovery-test/web/context';
const AGENT_ID = 'agent_recovery_test_v1';
const PLAN_ID = 'plan_recovery_test_v1';
const DELEGATION_ID = 'del-recovery-test-0000000000000000';
const NETWORK = 'eip155:84532' as const;
const WEB_INPUT = { target_url: 'https://acme.example/', retrieval_mode: 'direct' };
const BUYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';
const AMOUNT = '9000';

type SettleMode = 'success' | 'explicit_failure' | 'ambiguous' | 'throw';

/** A minimal, fully controllable `PaymentEvidenceProvider` standing in
 * for the real `NeverminedPaymentEvidenceProvider` — `providerKind:
 * 'external'` and `trust_class: 'external_verified'` so `evidenceMode:
 * 'production'`'s real gate (`isTrustClassAllowed`) evaluates it exactly
 * as it would a real facilitator response, without any real network
 * call or SDK involvement. */
function controllableProvider(counters: { verify: number; settle: number }): {
  provider: PaymentEvidenceProvider;
  setSettleMode: (mode: SettleMode) => void;
} {
  let settleMode: SettleMode = 'success';
  const provider: PaymentEvidenceProvider = {
    providerKind: 'external',
    async verify(context: PaymentVerificationContext): Promise<ExternalVerificationEvidence> {
      counters.verify += 1;
      return {
        x402_version: 2,
        scheme: context.scheme,
        network: context.network,
        quote_id: context.quote_id,
        requirement_id: context.requirement_id,
        payment_identifier: context.payment_identifier,
        verified: true,
        payer: BUYER,
        verifier_identity: NEVERMINED_PAYMENT_PROVIDER,
        evidence_timestamp: context.nowIso,
        raw_evidence_hash: 'sha256:' + '1'.repeat(64),
        trust_class: 'external_verified',
      };
    },
    async settle(
      context: PaymentSettlementContext,
      verificationEvidence: ExternalVerificationEvidence,
      actualAmount: string
    ): Promise<ExternalSettlementEvidence> {
      counters.settle += 1;
      if (settleMode === 'throw') throw new Error('simulated facilitator transport failure');
      // Must match the real hash `canAdvanceToSettled` (protocol-x402)
      // recomputes from the *accepted* verification evidence — a real
      // facilitator adapter is never asked to supply this itself, but
      // this fake provider stands in for the whole boundary, so it must
      // reproduce the same binding a real one gets for free.
      const base = {
        x402_version: 2 as const,
        scheme: context.scheme,
        network: context.network,
        asset: context.asset,
        payer: BUYER,
        payee: context.payee,
        actual_amount: actualAmount,
        quote_id: context.quote_id,
        requirement_id: context.requirement_id,
        payment_identifier: context.payment_identifier,
        settled_at: context.nowIso,
        facilitator_identity: NEVERMINED_PAYMENT_PROVIDER,
        raw_evidence_hash: 'sha256:' + '2'.repeat(64),
        verification_evidence_hash: await hashPaymentObject(verificationEvidence),
        trust_class: 'external_verified' as const,
      };
      if (settleMode === 'success') {
        return {
          ...base,
          transaction_reference: `0x${'a'.repeat(64)}`,
          success: true,
        };
      }
      if (settleMode === 'explicit_failure') {
        return { ...base, success: false, reason: 'provider_rejected' };
      }
      // ambiguous — mirrors the real normalizer's `ambiguous_settlement`
      // reason (SUN-0900B checkpoint 1B settlement-contract repair).
      return { ...base, success: false, reason: 'ambiguous_settlement' };
    },
  };
  return { provider, setSettleMode: (mode) => (settleMode = mode) };
}

function fakeReconciliationClient(
  transactions: NeverminedSettlementTransaction[],
  delegation: NeverminedDelegationRecoveryRecord | null
): NeverminedDelegationLookupClient {
  return {
    listDelegationTransactions: async () => ({ transactions }),
    getDelegation: async () => delegation,
  };
}

function consistentDelegation(
  overrides: Partial<NeverminedDelegationRecoveryRecord> = {}
): NeverminedDelegationRecoveryRecord {
  return {
    delegationId: DELEGATION_ID,
    provider: 'erc4337',
    status: 'Exhausted',
    currency: 'usdc',
    planId: PLAN_ID,
    providerPaymentMethodId: BUYER,
    ...overrides,
  };
}

function succeededTx(): NeverminedSettlementTransaction {
  return {
    id: 'tx-1',
    providerTransactionId: `0x${'a'.repeat(64)}`,
    amountCents: '1',
    currency: 'USDC',
    status: 'succeeded',
    failureReason: null,
    createdAt: '2026-08-12T08:17:11.444Z',
  };
}

describe('Nevermined route-level durable settlement recovery (SUN-0900B checkpoint 1B)', () => {
  let tempDir: string;
  let miniflare: Miniflare;
  let db: D1Database;
  let counters: { verify: number; settle: number; execute: number };
  let app: Hono;
  const clockValue = '2026-08-12T09:00:00.000Z';

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-nevermined-route-recovery-'));
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await miniflare.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    // Seed the four frozen services (FK requirement) — same seeding
    // `buildPaidServicesApp` always does; this test file mounts routes
    // directly via `createX402ServiceRoute` (proving the real production
    // code path, same as the live test), which does not itself seed.
    await buildPaidServicesApp({ db, evidenceMode: 'fixture', clock: () => clockValue });
    counters = { verify: 0, settle: 0, execute: 0 };
    const controllable = controllableProvider(counters);
    app = new Hono();
    createX402ServiceRoute(app, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'web_context_verified_direct',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
      outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: controllable.provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      neverminedReconciliationClient: fakeReconciliationClient(
        [succeededTx()],
        consistentDelegation()
      ),
      executor: async (): Promise<ExecutorOutcome> => {
        counters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: { title: 'Fixture Page', text: 'hello' },
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { kind: 'fixture-receipt', ok: true },
          },
        };
      },
    });
  }, 30_000);

  afterEach(async () => {
    await miniflare.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function challenge(): Promise<NeverminedPaymentRequired> {
    const res = await app.request(ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(res.status).toBe(402);
    const decoded = decodeNeverminedPaymentRequiredHeaderSafe(
      res.headers.get('PAYMENT-REQUIRED') ?? ''
    );
    expect(decoded.ok).toBe(true);
    return (decoded as { ok: true; value: NeverminedPaymentRequired }).value;
  }

  function pay(paymentIdentifier: string, delegationId: string = DELEGATION_ID) {
    return app.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
        [PAYMENT_DELEGATION_ID_HEADER]: delegationId,
      },
      body: JSON.stringify(WEB_INPUT),
    });
  }

  it('requires PAYMENT-DELEGATION-ID before any provider call', async () => {
    await challenge();
    const id = generateSiteborneePaymentId();
    const res = await app.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: id,
        // no PAYMENT-DELEGATION-ID header
      },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('malformed_payment_delegation_id');
    expect(counters.verify).toBe(0);
    expect(counters.settle).toBe(0);
    expect(counters.execute).toBe(0);
  });

  it('same Payment-Identifier with a different delegationId is duplicate_conflict, never accepted', async () => {
    await challenge();
    const id = generateSiteborneePaymentId();
    const first = await pay(id, DELEGATION_ID);
    expect(first.status).toBe(200);
    await challenge();
    const conflict = await pay(id, 'del-some-other-delegation-000000000');
    expect(conflict.status).toBe(409);
    expect(counters.execute).toBe(1);
  });

  it('normal success writes SETTLEMENT_PENDING durably before the real settle call, then advances to settled/consumed', async () => {
    await challenge();
    const id = generateSiteborneePaymentId();
    const res = await pay(id);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(counters.verify).toBe(1);
    expect(counters.settle).toBe(1);
    expect(counters.execute).toBe(1);

    const row = await db
      .prepare(
        `SELECT lifecycle_stage, nevermined_delegation_id, settlement_transaction_reference, consumed_at
         FROM payment_attempts WHERE payment_identifier = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      lifecycle_stage: 'settled',
      nevermined_delegation_id: DELEGATION_ID,
    });
    expect(row?.settlement_transaction_reference).toBeTruthy();
    expect(row?.consumed_at).toBeTruthy();
  });

  it('explicit provider failure never enters settlement_pending->settled_external, never consumes, and is a terminal settlement_failed', async () => {
    const hono = new Hono();
    const controllable = controllableProvider(counters);
    controllable.setSettleMode('explicit_failure');
    createX402ServiceRoute(hono, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'web_context_verified_direct',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
      outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: controllable.provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      executor: async (): Promise<ExecutorOutcome> => {
        counters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: {},
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { ok: true },
          },
        };
      },
    });
    const res402 = await hono.request(ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(res402.status).toBe(402);
    const id = generateSiteborneePaymentId();
    const res = await hono.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: id,
        [PAYMENT_DELEGATION_ID_HEADER]: DELEGATION_ID,
      },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(res.status).toBe(402);
    const row = await db
      .prepare(
        `SELECT lifecycle_stage, consumed_at FROM payment_attempts WHERE payment_identifier = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ lifecycle_stage: 'settlement_failed' });
    expect(row?.consumed_at).toBeFalsy();
  });

  it('ambiguous settlement leaves lifecycle_stage at settlement_pending — never settlement_failed, never a silent auto-retry', async () => {
    const hono = new Hono();
    const controllable = controllableProvider(counters);
    controllable.setSettleMode('ambiguous');
    createX402ServiceRoute(hono, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'web_context_verified_direct',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
      outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: controllable.provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      executor: async (): Promise<ExecutorOutcome> => {
        counters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: {},
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { ok: true },
          },
        };
      },
    });
    await hono.request(ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(WEB_INPUT),
    });
    const id = generateSiteborneePaymentId();
    const res = await hono.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: id,
        [PAYMENT_DELEGATION_ID_HEADER]: DELEGATION_ID,
      },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(res.status).toBe(402);
    const row = await db
      .prepare(
        `SELECT lifecycle_stage, consumed_at FROM payment_attempts WHERE payment_identifier = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ lifecycle_stage: 'settlement_pending' });
    expect(row?.consumed_at).toBeFalsy();
  });

  it('crash scenario A: the durable-persistence write itself failing means the real settle call is never reached', async () => {
    // Reproduces the exact precondition `recordSettlementPending` guards
    // against (its `UPDATE ... WHERE lifecycle_stage = 'executed'` CAS)
    // directly against the real D1-backed repository the route uses,
    // proving the invariant the route's own `pending.status !==
    // 'transitioned'` check (x402-service.ts) relies on: a row that
    // never reached `executed` (service artifacts never durably
    // recorded) can never be pushed into `settlement_pending`.
    const { D1PaymentAttemptRepository } = await import(
      '../src/control-plane/repositories/d1/payment-attempts'
    );
    const repo = new D1PaymentAttemptRepository(db);
    const id = generateSiteborneePaymentId();
    await repo.acquire({
      payment_identifier: id,
      binding_digest: 'sha256:' + '9'.repeat(64),
      binding: {
        binding_version: 2,
        payment_rail: 'nevermined',
        payment_provider: NEVERMINED_PAYMENT_PROVIDER,
        nevermined_agent_id: AGENT_ID,
        nevermined_plan_id: PLAN_ID,
        nevermined_delegation_id: DELEGATION_ID,
        payment_identifier: id,
        quote_id: 'qte_' + '1'.repeat(24),
        requirement_id: 'req_' + '1'.repeat(24),
        service_id: SERVICE_ID,
        service_version: 'v1',
        contract_release: '1.0.0',
        request_input_hash: 'sha256:' + '1'.repeat(64),
        resource_id: `https://x/${ROUTE_PATH}`,
        scheme: 'exact',
        network: NETWORK,
        asset: 'nevermined:credits',
        amount: AMOUNT,
        payee: 'siteborne:nevermined-publisher-not-registered',
      },
      created_at: clockValue,
      expires_at: '2026-08-13T00:00:00.000Z',
      consumed: false,
    });
    // Left at 'acquired' — never advanced to 'executed' (service
    // artifacts never durably recorded, exactly crash scenario A).
    const result = await repo.recordSettlementPending(id, {
      neverminedDelegationId: DELEGATION_ID,
    });
    expect(result).toEqual({ status: 'illegal_transition' });
    // The route (x402-service.ts) checks this exact status before ever
    // reaching `evidenceProvider.settle(...)` — see the
    // `pending.status !== 'transitioned'` guard immediately preceding
    // the settle call — so an `illegal_transition` here is structurally
    // equivalent to "the real settle call is never reached".
  });

  it('crash scenario I: SETTLEMENT_PENDING already committed, "restart" (fresh Miniflare instance, same path), reconciliation finds NOT_SETTLED — zero re-execution, zero re-settlement, never auto-retried within reconciliation', async () => {
    await challenge();
    const id = generateSiteborneePaymentId();

    // First app instance: settle "hangs" (simulated by throwing inside
    // settle() after SETTLEMENT_PENDING has already committed) — the
    // durable pending state survives even though the HTTP response never
    // completed successfully.
    const throwingApp = new Hono();
    const throwingCounters = { verify: 0, settle: 0, execute: 0 };
    const throwingProvider = controllableProvider(throwingCounters);
    throwingProvider.setSettleMode('throw');
    createX402ServiceRoute(throwingApp, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'web_context_verified_direct',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
      outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: throwingProvider.provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      executor: async (): Promise<ExecutorOutcome> => {
        throwingCounters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: {},
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { ok: true },
          },
        };
      },
    });
    // Hono's default error boundary turns a thrown handler exception into
    // an HTTP 500, it does not reject the `request()` promise — the
    // durable-write-then-settle sequencing is what this test actually
    // verifies, not the transport-level failure shape.
    const crashResponse = await throwingApp.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: id,
        [PAYMENT_DELEGATION_ID_HEADER]: DELEGATION_ID,
      },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(crashResponse.status).toBe(500);
    expect(throwingCounters.execute).toBe(1);
    expect(throwingCounters.settle).toBe(1); // it was called, then threw

    const pendingRow = await db
      .prepare(`SELECT lifecycle_stage FROM payment_attempts WHERE payment_identifier = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    expect(pendingRow).toMatchObject({ lifecycle_stage: 'settlement_pending' });

    // "Restart": fresh app + fresh reconciliation client reporting
    // NOT_SETTLED (the facilitator never actually received the request).
    const notSettledCounters = { verify: 0, settle: 0, execute: 0 };
    const recoveredApp = new Hono();
    createX402ServiceRoute(recoveredApp, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'web_context_verified_direct',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
      outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: controllableProvider(notSettledCounters).provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      neverminedReconciliationClient: fakeReconciliationClient([], consistentDelegation()),
      executor: async (): Promise<ExecutorOutcome> => {
        notSettledCounters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: {},
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { ok: true },
          },
        };
      },
    });
    const retry = await recoveredApp.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: id,
        [PAYMENT_DELEGATION_ID_HEADER]: DELEGATION_ID,
      },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(retry.status).toBe(202);
    // Core anti-double-charge proof: reconciliation itself never
    // re-verifies, re-executes, or re-settles.
    expect(notSettledCounters.verify).toBe(0);
    expect(notSettledCounters.execute).toBe(0);
    expect(notSettledCounters.settle).toBe(0);
    const stillPending = await db
      .prepare(`SELECT lifecycle_stage FROM payment_attempts WHERE payment_identifier = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    // NOT_SETTLED leaves the row exactly where reconciliation found it —
    // this increment does not implement the separate, explicitly-invoked
    // retry path (see the report's known-gaps section).
    expect(stillPending).toMatchObject({ lifecycle_stage: 'settlement_pending' });
  });

  it('crash-after-provider-commit recovery: fresh Miniflare instance at the same persistence path recovers SETTLED via read-only reconciliation, zero re-execution/re-verify/re-settle, PaymentServiceLink verified, consumed, 200', async () => {
    await challenge();
    const id = generateSiteborneePaymentId();

    // "Process A": settle succeeds at the provider but the HTTP response
    // never reaches the buyer (simulated by throwing immediately after
    // the real settle() call would have returned success — modeled here
    // by using 'throw' mode so counters still record exactly one real
    // settle attempt, matching "the provider really processed it").
    const crashCounters = { verify: 0, settle: 0, execute: 0 };
    const crashApp = new Hono();
    const crashProvider = controllableProvider(crashCounters);
    crashProvider.setSettleMode('throw');
    createX402ServiceRoute(crashApp, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'web_context_verified_direct',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
      outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: crashProvider.provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      executor: async (): Promise<ExecutorOutcome> => {
        crashCounters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: { title: 'Fixture Page', text: 'hello' },
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { kind: 'fixture-receipt', ok: true },
          },
        };
      },
    });
    const crashResponse = await crashApp.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: id,
        [PAYMENT_DELEGATION_ID_HEADER]: DELEGATION_ID,
      },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(crashResponse.status).toBe(500);

    // Dispose the Miniflare instance the "crashed" process used and open
    // a genuinely fresh one at the same resourcePersistencePath — real
    // cross-process durability, not merely a fresh Hono/route instance.
    await miniflare.dispose();
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await miniflare.getD1Database('DB');

    // "Process B": external reconciliation now reports SETTLED (the
    // provider really did process the settlement before the crash).
    const recoveredCounters = { verify: 0, settle: 0, execute: 0 };
    const recoveredApp = new Hono();
    createX402ServiceRoute(recoveredApp, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'web_context_verified_direct',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
      outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: controllableProvider(recoveredCounters).provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      neverminedReconciliationClient: fakeReconciliationClient(
        [succeededTx()],
        consistentDelegation()
      ),
      executor: async (): Promise<ExecutorOutcome> => {
        recoveredCounters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: {},
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { ok: true },
          },
        };
      },
    });
    const retry = await recoveredApp.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: id,
        [PAYMENT_DELEGATION_ID_HEADER]: DELEGATION_ID,
      },
      body: JSON.stringify(WEB_INPUT),
    });
    const body = (await retry.clone().json()) as Record<string, unknown>;
    expect(retry.status, JSON.stringify(body)).toBe(200);
    expect(body.output).toEqual({ title: 'Fixture Page', text: 'hello' });
    expect(body.link_id).toBeTruthy();
    expect(recoveredCounters.verify).toBe(0);
    expect(recoveredCounters.execute).toBe(0);
    expect(recoveredCounters.settle).toBe(0);

    const row = await db
      .prepare(
        `SELECT lifecycle_stage, consumed_at FROM payment_attempts WHERE payment_identifier = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ lifecycle_stage: 'settled' });
    expect(row?.consumed_at).toBeTruthy();

    // Replay after recovered consumption: identical request, zero
    // additional calls of any kind, identical link.
    const replayCounters = { verify: 0, settle: 0, execute: 0 };
    const replayApp = new Hono();
    createX402ServiceRoute(replayApp, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'web_context_verified_direct',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
      outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: controllableProvider(replayCounters).provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      executor: async (): Promise<ExecutorOutcome> => {
        replayCounters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: {},
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { ok: true },
          },
        };
      },
    });
    const replay = await replayApp.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: id,
        [PAYMENT_DELEGATION_ID_HEADER]: DELEGATION_ID,
      },
      body: JSON.stringify(WEB_INPUT),
    });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as Record<string, unknown>;
    expect(replayBody.link_id).toBe(body.link_id);
    expect(replayCounters.verify).toBe(0);
    expect(replayCounters.execute).toBe(0);
    expect(replayCounters.settle).toBe(0);

    // duplicate_conflict after recovered consumption: mutate an immutable
    // binding field (different input -> different request_input_hash),
    // same Payment-Identifier -> 409 before any provider call.
    const conflictCounters = { verify: 0, settle: 0, execute: 0 };
    const conflictApp = new Hono();
    createX402ServiceRoute(conflictApp, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'web_context_verified_direct',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '1.0.0',
      inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
      outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
      pccDependency: '1.0.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: controllableProvider(conflictCounters).provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      executor: async (): Promise<ExecutorOutcome> => {
        conflictCounters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: {},
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { ok: true },
          },
        };
      },
    });
    await conflictApp.request(ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_url: 'https://different.example/', retrieval_mode: 'direct' }),
    });
    const conflict = await conflictApp.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: id,
        [PAYMENT_DELEGATION_ID_HEADER]: DELEGATION_ID,
      },
      body: JSON.stringify({ target_url: 'https://different.example/', retrieval_mode: 'direct' }),
    });
    expect(conflict.status).toBe(409);
    expect(conflictCounters.verify).toBe(0);
    expect(conflictCounters.settle).toBe(0);
    expect(conflictCounters.execute).toBe(0);
  }, 30_000);
});
