/**
 * SUN-0900B checkpoints 2H/2I — one controlled real Nevermined sandbox
 * lifecycle for the frozen document dynamic-credit plan.
 *
 * Normal tests/CI perform zero credential reads and zero network calls because
 * the whole suite is skipped unless RUN_LIVE_NEVERMINED=1. This file never
 * registers an agent or plan. It reconciles the immutable checkpoint-2G IDs,
 * proves zero starting plan credits, creates/reuses at most one 19-cent
 * plan-bound delegation, mints one ephemeral token, and drives one logical
 * Payment-Identifier through the existing HTTP/D1/service/PCC/receipt/PSL
 * lifecycle. Replay reuses the same token only in memory and invokes no
 * provider or service work.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { Payments, PaymentsError } from '@nevermined-io/payments';
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  http,
  type Address,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS,
  NEVERMINED_ROUTES,
  PAYMENT_DELEGATION_ID_HEADER,
  PAYMENT_IDENTIFIER_HEADER,
  buildNeverminedCreditsSettlementEvidence,
  decodeNeverminedPaymentRequiredHeaderSafe,
  decodeNeverminedPaymentResponseHeaderSafe,
  readNeverminedSettlementObservation,
  reconcileNeverminedDocumentDynamicRegistration,
  reconcileNeverminedRegistration,
  validateNeverminedCreditsSettlementEvidence,
  validateNeverminedDocumentDynamicPlan,
  type NeverminedAgentReadback,
  type NeverminedPaymentRequired,
  type NeverminedPlanReadback,
  type NeverminedRegistryClient,
} from '@siteborne/protocol-nevermined';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  bindingsAreIdentical,
  generateSiteborneePaymentId,
  hashPaymentObject,
  verifyPaymentServiceLink,
  type ExternalSettlementEvidence,
  type ExternalVerificationEvidence,
  type PaymentEvidenceProvider,
  type PaymentAttemptBinding,
  type PaymentServiceLink,
  type PaymentSettlementContext,
  type PaymentVerificationContext,
  type UsageResult,
} from '@siteborne/protocol-x402';
import { calculateDocumentUsage, documentUsageToAtomicUnits } from '@siteborne/pricing';
import {
  FixtureDocumentWorkerBridge,
  SubprocessDocumentWorkerBridge,
  buildFixtureRegistry,
  buildServiceContext,
  createFixtureSigner,
  createTestArtifactStore,
  createTestClock,
  createTestServiceAuditSink,
  executeLocalService,
  registerFixtureScenario,
  verifyServiceReceipt,
  type WorkerResult,
} from '@siteborne/service-runtime';
import type { VerificationReceipt } from '@siteborne/verification';
import DOCUMENT_WORKER_RESULT_JSON from '../../../../packages/service-runtime/fixtures/document-worker-results/native-text-success.json' with { type: 'json' };
import { NeverminedPaymentEvidenceProvider } from '../../src/control-plane/evidence/nevermined-provider';
import { NeverminedSandboxReconciliationClient } from '../../src/control-plane/evidence/nevermined-reconciliation-client';
import {
  ensureLivePersistenceDirectory,
  resolveLivePersistencePath,
} from '../../src/control-plane/live-persistence-path';
import { buildPaidServicesApp } from '../../src/control-plane/routes/paid-services';
import {
  createX402ServiceRoute,
  type ExecutorOutcome,
} from '../../src/control-plane/routes/x402-service';

const RUN_LIVE = process.env.RUN_LIVE_NEVERMINED === '1';
const PARTIAL_BALANCE_RUN = process.env.NEVERMINED_DOCUMENT_PARTIAL_BALANCE === '1';
const AGENT_ID = '109760621961288696094411057321700210583752765344624386042713081041578011828571';
const PLAN_ID = '64977106381472769302826211192910538031161833107493020584806963732279386695975';
const SERVICE_ID = 'document_evidence_json.v1' as const;
const ROUTE = NEVERMINED_ROUTES[SERVICE_ID];
const NETWORK = 'eip155:84532' as const;
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;
const SELLER = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' as Address;
const PLATFORM = '0x2020949c1B565421AC21b76e70340266c4CA9A90' as Address;
const AUTHORIZED_MAXIMUM = '190000';
const ACTUAL_USAGE = PARTIAL_BALANCE_RUN ? '190000' : '12000';
const STARTING_BALANCE = PARTIAL_BALANCE_RUN ? '178000' : '0';
const DELEGATION_BUDGET_CENTS = 19;
const MINIMUM_DELEGATION_LIFETIME_MS = 45 * 60 * 1_000;
const FIXTURE_ARTIFACT_ID = PARTIAL_BALANCE_RUN
  ? 'doc/scanned-ten-page-fixture.pdf'
  : 'doc/native-fixture.pdf';
const MAXIMUM_FIXTURE_PATH = fileURLToPath(
  new URL('../../../../services/modal-worker/fixtures/pdf/scanned_ten_page.pdf', import.meta.url)
);
const MAXIMUM_FIXTURE_BYTES = new Uint8Array(readFileSync(MAXIMUM_FIXTURE_PATH));
const FIXTURE_BYTES = PARTIAL_BALANCE_RUN
  ? MAXIMUM_FIXTURE_BYTES
  : registerFixtureScenario(new Uint8Array([9]), 'nevermined-live-document-native');
const DOCUMENT_WORKER_RESULT = DOCUMENT_WORKER_RESULT_JSON as unknown as WorkerResult;
const PARTIAL_BALANCE_OCR_DISABLED_INPUT = {
  artifact_reference: {
    artifact_id: 'doc/scanned-ten-page-fixture.pdf',
    media_type: 'application/pdf' as const,
    // This is the exact immutable input from the failed first attempt. The
    // harness had not yet replaced the old one-byte fixture declaration.
    size_bytes: 1,
  },
};
const PARTIAL_BALANCE_OCR_ENABLED_SAME_SIZE_INPUT = {
  ...PARTIAL_BALANCE_OCR_DISABLED_INPUT,
  ocr_permission: true,
};
const PARTIAL_BALANCE_OCR_ENABLED_INPUT = {
  artifact_reference: {
    ...PARTIAL_BALANCE_OCR_DISABLED_INPUT.artifact_reference,
    size_bytes: MAXIMUM_FIXTURE_BYTES.length,
  },
  // The maximum-cost fixture is image-only. This permission is part of
  // the immutable service input and must be present before the payment
  // identifier is acquired; the document runtime correctly refuses OCR
  // when it is absent.
  ocr_permission: true,
};
const DOCUMENT_INPUT = PARTIAL_BALANCE_RUN
  ? PARTIAL_BALANCE_OCR_ENABLED_INPUT
  : {
      artifact_reference: {
        artifact_id: FIXTURE_ARTIFACT_ID,
        media_type: 'application/pdf' as const,
        size_bytes: FIXTURE_BYTES.length,
      },
    };
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations', import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const WORKER_CWD = fileURLToPath(new URL('../../../../services/modal-worker', import.meta.url));
const WORKER_PYTHON = join(WORKER_CWD, '.venv', 'bin', 'python');
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

function hasMinimumDelegationLifetime(expiresAt: string, nowMs: number): boolean {
  const expiryMs = Date.parse(expiresAt);
  return Number.isFinite(expiryMs) && expiryMs - nowMs >= MINIMUM_DELEGATION_LIFETIME_MS;
}

describe('SUN-0900B checkpoint 2I credential-free immutable-input guards', () => {
  it('binds the rejected OCR-disabled input to its preserved incident hash and separates the corrected input', async () => {
    const failedHash = await hashPaymentObject(PARTIAL_BALANCE_OCR_DISABLED_INPUT);
    const ocrOnlyHash = await hashPaymentObject(PARTIAL_BALANCE_OCR_ENABLED_SAME_SIZE_INPUT);
    const correctedHash = await hashPaymentObject(PARTIAL_BALANCE_OCR_ENABLED_INPUT);

    expect(failedHash).toBe(
      'sha256:b889fc62ece7d0c68e0173fb91d7d075bd880aa595266043ed35b02d7884aba2'
    );
    expect(ocrOnlyHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(ocrOnlyHash).not.toBe(failedHash);
    expect(correctedHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(correctedHash).not.toBe(failedHash);

    const baseBinding: PaymentAttemptBinding = {
      binding_version: 2,
      payment_rail: 'nevermined',
      payment_provider: 'nevermined-payments@1.10.0',
      nevermined_agent_id: AGENT_ID,
      nevermined_plan_id: PLAN_ID,
      nevermined_delegation_id: 'fde6e86c-1415-4bac-966f-2228526078bd',
      payment_identifier: 'pay_f9cfc34bac0d46bc980d71b286bf39a6',
      quote_id: 'qte_' + '1'.repeat(24),
      requirement_id: 'req_' + '2'.repeat(24),
      service_id: SERVICE_ID,
      service_version: 'v1',
      contract_release: '1.0.0',
      request_input_hash: failedHash,
      resource_id: 'https://utility.siteborne.net/v1/nevermined/document/evidence-json',
      scheme: 'upto',
      network: NETWORK,
      asset: 'nevermined:credits',
      amount: AUTHORIZED_MAXIMUM,
      payee: 'siteborne:nevermined-publisher-not-registered',
    };
    expect(
      bindingsAreIdentical(baseBinding, {
        ...baseBinding,
        request_input_hash: ocrOnlyHash,
      })
    ).toBe(false);
  });

  it('refuses delegation reuse unless at least 45 minutes remain', () => {
    const now = Date.parse('2026-08-15T20:00:00.000Z');
    expect(hasMinimumDelegationLifetime('2026-08-15T20:44:59.999Z', now)).toBe(false);
    expect(hasMinimumDelegationLifetime('2026-08-15T20:45:00.000Z', now)).toBe(true);
  });
});

const ADD_COLUMN_PATTERN = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/i;

async function columnExists(db: D1Database, table: string, column: string): Promise<boolean> {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (result.results ?? []).some((row) => row.name === column);
}

async function runMigrations(db: D1Database): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const statements = sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter(Boolean);
    for (const statement of statements) {
      const match = statement.match(ADD_COLUMN_PATTERN);
      if (match && (await columnExists(db, match[1]!, match[2]!))) continue;
      await db.exec(statement);
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`SUN-0900B document live: required variable ${name} is missing`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readPlanBalanceEventually(
  builder: Payments,
  accountAddress: Address,
  expected?: bigint
): Promise<Awaited<ReturnType<Payments['plans']['getPlanBalance']>>> {
  let last: Awaited<ReturnType<Payments['plans']['getPlanBalance']>> | undefined;
  for (const delay of [0, 2_000, 5_000, 10_000]) {
    if (delay > 0) await sleep(delay);
    last = await builder.plans.getPlanBalance(PLAN_ID, accountAddress);
    if (expected === undefined || BigInt(last.balance) === expected) return last;
  }
  return last!;
}

async function listTransactionsEventually(
  client: NeverminedSandboxReconciliationClient,
  delegationId: string
) {
  let last: Awaited<ReturnType<typeof client.listDelegationTransactions>> = { transactions: [] };
  for (const delay of [0, 2_000, 5_000, 10_000]) {
    if (delay > 0) await sleep(delay);
    last = await client.listDelegationTransactions(delegationId);
    if (last.transactions.length > 0) return last;
  }
  return last;
}

function makeRegistryClient(builder: Payments): NeverminedRegistryClient {
  return {
    getAgent: async (id) => {
      const agent = (await builder.agents.getAgent(id)) as NeverminedAgentReadback;
      return { id, name: agent.metadata?.main?.name };
    },
    getAgents: async () => {
      const page = await builder.agents.getAgents(1, 100, 'createdAt', 'desc');
      return {
        agents: (page.agents as NeverminedAgentReadback[]).map((agent) => ({
          id: agent.id!,
          name: agent.metadata?.main?.name,
        })),
      };
    },
    getAgentPlans: async (id) => {
      const result = await builder.agents.getAgentPlans(id);
      const plans: { id?: string; planId?: string }[] = Array.isArray(result)
        ? result
        : (result?.plans ?? []);
      return {
        planIds: plans.map((plan) => plan.id ?? plan.planId).filter((id): id is string => !!id),
      };
    },
    getPlan: async (id) => {
      const plan = (await builder.plans.getPlan(id)) as NeverminedPlanReadback;
      return { id, name: plan.metadata?.main?.name };
    },
    getPlans: async () => {
      const page = await builder.plans.getPlans(1, 100, 'createdAt', 'desc');
      return {
        plans: (page.plans as NeverminedPlanReadback[]).map((plan) => ({
          id: plan.id!,
          name: plan.metadata?.main?.name,
        })),
      };
    },
  };
}

function transferAmounts(receipt: TransactionReceipt) {
  let seller = 0n;
  let platform = 0n;
  const payers = new Set<string>();
  const transfers: Array<{ from: string; to: string; value: bigint }> = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      if (decoded.eventName !== 'Transfer') continue;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      const transfer = {
        from: args.from.toLowerCase(),
        to: args.to.toLowerCase(),
        value: args.value,
      };
      transfers.push(transfer);
      if (transfer.to === SELLER.toLowerCase()) {
        seller += transfer.value;
        payers.add(transfer.from);
      }
      if (transfer.to === PLATFORM.toLowerCase()) {
        platform += transfer.value;
        payers.add(transfer.from);
      }
    } catch {
      // Non-Transfer USDC log; ignored. Exact expected transfer totals below
      // remain the fail-closed authority.
    }
  }
  return { seller, platform, gross: seller + platform, payers: [...payers], transfers };
}

const FRESH_PROCESS_INSPECTOR = String.raw`
import { Miniflare } from 'miniflare';
const persistencePath = process.argv[1];
const paymentIdentifier = process.argv[2];
const mf = new Miniflare({
  modules: true,
  script: "export default { async fetch() { return new Response('OK'); } }",
  d1Databases: ['DB'],
  resourcePersistencePath: persistencePath,
});
const db = await mf.getD1Database('DB');
const attempt = await db.prepare('SELECT payment_identifier, lifecycle_stage, amount, nevermined_agent_id, nevermined_plan_id, nevermined_delegation_id, settlement_transaction_reference, settlement_pending_at, consumed_at FROM payment_attempts WHERE payment_identifier = ?').bind(paymentIdentifier).first();
const job = await db.prepare('SELECT id, idempotency_key, current_state, input_hash FROM jobs WHERE idempotency_key = ?').bind(paymentIdentifier).first();
const resultRow = job ? await db.prepare('SELECT result_json FROM x402_service_results WHERE job_id = ?').bind(job.id).first() : null;
const cached = resultRow ? JSON.parse(resultRow.result_json) : null;
const durable = cached?.durableEvidence;
const summary = {
  attempt,
  job,
  result: cached ? {
    status: cached.status,
    receipt_id: cached.body?.receipt_id,
    link_id: cached.body?.link_id,
    link_hash: cached.body?.link_hash,
    usage_actual: durable?.usage_result?.actual_amount,
    usage_maximum: durable?.usage_result?.authorized_maximum,
    usage_hash: durable?.usage_result?.usage_result_hash,
    pcc_present: durable?.pcc !== undefined,
    receipt_present: durable?.receipt !== undefined,
    settlement_evidence_hash: durable?.payment_service_link?.settlement_evidence_hash,
    payment_service_link: durable?.payment_service_link,
    credits_redeemed: durable?.settlement_evidence?.nevermined_credits_settlement?.credits_redeemed,
    remaining_balance: durable?.settlement_evidence?.nevermined_credits_settlement?.remaining_balance,
    cash_movement_atomic: durable?.settlement_evidence?.nevermined_credits_settlement?.cash_movement_atomic,
  } : null,
};
await mf.dispose();
process.stdout.write(JSON.stringify(summary));
`;

describe.skipIf(!RUN_LIVE)(
  PARTIAL_BALANCE_RUN
    ? 'SUN-0900B checkpoint 2I — positive-insufficient document credit lifecycle'
    : 'SUN-0900B checkpoint 2H — real zero-balance document prepaid-credit lifecycle',
  () => {
    let mf: Miniflare | undefined;
    let db: D1Database;
    let app: Hono;
    let persistencePath: string;
    let builder: Payments;
    let subscriber: Payments;
    let subscriberAccount: Address;
    let subscriberSmartAccount: Address;
    let accessToken: string;
    let delegationId: string;
    let paymentIdentifier: string;
    let verificationEvidence: ExternalVerificationEvidence | undefined;
    let settlementEvidence:
      | (ExternalSettlementEvidence & { nevermined_credits_settlement: unknown })
      | undefined;
    let usageResult: UsageResult | undefined;
    let transactionReceipt: TransactionReceipt | undefined;
    let onchainAmounts = {
      seller: 0n,
      platform: 0n,
      gross: 0n,
      payers: [] as string[],
      transfers: [] as Array<{ from: string; to: string; value: bigint }>,
    };
    let endingBalance: string | undefined;
    let creditsAcquired: string | undefined;
    let transactionAmountCents: string | undefined;
    let documentWorkerResult: WorkerResult | undefined;
    let executionCount = 0;
    let verifyCount = 0;
    let settleCount = 0;
    let tokenCount = 0;
    let delegationCreateCount = 0;
    let receiptVerificationCount = 0;
    let d1AcquiredBeforeVerify = false;
    let settlementPendingBeforeSettle = false;
    let paymentIdBeforeProvider: string | undefined;
    let jobId: string | undefined;
    let outputHash: string | undefined;
    let receiptId: string | undefined;
    let receiptHash: string | undefined;
    let pcc: unknown;

    async function openPersistentD1() {
      mf = new Miniflare({
        modules: true,
        script: `export default { async fetch() { return new Response('OK'); } }`,
        d1Databases: ['DB'],
        resourcePersistencePath: persistencePath,
      });
      db = await mf.getD1Database('DB');
      await db.exec('PRAGMA foreign_keys = ON');
      await runMigrations(db);
      await buildPaidServicesApp({
        db,
        evidenceMode: 'fixture',
        clock: () => new Date().toISOString(),
      });
    }

    async function mountRoute(provider: PaymentEvidenceProvider) {
      app = new Hono();
      const { signer, registry: keyRegistry } = await createFixtureSigner();
      createX402ServiceRoute(app, {
        serviceId: SERVICE_ID,
        scheme: 'upto',
        pricingKey: 'document_evidence_json_max_job',
        network: NETWORK,
        asset: 'nevermined:credits',
        path: ROUTE,
        inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
        contractRelease: '1.0.0',
        inputSchemaHash: 'sha256:19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba',
        outputSchemaHash: 'sha256:df91ed115ae0e29d8f4c211d95462ddd96e9714bc5f5e0ce0b820b370e0d5dde',
        pccDependency: '1.0.0',
        db,
        clock: () => new Date().toISOString(),
        payTo: 'siteborne:nevermined-publisher-not-registered',
        evidenceMode: 'production',
        evidenceProvider: provider,
        rail: 'nevermined',
        nevermined: { agentId: AGENT_ID, planId: PLAN_ID },
        neverminedReconciliationClient: NeverminedSandboxReconciliationClient.authenticated({
          apiKey: requireEnv('NVM_API_KEY'),
          liveGuard: {
            runLiveNevermined: process.env.RUN_LIVE_NEVERMINED,
            apiKeyEnvironment: 'sandbox',
          },
        }),
        executor: async (input): Promise<ExecutorOutcome> => {
          executionCount += 1;
          const row = await db
            .prepare('SELECT lifecycle_stage FROM payment_attempts WHERE payment_identifier = ?')
            .bind(paymentIdentifier)
            .first<{ lifecycle_stage: string }>();
          expect(row?.lifecycle_stage).toBe('verified');

          const context = buildServiceContext(SERVICE_ID, {
            clock: createTestClock(),
            artifact_store: createTestArtifactStore(),
            audit: createTestServiceAuditSink(),
            execution_mode: 'fixture',
          });
          await context.artifact_store.put(
            {
              id: FIXTURE_ARTIFACT_ID,
              contentHash: 'sha256:' + createHash('sha256').update(FIXTURE_BYTES).digest('hex'),
              media_type: 'application/pdf',
              byte_length: FIXTURE_BYTES.length,
            },
            FIXTURE_BYTES
          );
          const baseWorker = PARTIAL_BALANCE_RUN
            ? new SubprocessDocumentWorkerBridge(WORKER_PYTHON, WORKER_CWD)
            : new FixtureDocumentWorkerBridge(
                new Map([['nevermined-live-document-native', DOCUMENT_WORKER_RESULT]])
              );
          const registry = buildFixtureRegistry({
            httpClient: {
              async fetch() {
                return new Response('{}');
              },
            },
            context,
            worker: {
              async run(request) {
                const workerResult = await baseWorker.run(request);
                documentWorkerResult = workerResult;
                return workerResult;
              },
            },
            signer,
            keyRegistry,
          });
          const result = await executeLocalService(registry, SERVICE_ID, input, context);
          if (!result.receipt || !result.receipt_id || !result.output_hash) {
            throw new Error('document fixture did not produce its signed receipt');
          }
          const receiptCheck = await verifyServiceReceipt({
            receipt: result.receipt as VerificationReceipt,
            keyRegistry,
            expectedServiceId: SERVICE_ID,
            expectedOutputHash: result.output_hash,
          });
          receiptVerificationCount += 1;
          if (!receiptCheck.valid) throw new Error('SITEBORNE receipt self-verification failed');

          if (!documentWorkerResult || documentWorkerResult.status !== 'success') {
            throw new Error('document worker did not produce a successful measured result');
          }
          const measuredPages = documentWorkerResult.pages;
          const usage = calculateDocumentUsage(
            measuredPages.map((page) => ({
              page_number: page.page_number,
              ocr_used: page.ocr_used,
              table_count: page.tables.length,
            }))
          );
          if (documentUsageToAtomicUnits(usage, 6) !== ACTUAL_USAGE) {
            throw new Error('document fixture actual usage did not match the frozen scenario');
          }
          outputHash = result.output_hash;
          receiptId = result.receipt_id;
          receiptHash = await hashPaymentObject(
            result.receipt as unknown as Record<string, unknown>
          );
          pcc = result.verification;
          return {
            result,
            actualAmountAtomic: documentUsageToAtomicUnits(usage, 6),
            resourceMetrics: {
              page_count: measuredPages.length,
              pages: measuredPages.map((page) => ({
                page_number: page.page_number,
                ocr_used: page.ocr_used,
                table_count: page.tables.length,
              })),
              page_costs: usage.page_costs,
              subtotal_usd_micro: usage.subtotal_usd_micro,
              max_job_usd_micro: usage.max_job_usd_micro,
              total_usd_micro: usage.total_usd_micro,
              capped: usage.capped,
            },
          };
        },
      });
    }

    afterAll(async () => {
      if (mf) await mf.dispose();
    });

    beforeAll(async () => {
      requireEnv('NVM_API_KEY');
      requireEnv('NVM_SUBSCRIBER_API_KEY');
      if (requireEnv('NVM_ENVIRONMENT') !== 'sandbox') {
        throw new Error('SUN-0900B document live: NVM_ENVIRONMENT must equal sandbox');
      }
      if (process.env.RUN_LIVE_X402) throw new Error('RUN_LIVE_X402 must remain absent');
      if (process.env.NEVERMINED_REGISTER_DOCUMENT) {
        throw new Error('NEVERMINED_REGISTER_DOCUMENT must remain absent');
      }
      if (
        process.env.NEVERMINED_PROBE_PAYG_DIFFERENTIAL ||
        process.env.NEVERMINED_PROBE_DYNAMIC_CREDITS
      ) {
        throw new Error('Nevermined capability probe flags must remain absent');
      }

      persistencePath = resolveLivePersistencePath({ repositoryRoot: REPOSITORY_ROOT });
      ensureLivePersistenceDirectory(persistencePath);
      // Public, non-secret operational path.
      // eslint-disable-next-line no-console
      console.log(
        PARTIAL_BALANCE_RUN
          ? 'SUN-0900B 2I persistent D1 path:'
          : 'SUN-0900B 2H persistent D1 path:',
        persistencePath
      );
      await openPersistentD1();

      const unfinished = await db
        .prepare(
          `SELECT payment_identifier, lifecycle_stage FROM payment_attempts
           WHERE service_id = ? AND lifecycle_stage IN
           ('settlement_pending', 'settled_external', 'link_verified')`
        )
        .bind(SERVICE_ID)
        .all<{ payment_identifier: string; lifecycle_stage: string }>();
      if ((unfinished.results ?? []).length > 0) {
        throw new Error(
          `SUN-0900B document live: recoverable lifecycle already exists (${unfinished.results![0]!.lifecycle_stage}); refusing fresh creation`
        );
      }
      if (PARTIAL_BALANCE_RUN) {
        const existingState = await db
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM payment_attempts) AS payment_attempts,
               (SELECT COUNT(*) FROM jobs) AS jobs`
          )
          .first<{ payment_attempts: number; jobs: number }>();
        if (existingState?.payment_attempts !== 0 || existingState?.jobs !== 0) {
          throw new Error(
            `SUN-0900B 2I: attempt-2 D1 must be empty (payment_attempts=${existingState?.payment_attempts ?? 'unknown'}, jobs=${existingState?.jobs ?? 'unknown'})`
          );
        }
      }

      builder = Payments.getInstance({
        nvmApiKey: requireEnv('NVM_API_KEY'),
        environment: 'sandbox',
      });
      subscriber = Payments.getInstance({
        nvmApiKey: requireEnv('NVM_SUBSCRIBER_API_KEY'),
        environment: 'sandbox',
      });

      const readAgent = (await builder.agents.getAgent(AGENT_ID)) as NeverminedAgentReadback;
      const readPlan = (await builder.plans.getPlan(PLAN_ID)) as NeverminedPlanReadback;
      expect(validateNeverminedDocumentDynamicPlan(readAgent, readPlan)).toEqual({ valid: true });
      const registration = await reconcileNeverminedRegistration(makeRegistryClient(builder), {
        agentName: DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.agent_name,
        planName: DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS.plan_name,
        knownAgentId: AGENT_ID,
        knownPlanId: PLAN_ID,
      });
      expect(
        reconcileNeverminedDocumentDynamicRegistration(registration, readAgent, readPlan)
      ).toEqual({ state: 'EXACT_EXISTING', agentId: AGENT_ID, planId: PLAN_ID });

      subscriberAccount = subscriber.getAccountAddress() as Address;
      expect(subscriberAccount).toMatch(/^0x[0-9a-fA-F]{40}$/);
      const methods = await subscriber.delegation.listPaymentMethods({ provider: 'erc4337' });
      const smartAccounts = methods
        .filter((method) => method.provider === 'erc4337')
        .map((method) => method.id as Address);
      expect(smartAccounts).toHaveLength(1);
      subscriberSmartAccount = smartAccounts[0]!;
      expect(subscriberSmartAccount.toLowerCase()).not.toBe(SELLER.toLowerCase());

      const startingBalance = await builder.plans.getPlanBalance(PLAN_ID, subscriberSmartAccount);
      expect(BigInt(startingBalance.balance)).toBe(BigInt(STARTING_BALANCE));
      const payerUsdc = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [subscriberSmartAccount],
      });
      expect(payerUsdc).toBeGreaterThanOrEqual(190_000n);

      // Checkpoint 2I must prove the maximum-cost fixture through the real
      // local worker and canonical pricing before delegation/token/payment
      // mutation is reachable. This is a document-worker preflight, not a
      // paid service execution and does not create a control-plane job.
      if (PARTIAL_BALANCE_RUN) {
        const preflightWorker = new SubprocessDocumentWorkerBridge(WORKER_PYTHON, WORKER_CWD);
        const preflightResult = await preflightWorker.run({
          bytes: FIXTURE_BYTES,
          mediaType: 'application/pdf',
          ocrPolicy: 'if_needed',
          tablePolicy: 'extract',
        });
        expect(preflightResult.status).toBe('success');
        expect(preflightResult.pages).toHaveLength(10);
        expect(preflightResult.pages.every((page) => page.ocr_used)).toBe(true);
        const preflightUsage = calculateDocumentUsage(
          preflightResult.pages.map((page) => ({
            page_number: page.page_number,
            ocr_used: page.ocr_used,
            table_count: page.tables.length,
          }))
        );
        expect(documentUsageToAtomicUnits(preflightUsage, 6)).toBe('190000');
        expect(preflightUsage.capped).toBe(false);
      }

      const delegationListing = await subscriber.delegation.listDelegations({ accessible: true });
      const now = Date.now();
      const usable = delegationListing.delegations.filter(
        (delegation) =>
          delegation.provider === 'erc4337' &&
          delegation.currency.toLowerCase() === 'usdc' &&
          delegation.status.toLowerCase() === 'active' &&
          Number(delegation.remainingBudgetCents) >= DELEGATION_BUDGET_CENTS &&
          hasMinimumDelegationLifetime(delegation.expiresAt, now)
      );
      const exact: typeof usable = [];
      for (const delegation of usable) {
        const read = await fetch(
          `https://api.sandbox.nevermined.app/api/v1/delegation/${encodeURIComponent(delegation.delegationId)}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${requireEnv('NVM_SUBSCRIBER_API_KEY')}`,
              'Nevermined-Version': '1.1',
            },
          }
        );
        if (!read.ok) throw new Error(`delegation_read_http_${read.status}`);
        const body = (await read.json()) as { planId?: string | null };
        if (body.planId === PLAN_ID) exact.push(delegation);
      }
      if (exact.length > 1) throw new Error('multiple exact usable document delegations');
      if (exact.length === 1) {
        delegationId = exact[0]!.delegationId;
      } else {
        try {
          const created = await subscriber.delegation.createDelegation({
            provider: 'erc4337',
            spendingLimitCents: DELEGATION_BUDGET_CENTS,
            durationSecs: 3_600,
            currency: 'usdc',
            planId: PLAN_ID,
          });
          delegationCreateCount += 1;
          delegationId = created.delegationId;
        } catch (error) {
          if (error instanceof PaymentsError) {
            // Bounded public provider error only; no auth material.
            console.error('Document delegation creation failed (sanitized):', {
              code: error.code,
              message: error.message,
            });
          }
          throw error;
        }
      }
      expect(delegationId).toBeTruthy();

      const token = await subscriber.x402.getX402AccessToken(PLAN_ID, AGENT_ID, {
        delegationConfig: { delegationId },
      });
      tokenCount += 1;
      accessToken = token.accessToken;
      expect(accessToken).toBeTruthy();

      const authenticated = NeverminedPaymentEvidenceProvider.authenticated({
        apiKey: requireEnv('NVM_API_KEY'),
        environment: 'sandbox',
        liveGuard: {
          runLiveNevermined: process.env.RUN_LIVE_NEVERMINED,
          apiKeyEnvironment: 'sandbox',
        },
      });
      const countingProvider: PaymentEvidenceProvider = {
        providerKind: 'external',
        async verify(context: PaymentVerificationContext) {
          verifyCount += 1;
          paymentIdBeforeProvider = context.payment_identifier;
          const acquired = await db
            .prepare('SELECT lifecycle_stage FROM payment_attempts WHERE payment_identifier = ?')
            .bind(context.payment_identifier)
            .first<{ lifecycle_stage: string }>();
          d1AcquiredBeforeVerify = acquired?.lifecycle_stage === 'acquired';
          verificationEvidence = await authenticated.verify(context);
          return verificationEvidence;
        },
        async settle(
          context: PaymentSettlementContext,
          acceptedVerification: ExternalVerificationEvidence,
          actualAmount: string
        ) {
          settleCount += 1;
          usageResult = context.usageResult;
          const pending = await db
            .prepare(
              `SELECT pa.lifecycle_stage, pa.settlement_pending_at, sr.result_json
               FROM payment_attempts pa
               JOIN jobs j ON j.idempotency_key = pa.payment_identifier
               JOIN x402_service_results sr ON sr.job_id = j.id
               WHERE pa.payment_identifier = ?`
            )
            .bind(context.payment_identifier)
            .first<{
              lifecycle_stage: string;
              settlement_pending_at: string;
              result_json: string;
            }>();
          const draft = pending
            ? (JSON.parse(pending.result_json) as Record<string, unknown>)
            : null;
          settlementPendingBeforeSettle =
            pending?.lifecycle_stage === 'settlement_pending' &&
            !!pending.settlement_pending_at &&
            draft?.actual_amount === ACTUAL_USAGE &&
            draft?.authorized_maximum === AUTHORIZED_MAXIMUM;

          const base = await authenticated.settle(context, acceptedVerification, actualAmount);
          const observation = readNeverminedSettlementObservation(base);
          if (
            !observation ||
            observation.credits_redeemed !== ACTUAL_USAGE ||
            !/^0x[0-9a-fA-F]{64}$/.test(observation.transaction)
          ) {
            throw new Error('dynamic_credit_settlement_observation_mismatch');
          }
          if (!PARTIAL_BALANCE_RUN && observation.remaining_balance !== '178000') {
            throw new Error('dynamic_credit_settlement_observation_mismatch');
          }
          transactionReceipt = await publicClient.waitForTransactionReceipt({
            hash: observation.transaction as Hash,
            confirmations: 1,
            timeout: 60_000,
          });
          if (transactionReceipt.status !== 'success') {
            throw new Error('document_acquisition_transaction_failed');
          }
          onchainAmounts = transferAmounts(transactionReceipt);
          const finalBalance = await readPlanBalanceEventually(
            builder,
            subscriberSmartAccount,
            observation.remaining_balance === null
              ? undefined
              : BigInt(observation.remaining_balance)
          );
          endingBalance = String(finalBalance.balance);
          if (
            observation.remaining_balance !== null &&
            endingBalance !== observation.remaining_balance
          ) {
            throw new Error('document_credit_balance_mismatch');
          }
          const acquired = BigInt(endingBalance) + BigInt(ACTUAL_USAGE) - BigInt(STARTING_BALANCE);
          const deficit = BigInt(ACTUAL_USAGE) - BigInt(STARTING_BALANCE);
          if (acquired < deficit || acquired < 0n) {
            throw new Error('document_credit_balance_equation_mismatch');
          }
          creditsAcquired = String(acquired);
          if (onchainAmounts.gross !== acquired) {
            throw new Error('document_acquisition_transfer_mismatch');
          }
          if (
            onchainAmounts.payers.length !== 1 ||
            onchainAmounts.seller * 100n !== onchainAmounts.gross * 99n ||
            onchainAmounts.platform * 100n !== onchainAmounts.gross
          ) {
            throw new Error('document_acquisition_split_mismatch');
          }
          const settlementSource = onchainAmounts.payers[0]!;
          const verifiedPayer = acceptedVerification.payer?.toLowerCase();
          if (
            verifiedPayer &&
            settlementSource !== verifiedPayer &&
            !onchainAmounts.transfers.some(
              (transfer) =>
                transfer.from === verifiedPayer &&
                transfer.to === settlementSource &&
                transfer.value === acquired
            )
          ) {
            throw new Error('document_acquisition_payer_trace_mismatch');
          }
          const creditEvidence = await buildNeverminedCreditsSettlementEvidence({
            payment_identifier: context.payment_identifier,
            plan_id: PLAN_ID,
            starting_balance: STARTING_BALANCE,
            credits_acquired: creditsAcquired,
            credits_redeemed: ACTUAL_USAGE,
            usage_value_atomic: ACTUAL_USAGE,
            remaining_balance: endingBalance,
            cash_movement_atomic: String(onchainAmounts.gross),
            transaction: observation.transaction,
            observed_at: new Date().toISOString(),
          });
          expect(
            await validateNeverminedCreditsSettlementEvidence(creditEvidence, {
              payment_identifier: context.payment_identifier,
              plan_id: PLAN_ID,
              authorized_maximum: AUTHORIZED_MAXIMUM,
              actual_usage: ACTUAL_USAGE,
              expected_starting_balance: STARTING_BALANCE,
              expected_acquisition: creditsAcquired,
            })
          ).toEqual({ valid: true });
          const enriched: ExternalSettlementEvidence & {
            nevermined_credits_settlement: unknown;
          } = { ...base, nevermined_credits_settlement: creditEvidence };
          settlementEvidence = enriched;
          return enriched;
        },
      };
      await mountRoute(countingProvider);
    }, 180_000);

    it('executes one bounded document credit lifecycle, reopens durable D1, replays without work, and rejects a conflict', async () => {
      const challenge = await app.request(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(DOCUMENT_INPUT),
      });
      expect(challenge.status).toBe(402);
      const decoded = decodeNeverminedPaymentRequiredHeaderSafe(
        challenge.headers.get('PAYMENT-REQUIRED') ?? ''
      );
      expect(decoded.ok).toBe(true);
      const required = (decoded as { ok: true; value: NeverminedPaymentRequired }).value;
      expect(required.accepts[0]).toMatchObject({
        scheme: 'nvm:erc4337',
        network: NETWORK,
        planId: PLAN_ID,
        extra: { agentId: AGENT_ID },
      });
      expect(required.extensions['net.siteborne.payment']).toMatchObject({
        amount: AUTHORIZED_MAXIMUM,
        semantics: 'upto',
      });

      paymentIdentifier = generateSiteborneePaymentId();
      const response = await app.request(ROUTE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': accessToken,
          [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
          [PAYMENT_DELEGATION_ID_HEADER]: delegationId,
        },
        body: JSON.stringify(DOCUMENT_INPUT),
      });
      const responseBody = (await response.clone().json()) as Record<string, unknown>;
      // eslint-disable-next-line no-console
      console.log(
        PARTIAL_BALANCE_RUN
          ? 'SUN-0900B 2I lifecycle result (sanitized):'
          : 'SUN-0900B 2H lifecycle result (sanitized):',
        {
          status: response.status,
          payment_identifier: paymentIdentifier,
          receipt_id: responseBody.receipt_id,
          link_id: responseBody.link_id,
          transaction: settlementEvidence?.transaction_reference,
        }
      );
      expect(response.status, JSON.stringify(responseBody)).toBe(200);
      expect(responseBody).toMatchObject({
        service_id: SERVICE_ID,
        result_class: 'success',
        authorized_maximum: AUTHORIZED_MAXIMUM,
        actual_amount: ACTUAL_USAGE,
      });
      expect(d1AcquiredBeforeVerify).toBe(true);
      expect(paymentIdBeforeProvider).toBe(paymentIdentifier);
      expect(settlementPendingBeforeSettle).toBe(true);
      expect({ verifyCount, executionCount, settleCount }).toEqual({
        verifyCount: 1,
        executionCount: 1,
        settleCount: 1,
      });
      expect(receiptVerificationCount).toBe(1);
      expect(verificationEvidence).toMatchObject({
        verified: true,
        trust_class: 'external_verified',
      });
      expect(usageResult).toMatchObject({
        actual_amount: ACTUAL_USAGE,
        authorized_maximum: AUTHORIZED_MAXIMUM,
      });
      expect(pcc).toBeTruthy();
      expect(receiptId).toBeTruthy();
      expect(receiptHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(outputHash).toMatch(/^sha256:[a-f0-9]{64}$/);

      const paymentResponse = decodeNeverminedPaymentResponseHeaderSafe(
        response.headers.get('PAYMENT-RESPONSE') ?? ''
      );
      expect(paymentResponse).toMatchObject({
        ok: true,
        value: {
          success: true,
          creditsRedeemed: ACTUAL_USAGE,
          remainingBalance: endingBalance,
        },
      });
      const creditEvidence = (
        settlementEvidence as ExternalSettlementEvidence & {
          nevermined_credits_settlement: unknown;
        }
      ).nevermined_credits_settlement;
      expect(
        await validateNeverminedCreditsSettlementEvidence(creditEvidence, {
          payment_identifier: paymentIdentifier,
          plan_id: PLAN_ID,
          authorized_maximum: AUTHORIZED_MAXIMUM,
          actual_usage: ACTUAL_USAGE,
          expected_starting_balance: STARTING_BALANCE,
          expected_acquisition: creditsAcquired!,
        })
      ).toEqual({ valid: true });

      const attempt = await db
        .prepare(
          `SELECT lifecycle_stage, consumed_at, nevermined_agent_id,
                  nevermined_plan_id, nevermined_delegation_id,
                  settlement_pending_at, settlement_transaction_reference
           FROM payment_attempts WHERE payment_identifier = ?`
        )
        .bind(paymentIdentifier)
        .first<Record<string, unknown>>();
      expect(attempt).toMatchObject({
        lifecycle_stage: 'settled',
        nevermined_agent_id: AGENT_ID,
        nevermined_plan_id: PLAN_ID,
        nevermined_delegation_id: delegationId,
        settlement_transaction_reference: settlementEvidence?.transaction_reference,
      });
      expect(attempt?.consumed_at).toBeTruthy();
      expect(attempt?.settlement_pending_at).toBeTruthy();

      const job = await db
        .prepare('SELECT id, current_state FROM jobs WHERE idempotency_key = ?')
        .bind(paymentIdentifier)
        .first<{ id: string; current_state: string }>();
      expect(job).toBeTruthy();
      jobId = job!.id;
      expect(job!.current_state).toBe('DELIVERED');
      const cachedRow = await db
        .prepare('SELECT result_json FROM x402_service_results WHERE job_id = ?')
        .bind(jobId)
        .first<{ result_json: string }>();
      const cached = JSON.parse(cachedRow!.result_json) as {
        durableEvidence: {
          payment_service_link: PaymentServiceLink;
          settlement_evidence: Record<string, unknown>;
          usage_result: UsageResult;
        };
      };
      expect(await verifyPaymentServiceLink(cached.durableEvidence.payment_service_link)).toEqual({
        valid: true,
      });
      expect(cached.durableEvidence.usage_result.usage_result_hash).toBe(
        usageResult!.usage_result_hash
      );
      expect(cached.durableEvidence.settlement_evidence).toMatchObject({
        nevermined_credits_settlement: {
          cash_movement_atomic: creditsAcquired,
          starting_balance: STARTING_BALANCE,
          credits_acquired: creditsAcquired,
          credits_redeemed: ACTUAL_USAGE,
          remaining_balance: endingBalance,
        },
      });

      const reconciliationClient = NeverminedSandboxReconciliationClient.authenticated({
        apiKey: requireEnv('NVM_API_KEY'),
        liveGuard: {
          runLiveNevermined: process.env.RUN_LIVE_NEVERMINED,
          apiKeyEnvironment: 'sandbox',
        },
      });
      const transactions = await listTransactionsEventually(reconciliationClient, delegationId);
      expect(transactions.transactions).toHaveLength(1);
      expect(transactions.transactions[0]).toMatchObject({
        status: 'succeeded',
        providerTransactionId: settlementEvidence!.transaction_reference,
        currency: 'USDC',
      });
      transactionAmountCents = transactions.transactions[0]!.amountCents;
      expect(transactionReceipt?.transactionHash).toBe(settlementEvidence!.transaction_reference);
      expect(onchainAmounts.gross).toBe(BigInt(creditsAcquired!));
      expect(onchainAmounts.seller * 100n).toBe(onchainAmounts.gross * 99n);
      expect(onchainAmounts.platform * 100n).toBe(onchainAmounts.gross);

      // A genuinely separate child process reopens the persisted Miniflare/D1
      // store with every credential/live variable removed. Only bounded public
      // lifecycle evidence is emitted back to this test.
      await mf!.dispose();
      mf = undefined;
      const childEnv = { ...process.env };
      for (const name of [
        'NVM_API_KEY',
        'NVM_SUBSCRIBER_API_KEY',
        'NVM_ENVIRONMENT',
        'NEVERMINED_API_KEY',
        'RUN_LIVE_NEVERMINED',
        'RUN_LIVE_X402',
        'CDP_API_KEY_ID',
        'CDP_API_KEY_SECRET',
        'CDP_WALLET_SECRET',
      ]) {
        delete childEnv[name];
      }
      const inspection = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '--eval',
            FRESH_PROCESS_INSPECTOR,
            persistencePath,
            paymentIdentifier,
          ],
          { cwd: REPOSITORY_ROOT, env: childEnv, encoding: 'utf8' }
        )
      ) as {
        attempt: Record<string, unknown>;
        job: Record<string, unknown>;
        result: { payment_service_link: PaymentServiceLink; [key: string]: unknown };
      };
      expect(inspection.attempt).toMatchObject({
        lifecycle_stage: 'settled',
        consumed_at: expect.any(String),
        amount: AUTHORIZED_MAXIMUM,
        nevermined_agent_id: AGENT_ID,
        nevermined_plan_id: PLAN_ID,
        nevermined_delegation_id: delegationId,
      });
      expect(inspection.job).toMatchObject({ id: jobId, current_state: 'DELIVERED' });
      expect(inspection.result).toMatchObject({
        status: 200,
        receipt_id: receiptId,
        usage_actual: ACTUAL_USAGE,
        usage_maximum: AUTHORIZED_MAXIMUM,
        usage_hash: usageResult!.usage_result_hash,
        pcc_present: true,
        receipt_present: true,
        credits_redeemed: ACTUAL_USAGE,
        remaining_balance: endingBalance,
        cash_movement_atomic: creditsAcquired,
      });
      expect(await verifyPaymentServiceLink(inspection.result.payment_service_link)).toEqual({
        valid: true,
      });

      await openPersistentD1();
      await mountRoute({
        providerKind: 'external',
        async verify() {
          throw new Error('replay_must_not_verify');
        },
        async settle() {
          throw new Error('replay_must_not_settle');
        },
      });
      const beforeReplay = { verifyCount, executionCount, settleCount };
      const replay = await app.request(ROUTE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': accessToken,
          [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
          [PAYMENT_DELEGATION_ID_HEADER]: delegationId,
        },
        body: JSON.stringify(DOCUMENT_INPUT),
      });
      expect(replay.status).toBe(200);
      const replayBody = (await replay.json()) as Record<string, unknown>;
      expect(replayBody).toMatchObject({
        receipt_id: receiptId,
        link_id: inspection.result.link_id,
        link_hash: inspection.result.link_hash,
        actual_amount: ACTUAL_USAGE,
      });
      expect({ verifyCount, executionCount, settleCount }).toEqual(beforeReplay);

      const changedInput = PARTIAL_BALANCE_RUN
        ? { ...DOCUMENT_INPUT, ocr_permission: false }
        : {
            artifact_reference: { ...DOCUMENT_INPUT.artifact_reference, size_bytes: 2 },
          };
      expect(
        (
          await app.request(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(changedInput),
          })
        ).status
      ).toBe(402);
      const conflict = await app.request(ROUTE, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': accessToken,
          [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
          [PAYMENT_DELEGATION_ID_HEADER]: delegationId,
        },
        body: JSON.stringify(changedInput),
      });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ error: 'replay_conflict' });
      expect({ verifyCount, executionCount, settleCount }).toEqual(beforeReplay);

      const finalJobCount = await db
        .prepare('SELECT COUNT(*) AS count FROM jobs WHERE idempotency_key = ?')
        .bind(paymentIdentifier)
        .first<{ count: number }>();
      expect(finalJobCount?.count).toBe(1);
      const finalAgent = (await builder.agents.getAgent(AGENT_ID)) as NeverminedAgentReadback;
      const finalPlan = (await builder.plans.getPlan(PLAN_ID)) as NeverminedPlanReadback;
      expect(validateNeverminedDocumentDynamicPlan(finalAgent, finalPlan)).toEqual({ valid: true });

      // eslint-disable-next-line no-console
      console.log(
        PARTIAL_BALANCE_RUN
          ? 'SUN-0900B 2I COMPLETE (sanitized):'
          : 'SUN-0900B 2H COMPLETE (sanitized):',
        {
          agent_id: AGENT_ID,
          plan_id: PLAN_ID,
          delegation_id: delegationId,
          payment_identifier: paymentIdentifier,
          corrected_input_hash: inspection.attempt.request_input_hash,
          job_id: jobId,
          transaction_hash: settlementEvidence!.transaction_reference,
          cash_movement_atomic: String(onchainAmounts.gross),
          seller_atomic: String(onchainAmounts.seller),
          platform_atomic: String(onchainAmounts.platform),
          starting_credits: STARTING_BALANCE,
          credits_acquired: creditsAcquired,
          credits_redeemed: ACTUAL_USAGE,
          remaining_credits: endingBalance,
          transaction_amount_cents: transactionAmountCents,
          verify_count: verifyCount,
          execute_count: executionCount,
          settle_count: settleCount,
          delegation_creations: delegationCreateCount,
          token_creations: tokenCount,
          replay_additional_work: 0,
          registration_mutations: 0,
        }
      );
    }, 300_000);
  }
);
