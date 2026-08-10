/**
 * SUN-0700B checkpoint 1 — the ONLY test file in this repository that
 * calls a real CDP facilitator or touches Base Sepolia. Gated so it is a
 * no-op (zero network calls, zero credential reads beyond presence) in
 * every normal `pnpm test`/`pnpm check`/CI run:
 *
 *   describe.skipIf(process.env.RUN_LIVE_X402 !== '1')
 *
 * Requires, in the process environment (never read for their VALUES by
 * this file except to hand them opaquely to the official CDP SDK, which
 * itself resolves CDP_API_KEY_ID/CDP_API_KEY_SECRET/CDP_WALLET_SECRET
 * from the environment — this file never touches those three values
 * directly):
 *   RUN_LIVE_X402=1
 *   CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET (secret)
 *   SELLER_WALLET_ADDRESS (public payTo)
 *
 * Network: eip155:84532 (Base Sepolia) only. Never mainnet — nothing in
 * this file can select eip155:8453; the network is a single hardcoded
 * testnet constant.
 *
 * Uses the cheapest accepted `exact`-scheme service
 * (web_context_verified.v1, $0.009, governance/RISK_LIMITS.yaml) with
 * its existing fixture-mode executor (SUN-0700A) — this checkpoint tests
 * the PAYMENT layer against a real facilitator, not service execution
 * against real live web adapters, which remains out of scope here.
 * `upto` is deliberately not exercised (next checkpoint).
 */
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { CdpClient } from '@coinbase/cdp-sdk';
import { createCdpFacilitatorClient, fromCdpEvmAccount } from '@coinbase/cdp-sdk/x402';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { getDefaultAsset } from '@x402/evm';
import type { HTTPFacilitatorClient } from '@x402/core/server';
import type {
  ExternalSettlementEvidence,
  ExternalVerificationEvidence,
  PaymentEvidenceProvider,
  PaymentPayload,
  PaymentRequired,
  PaymentSettlementContext,
  PaymentVerificationContext,
} from '@siteborne/protocol-x402';
import type { VerificationReceipt } from '@siteborne/verification';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentResponseHeaderSafe,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  generateSiteborneePaymentId,
  hashPaymentObject,
} from '@siteborne/protocol-x402';
import {
  FixtureDocumentWorkerBridge,
  buildFixtureRegistry,
  buildServiceContext,
  createFixtureSigner,
  createTestArtifactStore,
  createTestClock,
  createTestServiceAuditSink,
  executeLocalService,
  verifyServiceReceipt,
} from '@siteborne/service-runtime';
import { createX402ServiceRoute } from '../../src/control-plane/routes/x402-service';
import type { ExecutorOutcome } from '../../src/control-plane/routes/x402-service';
import { buildPaidServicesApp } from '../../src/control-plane/routes/paid-services';
import {
  CdpPaymentEvidenceProvider,
  checkCdpSupportsNetwork,
} from '../../src/control-plane/evidence/cdp-provider';

const RUN_LIVE = process.env.RUN_LIVE_X402 === '1';

// Public test configuration (directive-supplied, not secret).
const NETWORK = 'eip155:84532' as const; // Base Sepolia. Never eip155:8453.
const REQUIRED_SCHEMES = ['exact', 'upto'];
// Circle's canonical Base Sepolia USDC deployment (6 decimals).
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BUYER_ADDRESS = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';
const SELLER_ADDRESS = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1';
const BASE_SEPOLIA_ASSET_INFO = getDefaultAsset(NETWORK);

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations', import.meta.url));

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

/** Presence-only — throws naming the missing variable, never a value. */
function requireEnvPresent(name: string): void {
  if (!process.env[name]) {
    throw new Error(`SUN-0700B live test: required environment variable "${name}" is not set`);
  }
}

describe.skipIf(!RUN_LIVE)(
  'SUN-0700B checkpoint 1 — live Base Sepolia exact settlement (real CDP facilitator)',
  () => {
    let tempDir: string;
    let mf: Miniflare;
    let db: D1Database;
    let facilitator: HTTPFacilitatorClient;
    let httpClient: x402HTTPClient;
    let supportedResult: Awaited<ReturnType<typeof checkCdpSupportsNetwork>>;
    const clockValue = () => new Date().toISOString();

    beforeAll(async () => {
      requireEnvPresent('CDP_API_KEY_ID');
      requireEnvPresent('CDP_API_KEY_SECRET');
      requireEnvPresent('CDP_WALLET_SECRET');
      requireEnvPresent('SELLER_WALLET_ADDRESS');
      if (BASE_SEPOLIA_ASSET_INFO.address.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) {
        throw new Error(
          'SUN-0700B live test: official x402 Base Sepolia asset does not match the approved asset'
        );
      }
      if (process.env.SELLER_WALLET_ADDRESS!.toLowerCase() !== SELLER_ADDRESS.toLowerCase()) {
        throw new Error(
          'SUN-0700B live test: SELLER_WALLET_ADDRESS does not match the approved Base Sepolia seller'
        );
      }

      // The first network call in every fresh live run is authenticated
      // `/supported`. Stop before buyer-account lookup or payment signing
      // unless both required Base Sepolia schemes are advertised.
      facilitator = createCdpFacilitatorClient();
      supportedResult = await checkCdpSupportsNetwork(facilitator, NETWORK, REQUIRED_SCHEMES);
      if (!supportedResult.ok) {
        throw new Error(`SUN-0700B live preflight rejected: ${supportedResult.reason}`);
      }

      tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-x402-live-'));
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
      // Seed the four frozen services (FK requirement) — same seeding
      // buildPaidServicesApp always does; this test mounts its own
      // routes on a bare Hono app with real testnet network/asset/payTo,
      // never the mainnet-labeled placeholder wiring in paid-services.ts.
      await buildPaidServicesApp({ db, evidenceMode: 'fixture', clock: clockValue });

      // Buyer side: the existing, controlled CDP EVM account — fetched
      // by its known address, never created fresh, never exporting its
      // private key. CdpClient() resolves CDP_API_KEY_ID/SECRET/
      // WALLET_SECRET from the environment itself.
      const cdp = new CdpClient();
      const buyerAccount = await cdp.evm.getAccount({ address: BUYER_ADDRESS });
      expect(buyerAccount.address.toLowerCase()).toBe(BUYER_ADDRESS.toLowerCase());
      const signer = fromCdpEvmAccount(buyerAccount);
      const client = new x402Client();
      registerExactEvmScheme(client, { signer, networks: [NETWORK] });
      httpClient = new x402HTTPClient(client);
    }, 60_000);

    afterAll(async () => {
      await mf.dispose();
    });

    it('step 1: /supported reports eip155:84532 support for both exact and upto', () => {
      const baseSepoliaKinds = supportedResult.kinds.filter(
        (kind) => kind.network === NETWORK && REQUIRED_SCHEMES.includes(kind.scheme)
      );
      // Sanitized only: scheme/network pairs, no credentials, no raw
      // facilitator response.
      // eslint-disable-next-line no-console
      console.log('CDP /supported (sanitized):', JSON.stringify(baseSepoliaKinds));
      expect(supportedResult.ok, supportedResult.reason).toBe(true);
    });

    function freshContext() {
      return buildServiceContext('web_context_verified.v1', {
        clock: createTestClock(),
        artifact_store: createTestArtifactStore(),
        audit: createTestServiceAuditSink(),
        execution_mode: 'fixture',
      });
    }

    async function mountLiveRoute(
      evidenceProvider: PaymentEvidenceProvider = new CdpPaymentEvidenceProvider(facilitator)
    ) {
      const app = new Hono();
      const { signer, registry: keyRegistry } = await createFixtureSigner();
      let executionCount = 0;
      let verifyCount = 0;
      let settlementCount = 0;
      let receiptVerificationCount = 0;
      let receiptVerificationValid = false;
      let verificationEvidence: ExternalVerificationEvidence | undefined;
      let settlementEvidence: ExternalSettlementEvidence | undefined;
      let serviceOutputHash: string | undefined;
      let serviceReceiptHash: string | undefined;
      const countingProvider: PaymentEvidenceProvider = {
        providerKind: 'external',
        async verify(context: PaymentVerificationContext) {
          verifyCount += 1;
          verificationEvidence = await evidenceProvider.verify(context);
          return verificationEvidence;
        },
        async settle(context: PaymentSettlementContext, verificationEvidence, actualAmount) {
          settlementCount += 1;
          settlementEvidence = await evidenceProvider.settle(
            context,
            verificationEvidence,
            actualAmount
          );
          return settlementEvidence;
        },
      };
      createX402ServiceRoute(app, {
        serviceId: 'web_context_verified.v1',
        scheme: 'exact',
        pricingKey: 'web_context_verified_direct',
        network: NETWORK,
        asset: BASE_SEPOLIA_USDC,
        paymentRequirementExtra: {
          name: BASE_SEPOLIA_ASSET_INFO.name,
          version: BASE_SEPOLIA_ASSET_INFO.version,
          ...(BASE_SEPOLIA_ASSET_INFO.assetTransferMethod
            ? { assetTransferMethod: BASE_SEPOLIA_ASSET_INFO.assetTransferMethod }
            : {}),
        },
        path: '/v1/web/context',
        inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['web_context_verified.v1'] as Record<
          string,
          unknown
        >,
        contractRelease: '1.0.0',
        inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
        outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
        pccDependency: '1.0.0',
        db,
        clock: clockValue,
        payTo: SELLER_ADDRESS,
        evidenceMode: 'production',
        evidenceProvider: countingProvider,
        executor: async (input): Promise<ExecutorOutcome> => {
          executionCount += 1;
          const context = freshContext();
          const httpClientFixture = {
            async fetch() {
              return new Response(
                '<html><head><title>Fixture Page</title></head><body>hello</body></html>',
                { status: 200, headers: { 'content-type': 'text/html' } }
              );
            },
          };
          const registry = buildFixtureRegistry({
            httpClient: httpClientFixture,
            context,
            worker: new FixtureDocumentWorkerBridge(new Map()),
            signer,
            keyRegistry,
          });
          const result = await executeLocalService(
            registry,
            'web_context_verified.v1',
            input,
            context
          );
          if (!result.receipt || !result.output_hash) {
            throw new Error('SUN-0700B live service did not produce a verifiable receipt');
          }
          const receiptCheck = await verifyServiceReceipt({
            receipt: result.receipt as VerificationReceipt,
            keyRegistry,
            expectedServiceId: 'web_context_verified.v1',
            expectedOutputHash: result.output_hash,
          });
          receiptVerificationCount += 1;
          receiptVerificationValid = receiptCheck.valid;
          if (!receiptCheck.valid) {
            throw new Error(
              'SUN-0700B live service receipt failed cryptographic self-verification'
            );
          }
          serviceOutputHash = result.output_hash;
          serviceReceiptHash = await hashPaymentObject(
            result.receipt as unknown as Record<string, unknown>
          );
          return { result };
        },
      });
      return {
        app,
        getExecutionCount: () => executionCount,
        getVerifyCount: () => verifyCount,
        getSettlementCount: () => settlementCount,
        getReceiptVerificationCount: () => receiptVerificationCount,
        getReceiptVerificationValid: () => receiptVerificationValid,
        getVerificationEvidence: () => verificationEvidence,
        getSettlementEvidence: () => settlementEvidence,
        getServiceOutputHash: () => serviceOutputHash,
        getServiceReceiptHash: () => serviceReceiptHash,
      };
    }

    const WEB_INPUT = { target_url: 'https://acme.example/', retrieval_mode: 'direct' as const };

    it('step 2-11: real Base Sepolia exact 402 -> buyer signs -> real /verify -> execute -> real /settle -> 200, then retry proves no double-settlement', async () => {
      const {
        app,
        getExecutionCount,
        getVerifyCount,
        getSettlementCount,
        getReceiptVerificationCount,
        getReceiptVerificationValid,
        getVerificationEvidence,
        getSettlementEvidence,
        getServiceOutputHash,
        getServiceReceiptHash,
      } = await mountLiveRoute();

      // --- 402 challenge ---
      const res402 = await app.request('/v1/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(WEB_INPUT),
      });
      expect(res402.status).toBe(402);
      const decoded = decodePaymentRequiredHeaderSafe(res402.headers.get('PAYMENT-REQUIRED')!);
      expect(decoded.ok).toBe(true);
      const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
      expect(challenge.accepts[0]!.network).toBe(NETWORK);
      expect(challenge.accepts[0]!.asset).toBe(BASE_SEPOLIA_USDC);
      expect(challenge.accepts[0]!.payTo).toBe(SELLER_ADDRESS);
      expect(challenge.accepts[0]!.amount).toBe('9000');

      // --- buyer signs a REAL EIP-3009 authorization via CDP ---
      const paymentIdentifier = generateSiteborneePaymentId();
      const extensions = buildBuyerPaymentIdentifierExtensions(
        challenge.extensions ?? {},
        paymentIdentifier
      );
      const challengeWithId: PaymentRequired = { ...challenge, extensions };
      const paymentPayload: PaymentPayload = await httpClient.createPaymentPayload(challengeWithId);
      expect(paymentPayload.accepted.network).toBe(NETWORK);
      const header = encodePaymentSignatureHeaderSafe(paymentPayload);

      // --- retry with PAYMENT-SIGNATURE: real /verify, execute, real /settle ---
      const res = await app.request('/v1/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(WEB_INPUT),
      });
      const body = (await res.clone().json()) as Record<string, unknown>;
      // eslint-disable-next-line no-console
      console.log('SUN-0700B live exact settlement result (sanitized):', {
        status: res.status,
        service_id: body.service_id,
        receipt_id: body.receipt_id,
        link_id: body.link_id,
        link_hash: body.link_hash,
      });
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(getExecutionCount()).toBe(1);
      expect(getVerifyCount()).toBe(1);
      expect(getSettlementCount()).toBe(1);
      expect(getReceiptVerificationCount()).toBe(1);
      expect(getReceiptVerificationValid()).toBe(true);

      const settleResponseHeader = res.headers.get('PAYMENT-RESPONSE');
      expect(settleResponseHeader).toBeTruthy();
      const decodedSettlement = decodePaymentResponseHeaderSafe(settleResponseHeader!);
      if (!decodedSettlement.ok) {
        throw new Error(
          `SUN-0700B live exact settlement returned a malformed PAYMENT-RESPONSE (${decodedSettlement.reason})`
        );
      }
      // eslint-disable-next-line no-console
      console.log('SUN-0700B live exact settlement PAYMENT-RESPONSE (sanitized):', {
        success: decodedSettlement.value.success,
        network: decodedSettlement.value.network,
        transaction: decodedSettlement.value.transaction,
        amount: decodedSettlement.value.amount,
      });
      expect(decodedSettlement.value).toMatchObject({
        success: true,
        network: NETWORK,
        amount: '9000',
      });
      expect(decodedSettlement.value.payer?.toLowerCase()).toBe(BUYER_ADDRESS.toLowerCase());
      expect(decodedSettlement.value.transaction).toMatch(/^0x[0-9a-fA-F]{64}$/);

      // --- retry proof: same payment identity, no second settlement/execution/job ---
      const retryRes = await app.request('/v1/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(WEB_INPUT),
      });
      const retryBody = (await retryRes.clone().json()) as Record<string, unknown>;
      expect(retryRes.status).toBe(200);
      expect(retryBody.link_id).toBe(body.link_id);
      expect(retryBody.receipt_id).toBe(body.receipt_id);
      expect(retryRes.headers.get('PAYMENT-RESPONSE')).toBe(settleResponseHeader);
      // No second execution: executionCount is still 1 — the retry was
      // reconstructed from D1, never re-ran the executor or called the
      // facilitator a second time.
      expect(getExecutionCount()).toBe(1);
      expect(getVerifyCount()).toBe(1);
      expect(getSettlementCount()).toBe(1);
      expect(getReceiptVerificationCount()).toBe(1);
      const logicalJobCount = await db
        .prepare('SELECT COUNT(*) AS count FROM jobs WHERE idempotency_key = ?')
        .bind(paymentIdentifier)
        .first<{ count: number }>();
      expect(Number(logicalJobCount?.count ?? 0)).toBe(1);
      const logicalJob = await db
        .prepare('SELECT id FROM jobs WHERE idempotency_key = ?')
        .bind(paymentIdentifier)
        .first<{ id: string }>();
      const verified = getVerificationEvidence();
      const settled = getSettlementEvidence();
      expect(verified?.verified).toBe(true);
      expect(settled?.success).toBe(true);
      const verificationEvidenceHash = await hashPaymentObject(verified!);
      const settlementEvidenceHash = await hashPaymentObject(settled!);
      // Public/sanitized checkpoint evidence only. Raw signed payment
      // authorization and all authentication material remain absent.
      // eslint-disable-next-line no-console
      console.log('SUN-0700B checkpoint-1 evidence (sanitized):', {
        network: NETWORK,
        scheme: 'exact',
        service_id: 'web_context_verified.v1',
        service_version: 'v1',
        quote_id: verified!.quote_id,
        requirement_id: verified!.requirement_id,
        payment_identifier: paymentIdentifier,
        buyer: verified!.payer,
        seller: SELLER_ADDRESS,
        atomic_amount: settled!.actual_amount,
        verify_success: verified!.verified,
        verification_evidence_hash: verificationEvidenceHash,
        service_job_id: logicalJob?.id,
        output_hash: getServiceOutputHash(),
        receipt_id: body.receipt_id,
        receipt_hash: getServiceReceiptHash(),
        receipt_self_verification: getReceiptVerificationValid(),
        settle_success: settled!.success,
        transaction: settled!.transaction_reference,
        settlement_evidence_hash: settlementEvidenceHash,
        payment_service_link_id: body.link_id,
        payment_service_link_hash: body.link_hash,
        verified_at: verified!.evidence_timestamp,
        settled_at: settled!.settled_at,
        http_status: res.status,
        replay_http_status: retryRes.status,
        service_execution_count: getExecutionCount(),
        facilitator_verify_count: getVerifyCount(),
        facilitator_settle_count: getSettlementCount(),
        logical_job_count: Number(logicalJobCount?.count ?? 0),
      });
    }, 120_000);

    it('negative: a tampered (invalid) signature is rejected by the real facilitator /verify — service never executes, no settlement', async () => {
      const { app, getExecutionCount, getVerifyCount, getSettlementCount } = await mountLiveRoute();

      const res402 = await app.request('/v1/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(WEB_INPUT),
      });
      const decoded = decodePaymentRequiredHeaderSafe(res402.headers.get('PAYMENT-REQUIRED')!);
      const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
      const extensions = buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {});
      const challengeWithId: PaymentRequired = { ...challenge, extensions };
      const paymentPayload = await httpClient.createPaymentPayload(challengeWithId);

      // Tamper the signed authorization's value after signing — the
      // EIP-712 signature no longer matches the payload, so a real
      // facilitator must reject it. No on-chain transaction is created
      // by an invalid /verify call.
      const signedPayload = paymentPayload.payload as {
        authorization?: Record<string, unknown>;
      };
      if (!signedPayload.authorization) {
        throw new Error('SUN-0700B exact client did not produce an EIP-3009 authorization');
      }
      const tampered: PaymentPayload = {
        ...paymentPayload,
        payload: {
          ...signedPayload,
          authorization: { ...signedPayload.authorization, value: '999999999999' },
        },
      };
      const header = encodePaymentSignatureHeaderSafe(tampered);

      const res = await app.request('/v1/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(WEB_INPUT),
      });
      const responseBody = (await res.clone().json()) as Record<string, unknown>;
      // eslint-disable-next-line no-console
      console.log('SUN-0700B live negative-verify result (sanitized):', {
        status: res.status,
        error: responseBody.error,
      });
      expect(res.status).toBe(402);
      expect(responseBody.error).toBe('payment_verification_rejected');
      expect(getExecutionCount()).toBe(0);
      expect(getVerifyCount()).toBe(1);
      expect(getSettlementCount()).toBe(0);
    }, 60_000);

    it('local negative: wrong-amount candidate requirement is rejected before any facilitator call (no live call made)', async () => {
      const { app, getExecutionCount, getVerifyCount, getSettlementCount } = await mountLiveRoute();
      const res402 = await app.request('/v1/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(WEB_INPUT),
      });
      const decoded = decodePaymentRequiredHeaderSafe(res402.headers.get('PAYMENT-REQUIRED')!);
      const challenge = (decoded as { ok: true; value: PaymentRequired }).value;
      const requirement = challenge.accepts[0]!;
      const extensions = buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {});
      const malformedPayload = {
        x402Version: 2,
        resource: challenge.resource,
        accepted: { ...requirement, amount: '1' }, // wrong amount, never echoed by a real client
        payload: { synthetic_signature: 'synthetic:tamper' },
        extensions,
      };
      const header = encodePaymentSignatureHeaderSafe(malformedPayload as PaymentPayload);
      const res = await app.request('/v1/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(WEB_INPUT),
      });
      const body = (await res.clone().json()) as Record<string, unknown>;
      expect(res.status).toBe(400);
      expect(body.error).toBe('invalid_payment_structure');
      expect(getExecutionCount()).toBe(0);
      expect(getVerifyCount()).toBe(0);
      expect(getSettlementCount()).toBe(0);
    });
  }
);
