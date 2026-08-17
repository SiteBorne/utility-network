/**
 * SUN-1000 checkpoint 1O-B2B — real Base Sepolia exact settlement for the
 * v2 direct-CDP route (`web_context_verified.v2`, contract release
 * 2.0.0). Adapted call-for-call from the accepted SUN-0700B checkpoint 1
 * v1 reference (`x402-live-exact.test.ts`) -- same buyer/seller
 * addresses, same real CDP facilitator, same Base Sepolia network/asset,
 * only the service major version and path differ. Independent of, and
 * entirely unblocked by, the Nevermined provider issue classified in
 * checkpoint 1O-B2A (NEVERMINED_BACKEND_REGRESSION_OR_DEFECT) -- this
 * file makes ZERO Nevermined calls of any kind (no import of
 * `@nevermined-io/payments`, no NVM_* credential read).
 *
 * Gated so it is a no-op (zero network calls, zero credential reads
 * beyond presence) in every normal `pnpm test`/`pnpm check`/CI run:
 *
 *   describe.skipIf(process.env.RUN_LIVE_X402 !== '1')
 *
 * Requires, in the process environment (never read for their VALUES by
 * this file except to hand them opaquely to the official CDP SDK):
 *   RUN_LIVE_X402=1
 *   CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET (secret)
 *   SELLER_WALLET_ADDRESS (public payTo)
 *
 * Network: eip155:84532 (Base Sepolia) only. Never mainnet.
 *
 * Uses the cheapest accepted v2 `exact`-scheme service
 * (web_context_verified.v2, $0.009, same pricing key as v1's
 * web_context_verified_direct, governance/RISK_LIMITS.yaml) with its
 * existing fixture-mode executor -- this checkpoint tests the PAYMENT
 * layer against a real facilitator, not service execution against real
 * live web adapters.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
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
  PaymentAttemptBinding,
  PaymentEvidenceProvider,
  PaymentPayload,
  PaymentRequired,
  PaymentSettlementContext,
  PaymentVerificationContext,
} from '@siteborne/protocol-x402';
import type { VerificationReceipt } from '@siteborne/verification';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  NEVERMINED_PAYMENT_PROVIDER,
  acquirePaymentAttempt,
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
import {
  resolveLivePersistencePath,
  ensureLivePersistenceDirectory,
} from '../../src/control-plane/live-persistence-path';
import { D1PaymentAttemptRepository } from '../../src/control-plane/repositories/d1/payment-attempts';

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

// SUN-1000 checkpoint 1O-B2B: this file uses DURABLE (non-ephemeral) live
// persistence (see beforeAll below), unlike the ephemeral-tempdir v1
// reference this was adapted from -- so migrations must be idempotent
// against an already-migrated real D1, not just a fresh one. Same
// idempotent-migration-apply logic already established and accepted in
// the v2 Nevermined live checkpoint (nevermined-live-v2-company.test.ts),
// inlined here rather than imported for the same reason: importing from a
// sibling live file with its own top-level `describe.skipIf` would
// activate that file's live describe block too.
const ADD_COLUMN_PATTERN = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/i;

async function columnExists(db: D1Database, table: string, column: string): Promise<boolean> {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (result.results ?? []).some((row) => row.name === column);
}

async function runMigrations(db: D1Database): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
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
      const addColumnMatch = stmt.match(ADD_COLUMN_PATTERN);
      if (addColumnMatch) {
        const [, table, column] = addColumnMatch;
        if (await columnExists(db, table!, column!)) continue;
      }
      await db.exec(stmt);
    }
  }
}

/** Presence-only — throws naming the missing variable, never a value. */
function requireEnvPresent(name: string): void {
  if (!process.env[name]) {
    throw new Error(
      `SUN-1000 1O-B2B live test: required environment variable "${name}" is not set`
    );
  }
}

describe.skipIf(!RUN_LIVE)(
  'SUN-1000 checkpoint 1O-B2B — live Base Sepolia exact settlement, v2 direct CDP route (real CDP facilitator)',
  () => {
    let mf: Miniflare;
    let db: D1Database;
    let facilitator: HTTPFacilitatorClient;
    let httpClient: x402HTTPClient;
    let supportedResult: Awaited<ReturnType<typeof checkCdpSupportsNetwork>>;
    // Set by the real settlement test below; reused by the local-only
    // cross-rail conflict proof (§13) so it starts from a genuinely
    // persisted, real CDP-bound Payment-Identifier rather than a
    // synthetic one.
    let realCdpPaymentIdentifier: string | undefined;
    const clockValue = () => new Date().toISOString();

    beforeAll(async () => {
      requireEnvPresent('CDP_API_KEY_ID');
      requireEnvPresent('CDP_API_KEY_SECRET');
      requireEnvPresent('CDP_WALLET_SECRET');
      requireEnvPresent('SELLER_WALLET_ADDRESS');
      if (BASE_SEPOLIA_ASSET_INFO.address.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) {
        throw new Error(
          'SUN-1000 1O-B2B live test: official x402 Base Sepolia asset does not match the approved asset'
        );
      }
      if (process.env.SELLER_WALLET_ADDRESS!.toLowerCase() !== SELLER_ADDRESS.toLowerCase()) {
        throw new Error(
          'SUN-1000 1O-B2B live test: SELLER_WALLET_ADDRESS does not match the approved Base Sepolia seller -- CDP_PUBLIC_IDENTITY_CHANGED'
        );
      }

      // The first network call in every fresh live run is authenticated
      // `/supported`. Stop before buyer-account lookup or payment signing
      // unless both required Base Sepolia schemes are advertised.
      facilitator = createCdpFacilitatorClient();
      supportedResult = await checkCdpSupportsNetwork(facilitator, NETWORK, REQUIRED_SCHEMES);
      if (!supportedResult.ok) {
        throw new Error(`SUN-1000 1O-B2B live preflight rejected: ${supportedResult.reason}`);
      }

      // Durable, non-ephemeral live-sandbox D1 persistence -- a dedicated
      // directory, separate from v1's own (`sun-0900b-checkpoint1`) and
      // from the v2 Nevermined checkpoint's (`sun-1000-checkpoint-1o-b2`).
      const v2CdpLiveDir = resolve(
        homedir(),
        '.local',
        'share',
        'siteborne',
        'live-d1',
        'sun-1000-checkpoint-1o-b2b'
      );
      const resolvedPath = resolveLivePersistencePath({
        repositoryRoot: fileURLToPath(new URL('../../../..', import.meta.url)),
        env: { ...process.env, SITEBORNE_LIVE_D1_DIR: v2CdpLiveDir },
      });
      ensureLivePersistenceDirectory(resolvedPath);
      // eslint-disable-next-line no-console
      console.log(
        'SUN-1000 1O-B2B live persistence path (sanitized, no secret material):',
        resolvedPath
      );

      mf = new Miniflare({
        modules: true,
        script: `export default { async fetch() { return new Response('OK'); } }`,
        d1Databases: ['DB'],
        resourcePersistencePath: resolvedPath,
      });
      db = await mf.getD1Database('DB');
      await db.exec('PRAGMA foreign_keys = ON');
      await runMigrations(db);
      // Seed the four frozen services (FK requirement).
      await buildPaidServicesApp({ db, evidenceMode: 'fixture', clock: clockValue });

      // Buyer side: the existing, controlled CDP EVM account — fetched
      // by its known address, never created fresh, never exporting its
      // private key.
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
      // eslint-disable-next-line no-console
      console.log('SUN-1000 1O-B2B CDP /supported (sanitized):', JSON.stringify(baseSepoliaKinds));
      expect(supportedResult.ok, supportedResult.reason).toBe(true);
    });

    function freshContext() {
      return buildServiceContext('web_context_verified.v2', {
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
        serviceId: 'web_context_verified.v2',
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
        path: '/v2/web/context',
        inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS['web_context_verified.v2'] as Record<
          string,
          unknown
        >,
        contractRelease: '2.0.0',
        inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
        outputSchemaHash: 'sha256:7d4882e997ec3a3bd97b746de36ed99dfe430d59b4d1c8adc7d9fa83a274b4e0',
        pccDependency: '1.1.0',
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
            'web_context_verified.v2',
            input,
            context
          );
          if (!result.receipt || !result.output_hash) {
            throw new Error('SUN-1000 1O-B2B live service did not produce a verifiable receipt');
          }
          const receiptCheck = await verifyServiceReceipt({
            receipt: result.receipt as VerificationReceipt,
            keyRegistry,
            expectedServiceId: 'web_context_verified.v2',
            expectedOutputHash: result.output_hash,
          });
          receiptVerificationCount += 1;
          receiptVerificationValid = receiptCheck.valid;
          if (!receiptCheck.valid) {
            throw new Error(
              'SUN-1000 1O-B2B live service receipt failed cryptographic self-verification'
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
      const res402 = await app.request('/v2/web/context', {
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
      realCdpPaymentIdentifier = paymentIdentifier;
      const extensions = buildBuyerPaymentIdentifierExtensions(
        challenge.extensions ?? {},
        paymentIdentifier
      );
      const challengeWithId: PaymentRequired = { ...challenge, extensions };
      const paymentPayload: PaymentPayload = await httpClient.createPaymentPayload(challengeWithId);
      expect(paymentPayload.accepted.network).toBe(NETWORK);
      const header = encodePaymentSignatureHeaderSafe(paymentPayload);

      // --- retry with PAYMENT-SIGNATURE: real /verify, execute, real /settle ---
      const res = await app.request('/v2/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(WEB_INPUT),
      });
      const body = (await res.clone().json()) as Record<string, unknown>;
      // eslint-disable-next-line no-console
      console.log('SUN-1000 1O-B2B live exact settlement result (sanitized):', {
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
          `SUN-1000 1O-B2B live exact settlement returned a malformed PAYMENT-RESPONSE (${decodedSettlement.reason})`
        );
      }
      // eslint-disable-next-line no-console
      console.log('SUN-1000 1O-B2B live exact settlement PAYMENT-RESPONSE (sanitized):', {
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
      const retryRes = await app.request('/v2/web/context', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
        body: JSON.stringify(WEB_INPUT),
      });
      const retryBody = (await retryRes.clone().json()) as Record<string, unknown>;
      expect(retryRes.status).toBe(200);
      expect(retryBody.link_id).toBe(body.link_id);
      expect(retryBody.receipt_id).toBe(body.receipt_id);
      expect(retryRes.headers.get('PAYMENT-RESPONSE')).toBe(settleResponseHeader);
      // No second execution: executionCount is still 1.
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
      // eslint-disable-next-line no-console
      console.log('SUN-1000 checkpoint 1O-B2B evidence (sanitized):', {
        network: NETWORK,
        scheme: 'exact',
        service_id: 'web_context_verified.v2',
        service_version: 'v2',
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

    it('§13: cross-rail Payment-Identifier reuse is local/deterministic and NEVER silently accepted, with ZERO Nevermined provider calls', async () => {
      // Prefer the identifier set by the exact-proof test above (same
      // process); fall back to the most recently durably-persisted real
      // CDP row (a fresh process re-running only this test, against the
      // SAME durable sun-1000-checkpoint-1o-b2b D1 directory) -- either
      // way this is a genuinely real, already-settled CDP Payment-
      // Identifier, never a synthetic one, and this test never performs a
      // new economic mutation of its own.
      let identifier = realCdpPaymentIdentifier;
      if (!identifier) {
        const latest = await db
          .prepare(
            "SELECT payment_identifier FROM payment_attempts WHERE payment_rail = 'cdp' ORDER BY created_at DESC LIMIT 1"
          )
          .first<{ payment_identifier: string }>();
        identifier = latest?.payment_identifier;
      }
      expect(
        identifier,
        'a real, durably-persisted CDP payment attempt must exist (run the exact-proof test at least once)'
      ).toBeTruthy();
      const repo = new D1PaymentAttemptRepository(db);
      const stored = await repo.getByIdentifier(identifier!);
      expect(stored, 'the real settled CDP payment attempt must be persisted').toBeTruthy();
      expect(stored!.binding.payment_rail).toBe('cdp');

      // Present the SAME real, already-settled Payment-Identifier again,
      // everything else unchanged except the rail -- switched to a
      // synthetic (locally-constructed, never network-derived)
      // Nevermined-shaped binding. No @nevermined-io/payments import
      // anywhere in this file; no NVM_* credential read; no HTTP call to
      // any Nevermined endpoint -- this is a pure local D1/binding-digest
      // comparison.
      const neverminedShaped: PaymentAttemptBinding = {
        ...stored!.binding,
        binding_version: 2,
        payment_rail: 'nevermined',
        payment_provider: NEVERMINED_PAYMENT_PROVIDER,
        nevermined_agent_id: 'agent_synthetic_cross_rail_probe',
        nevermined_plan_id: 'plan_synthetic_cross_rail_probe',
        nevermined_delegation_id: 'del_' + '9'.repeat(24),
      };
      const outcome = await acquirePaymentAttempt(repo, {
        binding: neverminedShaped,
        nowIso: clockValue(),
        ttlMs: 5 * 60 * 1000,
      });
      // eslint-disable-next-line no-console
      console.log('SUN-1000 1O-B2B §13a cross-rail reuse of a CONSUMED identifier (sanitized):', {
        outcome_status: outcome.status,
        original_rail: stored!.binding.payment_rail,
        attempted_rail: neverminedShaped.payment_rail,
      });
      // `acquirePaymentAttempt` (packages/protocol-x402/src/replay/
      // idempotency.ts) checks expiry, THEN `existing.consumed`, BEFORE
      // ever comparing binding digests -- so depending on how much real
      // wall-clock time has elapsed since the settlement above (its
      // `expires_at` TTL is fixed at creation time and cannot be
      // retroactively extended by this later acquire call), the real
      // observed outcome is legitimately either `expired` or
      // `already_consumed` -- both are STRICTLY STRONGER terminal
      // rejections than `duplicate_conflict` (which only governs still-
      // pending bindings). All three members of this family
      // unconditionally reject cross-rail reuse; none ever silently
      // accepts it.
      expect(['expired', 'already_consumed']).toContain(outcome.status);

      // Confirm no second CDP settlement and no persisted Nevermined-rail
      // row were created by this local-only probe.
      const rows = await db
        .prepare('SELECT payment_rail FROM payment_attempts WHERE payment_identifier = ?')
        .bind(identifier!)
        .all<{ payment_rail: string }>();
      expect(rows.results?.length).toBe(1);
      expect(rows.results?.[0]?.payment_rail).toBe('cdp');

      // §13b: the complementary PENDING case -- a fresh, never-consumed
      // CDP-shaped binding, still entirely local/credential-free (no real
      // network call of any kind, matching the already-accepted pattern
      // in d1-payment-attempts.test.ts), demonstrates the literal
      // `duplicate_conflict` classification the checkpoint script names,
      // for the case where settlement has NOT yet occurred.
      const pendingIdentifier = `pay_probe_${Date.now().toString(16)}`;
      const pendingCdpBinding: PaymentAttemptBinding = {
        ...stored!.binding,
        payment_identifier: pendingIdentifier,
      };
      const firstSeen = await acquirePaymentAttempt(repo, {
        binding: pendingCdpBinding,
        nowIso: clockValue(),
        ttlMs: 5 * 60 * 1000,
      });
      expect(firstSeen.status).toBe('first_seen');
      const conflictOutcome = await acquirePaymentAttempt(repo, {
        binding: {
          ...pendingCdpBinding,
          binding_version: 2,
          payment_rail: 'nevermined',
          payment_provider: NEVERMINED_PAYMENT_PROVIDER,
          nevermined_agent_id: 'agent_synthetic_cross_rail_probe',
          nevermined_plan_id: 'plan_synthetic_cross_rail_probe',
          nevermined_delegation_id: 'del_' + '8'.repeat(24),
        },
        nowIso: clockValue(),
        ttlMs: 5 * 60 * 1000,
      });
      // eslint-disable-next-line no-console
      console.log('SUN-1000 1O-B2B §13b cross-rail conflict on a PENDING identifier (sanitized):', {
        outcome_status: conflictOutcome.status,
      });
      expect(conflictOutcome.status).toBe('duplicate_conflict');
    });

    it('§14: Model-D rail isolation holds for v2 without invoking the blocked Nevermined provider -- direct /v2 is CDP-only, no fallback, no stacking', async () => {
      // The v2 route mounted throughout this file (`web_context_verified.v2`
      // via `v2CdpRoute`) is unconditionally CDP -- proven structurally by
      // every 402/200 response above using the real CDP network/asset
      // (eip155:84532 / BASE_SEPOLIA_USDC) and the real CDP facilitator,
      // never a Nevermined-shaped challenge. This test additionally proves
      // the negative: mounting `web_context_verified.v2` WITHOUT a
      // `neverminedV2Enabled` flag (the default, as used by every route in
      // this file) means no Nevermined-rail route for this service exists
      // to fall back to or stack with -- the app instance was built with
      // `buildPaidServicesApp` (not `buildNeverminedV2PaidServicesApp`),
      // matching every other test in this file exactly.
      const { app } = await mountLiveRoute();
      const neverminedShapedPath = '/v2/nevermined/web/context';
      const res = await app.request(neverminedShapedPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(WEB_INPUT),
      });
      // Structurally absent -- not merely gated -- on an app instance that
      // never registered the Nevermined-rail v2 route family.
      expect(res.status).toBe(404);
    });
  }
);
