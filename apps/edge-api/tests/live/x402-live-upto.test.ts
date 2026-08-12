/**
 * SUN-0700B checkpoint 2 — guarded real Base Sepolia `upto` proof.
 *
 * Normal `pnpm test`, `pnpm check`, and CI collect this file but skip its
 * suite unless RUN_LIVE_X402=1. The only selectable network is the hardcoded
 * Base Sepolia CAIP-2 identifier below. Secret environment variables are
 * checked for presence and otherwise left entirely to the official CDP SDK.
 * This file never logs a payment signature, authorization, credential, RPC
 * URL, or facilitator response body.
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { CdpClient } from '@coinbase/cdp-sdk';
import {
  createCdpFacilitatorClient,
  fromCdpEvmAccount,
  getDefaultEvmRpcUrls,
} from '@coinbase/cdp-sdk/x402';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import {
  UptoEvmScheme,
  createPermit2ApprovalTx,
  getPermit2AllowanceReadParams,
} from '@x402/evm/upto/client';
import { getDefaultAsset } from '@x402/evm';
import { baseSepolia } from 'viem/chains';
import { createPublicClient, http } from 'viem';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  decodePaymentResponseHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  generateSiteborneePaymentId,
  hashPaymentObject,
  type ExternalSettlementEvidence,
  type ExternalVerificationEvidence,
  type PaymentEvidenceProvider,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentSettlementContext,
  type PaymentVerificationContext,
  type UsageResult,
} from '@siteborne/protocol-x402';
import {
  calculateDocumentUsage,
  documentUsageToAtomicUnits,
  resolvePricingSourceVersion,
  resolveServiceMaxPriceUsd,
  usdToMicro,
} from '@siteborne/pricing';
import {
  FixtureDocumentWorkerBridge,
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
import { buildPaidServicesApp } from '../../src/control-plane/routes/paid-services';
import { createX402ServiceRoute } from '../../src/control-plane/routes/x402-service';
import type { ExecutorOutcome } from '../../src/control-plane/routes/x402-service';
import {
  CdpPaymentEvidenceProvider,
  checkCdpSupportsNetwork,
} from '../../src/control-plane/evidence/cdp-provider';

const RUN_LIVE = process.env.RUN_LIVE_X402 === '1';
const NETWORK = 'eip155:84532' as const;
const CDP_NETWORK = 'base-sepolia' as const;
const REQUIRED_SCHEMES = ['exact', 'upto'];
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BUYER_ADDRESS = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';
const SELLER_ADDRESS = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const ASSET_INFO = getDefaultAsset(NETWORK);
const DOCUMENT_WORKER_RESULT = DOCUMENT_WORKER_RESULT_JSON as unknown as WorkerResult;
const FIXTURE_ARTIFACT_ID = 'doc/native-fixture.pdf';
const FIXTURE_BYTES = registerFixtureScenario(new Uint8Array([9]), 'x402-live-upto-native');
const DOCUMENT_INPUT = {
  artifact_reference: {
    artifact_id: FIXTURE_ARTIFACT_ID,
    media_type: 'application/pdf',
    size_bytes: FIXTURE_BYTES.length,
  },
};
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations', import.meta.url));

function requireEnvPresent(name: string): void {
  if (!process.env[name]) {
    throw new Error(`SUN-0700B live upto: required environment variable "${name}" is not set`);
  }
}

async function runMigrations(db: D1Database): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
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
      .filter((statement) => statement.length > 0);
    for (const statement of statements) await db.exec(statement);
  }
}

describe.skipIf(!RUN_LIVE)(
  'SUN-0700B checkpoint 2 — live Base Sepolia upto settlement (real CDP facilitator)',
  () => {
    let miniflare: Miniflare | undefined;
    let db: D1Database;
    let facilitator: HTTPFacilitatorClient;
    let paymentClient: x402HTTPClient;
    let rpcUrl: string;
    let supportedResult: Awaited<ReturnType<typeof checkCdpSupportsNetwork>>;
    let buyerAccount: Awaited<ReturnType<CdpClient['evm']['getAccount']>>;

    beforeAll(async () => {
      for (const name of [
        'CDP_API_KEY_ID',
        'CDP_API_KEY_SECRET',
        'CDP_WALLET_SECRET',
        'SELLER_WALLET_ADDRESS',
        'RUN_LIVE_X402',
      ]) {
        requireEnvPresent(name);
      }
      if (NETWORK !== 'eip155:84532') throw new Error('live upto network guard failed');
      if (ASSET_INFO.address.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) {
        throw new Error('official x402 Base Sepolia asset differs from the approved USDC asset');
      }
      if (process.env.SELLER_WALLET_ADDRESS!.toLowerCase() !== SELLER_ADDRESS.toLowerCase()) {
        throw new Error('SELLER_WALLET_ADDRESS differs from the approved Base Sepolia seller');
      }

      // The first external call is always authenticated `/supported`.
      facilitator = createCdpFacilitatorClient();
      supportedResult = await checkCdpSupportsNetwork(facilitator, NETWORK, REQUIRED_SCHEMES);
      if (!supportedResult.ok || !supportedResult.uptoFacilitatorAddress) {
        throw new Error(`SUN-0700B live upto preflight rejected: ${supportedResult.reason}`);
      }

      const rpcByNetwork = await getDefaultEvmRpcUrls();
      // CDP's project-node resolver is optional and may return no entry when
      // project-node access is not provisioned. In that case use viem's
      // bundled Base Sepolia public transport for allowance reads and public
      // receipt confirmation; signing still stays entirely in the CDP wallet.
      const resolvedRpcUrl = rpcByNetwork[NETWORK]?.rpcUrl ?? baseSepolia.rpcUrls.default.http[0];
      rpcUrl = resolvedRpcUrl;

      const tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-x402-live-upto-'));
      miniflare = new Miniflare({
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
      db = await miniflare.getD1Database('DB');
      await db.exec('PRAGMA foreign_keys = ON');
      await runMigrations(db);
      await buildPaidServicesApp({
        db,
        evidenceMode: 'fixture',
        clock: () => new Date().toISOString(),
      });

      const cdp = new CdpClient();
      buyerAccount = await cdp.evm.getAccount({ address: BUYER_ADDRESS });
      expect(buyerAccount.address.toLowerCase()).toBe(BUYER_ADDRESS.toLowerCase());
      const signer = fromCdpEvmAccount(buyerAccount);
      const client = new x402Client();
      client.register(NETWORK, new UptoEvmScheme(signer, { rpcUrl }));
      paymentClient = new x402HTTPClient(client);
    }, 90_000);

    afterAll(async () => {
      await miniflare?.dispose();
    });

    it('preflight: sanitized supported capabilities include Base Sepolia exact and upto', () => {
      const safeKinds = supportedResult.kinds.filter(
        (kind) => kind.network === NETWORK && REQUIRED_SCHEMES.includes(kind.scheme)
      );
      // eslint-disable-next-line no-console
      console.log('CDP /supported checkpoint-2 (sanitized):', { kinds: safeKinds });
      expect(supportedResult.ok, supportedResult.reason).toBe(true);
      expect(safeKinds).toEqual(
        expect.arrayContaining([
          { network: NETWORK, scheme: 'exact' },
          { network: NETWORK, scheme: 'upto' },
        ])
      );
    });

    async function ensurePermit2Allowance(authorizedMaximum: string): Promise<string | undefined> {
      const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
      const params = getPermit2AllowanceReadParams({
        tokenAddress: BASE_SEPOLIA_USDC,
        ownerAddress: BUYER_ADDRESS,
      });
      const allowance = await publicClient.readContract(params);
      if (allowance >= BigInt(authorizedMaximum)) return undefined;
      const account = await buyerAccount.useNetwork(CDP_NETWORK);
      const approval = createPermit2ApprovalTx(BASE_SEPOLIA_USDC);
      const sent = await account.sendTransaction({ transaction: approval });
      const receipt = await account.waitForTransactionReceipt(sent);
      if (receipt.status !== 'success') throw new Error('Base Sepolia Permit2 approval failed');
      const confirmedAllowance = await publicClient.readContract(params);
      if (confirmedAllowance < BigInt(authorizedMaximum)) {
        throw new Error('Permit2 allowance remains below the canonical upto maximum');
      }
      return sent.transactionHash;
    }

    async function mountRoute() {
      const app = new Hono();
      const { signer, registry: keyRegistry } = await createFixtureSigner();
      const provider = new CdpPaymentEvidenceProvider(facilitator);
      let executionCount = 0;
      let verifyCount = 0;
      let settlementCount = 0;
      let receiptVerificationCount = 0;
      let receiptVerificationValid = false;
      let verificationEvidence: ExternalVerificationEvidence | undefined;
      let settlementEvidence: ExternalSettlementEvidence | undefined;
      let usageResult: UsageResult | undefined;
      let outputHash: string | undefined;
      let receiptHash: string | undefined;
      let receiptId: string | undefined;
      let resourceMetrics: Record<string, unknown> | undefined;
      let pccVerification: Record<string, unknown> | undefined;

      const countingProvider: PaymentEvidenceProvider = {
        providerKind: 'external',
        async verify(context: PaymentVerificationContext) {
          verifyCount += 1;
          verificationEvidence = await provider.verify(context);
          return verificationEvidence;
        },
        async settle(
          context: PaymentSettlementContext,
          acceptedVerification: ExternalVerificationEvidence,
          actualAmount: string
        ) {
          settlementCount += 1;
          usageResult = context.usageResult;
          settlementEvidence = await provider.settle(context, acceptedVerification, actualAmount);
          return settlementEvidence;
        },
      };

      createX402ServiceRoute(app, {
        serviceId: 'document_evidence_json.v1',
        scheme: 'upto',
        pricingKey: 'document_evidence_json_max_job',
        network: NETWORK,
        asset: BASE_SEPOLIA_USDC,
        paymentRequirementExtra: {
          name: ASSET_INFO.name,
          version: ASSET_INFO.version,
          facilitatorAddress: supportedResult.uptoFacilitatorAddress!,
          ...(ASSET_INFO.assetTransferMethod
            ? { assetTransferMethod: ASSET_INFO.assetTransferMethod }
            : {}),
        },
        path: '/v1/document/evidence-json',
        inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['document_evidence_json.v1'] as Record<
          string,
          unknown
        >,
        contractRelease: '1.0.0',
        inputSchemaHash: 'sha256:19e64c92f088ed8b7a45eef561c5426bb59ce5cc3576b85482aded4f620e57ba',
        outputSchemaHash: 'sha256:dfe39d56227803c9e743e7b67da4853a16f76a1a4f3de66b2eb43213b92377ed',
        pccDependency: '1.0.0',
        db,
        clock: () => new Date().toISOString(),
        payTo: SELLER_ADDRESS,
        evidenceMode: 'production',
        evidenceProvider: countingProvider,
        executor: async (input): Promise<ExecutorOutcome> => {
          executionCount += 1;
          const context = buildServiceContext('document_evidence_json.v1', {
            clock: createTestClock(),
            artifact_store: createTestArtifactStore(),
            audit: createTestServiceAuditSink(),
            execution_mode: 'fixture',
          });
          await context.artifact_store.put(
            {
              id: FIXTURE_ARTIFACT_ID,
              contentHash: DOCUMENT_WORKER_RESULT.document!.sha256,
              media_type: 'application/pdf',
              byte_length: FIXTURE_BYTES.length,
            },
            FIXTURE_BYTES
          );
          const worker = new FixtureDocumentWorkerBridge(
            new Map([['x402-live-upto-native', DOCUMENT_WORKER_RESULT]])
          );
          const registry = buildFixtureRegistry({
            httpClient: {
              async fetch() {
                return new Response('{}');
              },
            },
            context,
            worker,
            signer,
            keyRegistry,
          });
          const result = await executeLocalService(
            registry,
            'document_evidence_json.v1',
            input,
            context
          );
          if (!result.receipt || !result.receipt_id || !result.output_hash) {
            throw new Error('document fixture did not produce a signed receipt');
          }
          const receiptCheck = await verifyServiceReceipt({
            receipt: result.receipt as VerificationReceipt,
            keyRegistry,
            expectedServiceId: 'document_evidence_json.v1',
            expectedOutputHash: result.output_hash,
          });
          receiptVerificationCount += 1;
          receiptVerificationValid = receiptCheck.valid;
          if (!receiptCheck.valid) throw new Error('SITEBORNE receipt self-verification failed');

          const usage = calculateDocumentUsage(
            DOCUMENT_WORKER_RESULT.pages.map((page) => ({
              page_number: page.page_number,
              ocr_used: page.ocr_used,
              table_count: page.tables.length,
            }))
          );
          resourceMetrics = {
            page_count: DOCUMENT_WORKER_RESULT.pages.length,
            pages: DOCUMENT_WORKER_RESULT.pages.map((page) => ({
              page_number: page.page_number,
              ocr_used: page.ocr_used,
              table_count: page.tables.length,
            })),
            page_costs: usage.page_costs,
            subtotal_usd_micro: usage.subtotal_usd_micro,
            max_job_usd_micro: usage.max_job_usd_micro,
            total_usd_micro: usage.total_usd_micro,
            capped: usage.capped,
          };
          outputHash = result.output_hash;
          receiptId = result.receipt_id;
          receiptHash = await hashPaymentObject(
            result.receipt as unknown as Record<string, unknown>
          );
          pccVerification = result.verification as unknown as Record<string, unknown>;
          return {
            result,
            actualAmountAtomic: documentUsageToAtomicUnits(usage, 6),
            resourceMetrics,
          };
        },
      });

      return {
        app,
        evidence: () => ({
          executionCount,
          verifyCount,
          settlementCount,
          receiptVerificationCount,
          receiptVerificationValid,
          verificationEvidence,
          settlementEvidence,
          usageResult,
          outputHash,
          receiptHash,
          receiptId,
          resourceMetrics,
          pccVerification,
        }),
      };
    }

    it('real upto: 402 -> maximum authorization -> /verify -> one document execution -> actual /settle -> 200; replay is reconstructed', async () => {
      const { app, evidence } = await mountRoute();
      const challengeResponse = await app.request('/v1/document/evidence-json', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(DOCUMENT_INPUT),
      });
      expect(challengeResponse.status).toBe(402);
      expect(evidence().executionCount).toBe(0);
      const decodedRequired = decodePaymentRequiredHeaderSafe(
        challengeResponse.headers.get('PAYMENT-REQUIRED')!
      );
      if (!decodedRequired.ok)
        throw new Error(`malformed PAYMENT-REQUIRED: ${decodedRequired.reason}`);
      const challenge: PaymentRequired = decodedRequired.value;
      const requirement = challenge.accepts[0]!;
      const authorizedMaximum = String(
        usdToMicro(resolveServiceMaxPriceUsd('document_evidence_json_max_job'))
      );
      expect(requirement).toMatchObject({
        scheme: 'upto',
        network: NETWORK,
        asset: BASE_SEPOLIA_USDC,
        payTo: SELLER_ADDRESS,
        amount: authorizedMaximum,
      });
      expect(requirement.extra?.facilitatorAddress).toBe(supportedResult.uptoFacilitatorAddress);

      const approvalTransaction = await ensurePermit2Allowance(authorizedMaximum);
      const paymentIdentifier = generateSiteborneePaymentId();
      const paymentRequired: PaymentRequired = {
        ...challenge,
        extensions: buildBuyerPaymentIdentifierExtensions(
          challenge.extensions ?? {},
          paymentIdentifier
        ),
      };
      const paymentPayload: PaymentPayload =
        await paymentClient.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.amount).toBe(authorizedMaximum);
      const paymentSignature = encodePaymentSignatureHeaderSafe(paymentPayload);

      const paidResponse = await app.request('/v1/document/evidence-json', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': paymentSignature },
        body: JSON.stringify(DOCUMENT_INPUT),
      });
      const responseBody = (await paidResponse.clone().json()) as Record<string, unknown>;
      expect(paidResponse.status, JSON.stringify(responseBody)).toBe(200);
      const first = evidence();
      expect(first.executionCount).toBe(1);
      expect(first.verifyCount).toBe(1);
      expect(first.settlementCount).toBe(1);
      expect(first.receiptVerificationCount).toBe(1);
      expect(first.receiptVerificationValid).toBe(true);
      expect(first.pccVerification).toMatchObject({ decision: 'pass' });
      expect(first.verificationEvidence?.verified).toBe(true);
      expect(first.verificationEvidence?.trust_class).toBe('external_verified');
      expect(first.settlementEvidence?.success).toBe(true);
      expect(first.settlementEvidence?.trust_class).toBe('external_verified');
      expect(first.usageResult).toBeDefined();

      const actualAmount = first.usageResult!.actual_amount;
      expect(BigInt(actualAmount)).toBeLessThan(BigInt(authorizedMaximum));
      expect(responseBody).toMatchObject({
        authorized_maximum: authorizedMaximum,
        actual_amount: actualAmount,
      });
      expect(first.settlementEvidence?.actual_amount).toBe(actualAmount);
      expect(first.settlementEvidence?.authorized_maximum).toBe(authorizedMaximum);

      const paymentResponseHeader = paidResponse.headers.get('PAYMENT-RESPONSE');
      expect(paymentResponseHeader).toBeTruthy();
      const decodedSettlement = decodePaymentResponseHeaderSafe(paymentResponseHeader!);
      if (!decodedSettlement.ok) {
        throw new Error(`malformed PAYMENT-RESPONSE: ${decodedSettlement.reason}`);
      }
      expect(decodedSettlement.value).toMatchObject({
        success: true,
        network: NETWORK,
        amount: actualAmount,
      });
      expect(decodedSettlement.value.payer?.toLowerCase()).toBe(BUYER_ADDRESS.toLowerCase());
      expect(decodedSettlement.value.transaction).toMatch(/^0x[0-9a-fA-F]{64}$/);

      const confirmationClient = createPublicClient({
        chain: baseSepolia,
        transport: http(rpcUrl),
      });
      const chainReceipt = await confirmationClient.waitForTransactionReceipt({
        hash: decodedSettlement.value.transaction as `0x${string}`,
      });
      expect(chainReceipt.status).toBe('success');

      const replayResponse = await app.request('/v1/document/evidence-json', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': paymentSignature },
        body: JSON.stringify(DOCUMENT_INPUT),
      });
      const replayBody = (await replayResponse.clone().json()) as Record<string, unknown>;
      expect(replayResponse.status).toBe(200);
      expect(replayBody.link_id).toBe(responseBody.link_id);
      expect(replayBody.receipt_id).toBe(responseBody.receipt_id);
      expect(replayResponse.headers.get('PAYMENT-RESPONSE')).toBe(paymentResponseHeader);
      const final = evidence();
      expect(final.executionCount).toBe(1);
      expect(final.verifyCount).toBe(1);
      expect(final.settlementCount).toBe(1);

      const logicalJobs = await db
        .prepare('SELECT COUNT(*) AS count FROM jobs WHERE idempotency_key = ?')
        .bind(paymentIdentifier)
        .first<{ count: number }>();
      expect(Number(logicalJobs?.count ?? 0)).toBe(1);
      const logicalJob = await db
        .prepare('SELECT id FROM jobs WHERE idempotency_key = ?')
        .bind(paymentIdentifier)
        .first<{ id: string }>();
      const verificationEvidenceHash = await hashPaymentObject(final.verificationEvidence!);
      const settlementEvidenceHash = await hashPaymentObject(final.settlementEvidence!);

      // Public and sanitized only. `paymentSignature`, paymentPayload payload,
      // RPC URL, credentials, and raw facilitator data never leave memory.
      // eslint-disable-next-line no-console
      console.log('SUN-0700B checkpoint-2 evidence (sanitized):', {
        network: NETWORK,
        scheme: 'upto',
        service_id: 'document_evidence_json.v1',
        service_version: 'v1',
        pricing_source_version: resolvePricingSourceVersion(),
        quote_id: final.verificationEvidence!.quote_id,
        requirement_id: final.verificationEvidence!.requirement_id,
        payment_identifier: paymentIdentifier,
        buyer: final.verificationEvidence!.payer,
        seller: SELLER_ADDRESS,
        authorized_maximum_atomic: authorizedMaximum,
        actual_amount_atomic: actualAmount,
        settled_amount_atomic: decodedSettlement.value.amount,
        verify_success: final.verificationEvidence!.verified,
        verification_evidence_hash: verificationEvidenceHash,
        service_job_id: logicalJob?.id,
        resource_metrics: final.resourceMetrics,
        output_hash: final.outputHash,
        pcc_verification: final.pccVerification,
        receipt_id: final.receiptId,
        receipt_hash: final.receiptHash,
        receipt_self_verification: final.receiptVerificationValid,
        usage_result_id: final.usageResult!.usage_result_id,
        usage_result_hash: final.usageResult!.usage_result_hash,
        settle_success: final.settlementEvidence!.success,
        transaction: decodedSettlement.value.transaction,
        settlement_evidence_hash: settlementEvidenceHash,
        payment_service_link_id: responseBody.link_id,
        payment_service_link_hash: responseBody.link_hash,
        permit2_approval_transaction: approvalTransaction ?? 'preexisting_allowance',
        http_status: paidResponse.status,
        replay_http_status: replayResponse.status,
        service_execution_count: final.executionCount,
        facilitator_verify_count: final.verifyCount,
        facilitator_settle_count: final.settlementCount,
        logical_job_count: Number(logicalJobs?.count ?? 0),
      });
    }, 180_000);
  }
);
