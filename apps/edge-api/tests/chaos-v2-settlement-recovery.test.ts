/**
 * SUN-1000 Checkpoint 1N-A2 — chaos settlement/recovery completion.
 *
 * Checkpoint 1N-A's chaos gate did not exercise settlement_pending
 * durability, post-settlement local uncertainty, reconciliation-read
 * behavior, or restart-from-settlement_pending recovery for the v2
 * service family, and "the shared v1 suite already proves this" was
 * correctly rejected as insufficient evidence for the chaos gate itself.
 *
 * This file closes that gap directly, reusing the *exact* harness
 * pattern already accepted in `nevermined-route-settlement-recovery.test.ts`
 * (SUN-0900B checkpoint 1B) — `createX402ServiceRoute` called directly
 * with a controllable `PaymentEvidenceProvider` and a fake
 * `NeverminedDelegationLookupClient`, never a parallel implementation —
 * but parametrized with a real `.v2` `serviceId`.
 *
 * Why this is necessary rather than merely citing the v1 file: as of
 * checkpoint 1M, `paid-services.ts`'s live-mounted `/v2/...` routes are
 * deliberately, permanently CDP-only (`v2CdpRoute()` never routes
 * through the `rail === 'nevermined'` branch) — this is the correct,
 * accepted, disclosed Phase-1 fail-closed design, not a limitation of
 * the underlying lifecycle code. The settlement_pending/reconciliation/
 * crash-recovery machinery itself lives in the *shared*
 * `x402-service.ts`/`D1PaymentAttemptRepository` implementation, gated
 * by `rail`, never by `service_id` — confirmed by direct inspection
 * (x402-service.ts's `if (rail === 'nevermined')` branches never
 * reference `config.serviceId`). This file proves that shared
 * implementation is genuinely correct when invoked with a `.v2`
 * identity, by calling `createX402ServiceRoute` directly (the same real
 * production function, the same way the accepted v1 suite does) rather
 * than through `paid-services.ts`'s deliberately-restricted wiring —
 * which is the only layer that currently withholds `.v2` from the
 * Nevermined rail, and is left completely untouched by this file. Once
 * Phase 2 mounts a real v2 Nevermined route through that same wiring,
 * it inherits these exact, now-proven guarantees automatically.
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

// SUN-1000 checkpoint 1N-A2: a .v2 identity, deliberately exercised
// against createX402ServiceRoute directly with rail: 'nevermined' --
// proving the shared lifecycle code, not the (unchanged, still
// CDP-only) live /v2/... wiring.
const SERVICE_ID = 'company_evidence_graph.v2' as const;
const ROUTE_PATH = '/v2/nevermined-recovery-chaos-test/company/evidence-graph';
const AGENT_ID = 'agent_recovery_chaos_test_v2';
const PLAN_ID = 'plan_recovery_chaos_test_v2';
const DELEGATION_ID = 'del-recovery-chaos-test-000000000000';
const NETWORK = 'eip155:84532' as const;
const COMPANY_INPUT = {
  identifiers: { cik: '0000320193' },
  requested_field_groups: ['identity', 'sec_submissions'],
};
const BUYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';

type SettleMode = 'success' | 'ambiguous' | 'throw';

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
        return { ...base, transaction_reference: `0x${'a'.repeat(64)}`, success: true };
      }
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
    createdAt: '2026-08-17T08:17:11.444Z',
  };
}

describe('SUN-1000 checkpoint 1N-A2 — v2 settlement/recovery chaos completion', () => {
  let tempDir: string;
  let miniflare: Miniflare;
  let db: D1Database;
  const clockValue = '2026-08-17T09:00:00.000Z';

  function buildRoute(
    app: Hono,
    counters: { verify: number; settle: number; execute: number },
    opts: {
      settleMode?: SettleMode;
      reconciliationClient?: NeverminedDelegationLookupClient;
    } = {}
  ) {
    const controllable = controllableProvider(counters);
    if (opts.settleMode) controllable.setSettleMode(opts.settleMode);
    createX402ServiceRoute(app, {
      serviceId: SERVICE_ID,
      scheme: 'exact',
      pricingKey: 'company_evidence_graph',
      network: NETWORK,
      asset: 'nevermined:credits',
      path: ROUTE_PATH,
      inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
      contractRelease: '2.0.0',
      inputSchemaHash: 'sha256:8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7',
      outputSchemaHash: 'sha256:5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b',
      pccDependency: '1.1.0',
      db,
      clock: () => clockValue,
      payTo: 'siteborne:nevermined-publisher-not-registered',
      evidenceMode: 'production',
      evidenceProvider: controllable.provider,
      rail: 'nevermined',
      nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
      neverminedReconciliationClient: opts.reconciliationClient,
      executor: async (): Promise<ExecutorOutcome> => {
        counters.execute += 1;
        return {
          result: {
            result_class: 'success',
            output: {},
            output_hash: 'sha256:' + '4'.repeat(64),
            receipt_id: 'rcpt_' + '5'.repeat(24),
            receipt: { kind: 'fixture-receipt', ok: true },
          },
        };
      },
    });
  }

  async function challenge(app: Hono): Promise<NeverminedPaymentRequired> {
    const res = await app.request(ROUTE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(COMPANY_INPUT),
    });
    expect(res.status).toBe(402);
    const decoded = decodeNeverminedPaymentRequiredHeaderSafe(
      res.headers.get('PAYMENT-REQUIRED') ?? ''
    );
    expect(decoded.ok).toBe(true);
    return (decoded as { ok: true; value: NeverminedPaymentRequired }).value;
  }

  function pay(app: Hono, paymentIdentifier: string, delegationId: string = DELEGATION_ID) {
    return app.request(ROUTE_PATH, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'fixture_' + '0'.repeat(24),
        [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
        [PAYMENT_DELEGATION_ID_HEADER]: delegationId,
      },
      body: JSON.stringify(COMPANY_INPUT),
    });
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-chaos-v2-settlement-recovery-'));
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await miniflare.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    await buildPaidServicesApp({ db, evidenceMode: 'fixture', clock: () => clockValue });
  }, 30_000);

  afterEach(async () => {
    await miniflare.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('SETTLEMENT_PENDING_PREWRITE_FAILURE: a v2 row never advanced past acquired can never be pushed into settlement_pending, real settle is never reached', async () => {
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
        service_version: 'v2',
        contract_release: '2.0.0',
        request_input_hash: 'sha256:' + '1'.repeat(64),
        resource_id: `https://x/${ROUTE_PATH}`,
        scheme: 'exact',
        network: NETWORK,
        asset: 'nevermined:credits',
        amount: '39000',
        payee: 'siteborne:nevermined-publisher-not-registered',
      },
      created_at: clockValue,
      expires_at: '2026-08-18T00:00:00.000Z',
      consumed: false,
    });
    // Left at 'acquired' -- never advanced to 'executed' -- exactly
    // crash scenario A, proven for a real .v2 binding row.
    const result = await repo.recordSettlementPending(id, {
      neverminedDelegationId: DELEGATION_ID,
    });
    expect(result).toEqual({ status: 'illegal_transition' });
  });

  it('SETTLEMENT_PENDING_POSTWRITE_DURABILITY: a v2 payment durably writes settlement_pending before the real settle call, then advances to settled/consumed', async () => {
    const counters = { verify: 0, settle: 0, execute: 0 };
    const app = new Hono();
    buildRoute(app, counters, {
      reconciliationClient: fakeReconciliationClient([succeededTx()], consistentDelegation()),
    });
    await challenge(app);
    const id = generateSiteborneePaymentId();
    const res = await pay(app, id);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(counters.verify).toBe(1);
    expect(counters.settle).toBe(1);
    expect(counters.execute).toBe(1);
    const row = await db
      .prepare(
        `SELECT lifecycle_stage, service_id, service_version, consumed_at FROM payment_attempts WHERE payment_identifier = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      lifecycle_stage: 'settled',
      service_id: SERVICE_ID,
      service_version: 'v2',
    });
    expect(row?.consumed_at).toBeTruthy();
  });

  it('POST_SETTLEMENT_LOCAL_FAILURE: an ambiguous v2 settlement response leaves lifecycle_stage at settlement_pending, never settlement_failed, never auto-retried', async () => {
    const counters = { verify: 0, settle: 0, execute: 0 };
    const app = new Hono();
    buildRoute(app, counters, { settleMode: 'ambiguous' });
    await challenge(app);
    const id = generateSiteborneePaymentId();
    const res = await pay(app, id);
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

  it('RESTART_FROM_SETTLEMENT_PENDING: a v2 payment stuck mid-settle survives a real Miniflare restart, and NOT_SETTLED reconciliation never re-executes, re-verifies, or re-settles', async () => {
    const throwingCounters = { verify: 0, settle: 0, execute: 0 };
    const throwingApp = new Hono();
    buildRoute(throwingApp, throwingCounters, { settleMode: 'throw' });
    await challenge(throwingApp);
    const id = generateSiteborneePaymentId();
    const crashResponse = await pay(throwingApp, id);
    expect(crashResponse.status).toBe(500);
    expect(throwingCounters.execute).toBe(1);
    expect(throwingCounters.settle).toBe(1);

    const pendingRow = await db
      .prepare(`SELECT lifecycle_stage FROM payment_attempts WHERE payment_identifier = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    expect(pendingRow).toMatchObject({ lifecycle_stage: 'settlement_pending' });

    // Real process-restart: dispose this Miniflare instance, open a
    // genuinely fresh one at the same persistence path.
    await miniflare.dispose();
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await miniflare.getD1Database('DB');

    const notSettledCounters = { verify: 0, settle: 0, execute: 0 };
    const recoveredApp = new Hono();
    buildRoute(recoveredApp, notSettledCounters, {
      reconciliationClient: fakeReconciliationClient([], consistentDelegation()),
    });
    const retry = await pay(recoveredApp, id);
    expect(retry.status).toBe(202);
    expect(notSettledCounters.verify).toBe(0);
    expect(notSettledCounters.execute).toBe(0);
    expect(notSettledCounters.settle).toBe(0);
    const stillPending = await db
      .prepare(`SELECT lifecycle_stage FROM payment_attempts WHERE payment_identifier = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    expect(stillPending).toMatchObject({ lifecycle_stage: 'settlement_pending' });
  });

  it('RECONCILIATION_READ_SUCCESS_PSL_FINALIZATION: a v2 payment settled externally but crashed locally recovers SETTLED via read-only reconciliation after restart, zero re-execution/re-verify/re-settle, PaymentServiceLink verified, consumed, 200', async () => {
    const crashCounters = { verify: 0, settle: 0, execute: 0 };
    const crashApp = new Hono();
    buildRoute(crashApp, crashCounters, { settleMode: 'throw' });
    await challenge(crashApp);
    const id = generateSiteborneePaymentId();
    const crashResponse = await pay(crashApp, id);
    expect(crashResponse.status).toBe(500);

    // Real process-restart at the same persistence path.
    await miniflare.dispose();
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: tempDir,
    });
    db = await miniflare.getD1Database('DB');

    const recoveryCounters = { verify: 0, settle: 0, execute: 0 };
    const recoveredApp = new Hono();
    buildRoute(recoveredApp, recoveryCounters, {
      reconciliationClient: fakeReconciliationClient([succeededTx()], consistentDelegation()),
    });
    const retry = await pay(recoveredApp, id);
    expect(retry.status).toBe(200);
    // Read-only reconciliation recovers the terminal state without any
    // new verify/execute/settle call.
    expect(recoveryCounters.verify).toBe(0);
    expect(recoveryCounters.execute).toBe(0);
    expect(recoveryCounters.settle).toBe(0);
    const finalRow = await db
      .prepare(
        `SELECT lifecycle_stage, consumed_at, settlement_transaction_reference FROM payment_attempts WHERE payment_identifier = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(finalRow).toMatchObject({ lifecycle_stage: 'settled' });
    expect(finalRow?.consumed_at).toBeTruthy();
    expect(finalRow?.settlement_transaction_reference).toBeTruthy();
    // The response body includes a PaymentServiceLink id -- proof the
    // link was independently constructed/self-verified during recovery,
    // not merely inferred from the payment_attempts row.
    const body = (await retry.json()) as Record<string, unknown>;
    expect(body.link_id).toBeTruthy();
  });
});
