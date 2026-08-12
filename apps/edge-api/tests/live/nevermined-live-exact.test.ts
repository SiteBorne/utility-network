/**
 * SUN-0900B — the ONLY test file in this repository that calls the real
 * Nevermined sandbox API or registers a real agent/plan. Gated so it is a
 * no-op (zero network calls, zero credential reads beyond presence) in
 * every normal `pnpm test`/`pnpm check`/CI run:
 *
 *   describe.skipIf(process.env.RUN_LIVE_NEVERMINED !== '1')
 *
 * Scope, per the authorized controlled-sandbox-self-test ruling: register
 * exactly ONE service (`web_context_verified.v1`), exact scheme only.
 * `company_evidence_graph.v1`, `document_evidence_json.v1`, and
 * `verify_agent_output.v1` are never registered here. This is a
 * controlled_sandbox_self_test: independent_customer=false, revenue=false,
 * open_market_purchase=false. Builder and subscriber keys currently
 * resolve to the same Nevermined account/smart-account — acceptable for
 * this checkpoint because the invariant actually being tested is
 * payer != receiver (the ERC-4337 smart account vs. SITEBORNE's payTo),
 * not operator identity separation.
 *
 * Requires:
 *   RUN_LIVE_NEVERMINED=1
 *   NVM_API_KEY, NVM_SUBSCRIBER_API_KEY (secret)
 *   NVM_ENVIRONMENT=sandbox (public config)
 *
 * SUN-0900B checkpoint 1A: this test is idempotent against a checkpoint
 * registration that already exists (`checkpoint-fixture.ts`'s
 * `SUN_0900B_CHECKPOINT_1_REGISTRATION`). PHASE A below always runs
 * `reconcileNeverminedRegistration` (registry-reconciliation.ts) first —
 * a bounded, read-only lookup — and only falls through to
 * `registerAgentAndPlan` when reconciliation positively proves the
 * checkpoint object is absent (a fresh sandbox account), never merely
 * because one immediate read failed. This is a direct fix for the
 * eventual-consistency failure the very first live run hit: registration
 * succeeded, but an immediate `getAgent` call raced ahead of indexing.
 *
 * Phases: A registration reconciliation, B subscriber delegation,
 * C ephemeral x402 authorization, D-F real verify/execute/settle (driven
 * by the `it()` block's HTTP requests), G replay/duplicate_conflict.
 */
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { Payments } from '@nevermined-io/payments';
import {
  NEVERMINED_DECLARATIONS,
  NEVERMINED_ROUTES,
  PAYMENT_IDENTIFIER_HEADER,
  SUN_0900B_CHECKPOINT_1_REGISTRATION,
  decodeNeverminedPaymentRequiredHeaderSafe,
  decodeNeverminedPaymentResponseHeaderSafe,
  reconcileNeverminedRegistration,
  type NeverminedPaymentRequired,
  type NeverminedRegistryClient,
} from '@siteborne/protocol-nevermined';
import {
  BUNDLED_SERVICE_INPUT_SCHEMAS,
  generateSiteborneePaymentId,
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
} from '@siteborne/service-runtime';
import { createX402ServiceRoute } from '../../src/control-plane/routes/x402-service';
import type { ExecutorOutcome } from '../../src/control-plane/routes/x402-service';
import { buildPaidServicesApp } from '../../src/control-plane/routes/paid-services';
import { NeverminedPaymentEvidenceProvider } from '../../src/control-plane/evidence/nevermined-provider';

const RUN_LIVE = process.env.RUN_LIVE_NEVERMINED === '1';

const NETWORK = 'eip155:84532' as const;
const SELLER_ADDRESS = '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' as const;
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
const SERVICE_ID = 'web_context_verified.v1' as const;
const AMOUNT = '9000';
const WEB_INPUT = { target_url: 'https://acme.example/', retrieval_mode: 'direct' as const };

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

function requireEnvPresent(name: string): void {
  if (!process.env[name]) {
    throw new Error(`SUN-0900B live test: required environment variable "${name}" is not set`);
  }
}

describe.skipIf(!RUN_LIVE)(
  'SUN-0900B — live Nevermined sandbox: register, delegate, verify, execute, settle (web_context_verified.v1 only)',
  () => {
    let tempDir: string;
    let mf: Miniflare;
    let db: D1Database;
    let app: Hono;
    let accessToken: string;
    let agentId: string;
    let planId: string;
    let executionCount = 0;
    const clockValue = () => new Date().toISOString();

    beforeAll(async () => {
      requireEnvPresent('NVM_API_KEY');
      requireEnvPresent('NVM_SUBSCRIBER_API_KEY');
      requireEnvPresent('NVM_ENVIRONMENT');
      if (process.env.NVM_ENVIRONMENT !== 'sandbox') {
        throw new Error('SUN-0900B live test: NVM_ENVIRONMENT must be "sandbox"');
      }

      tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-nevermined-live-'));
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
      // buildPaidServicesApp always does.
      await buildPaidServicesApp({ db, evidenceMode: 'fixture', clock: clockValue });

      const builder = Payments.getInstance({ nvmApiKey: process.env.NVM_API_KEY! });
      const subscriber = Payments.getInstance({ nvmApiKey: process.env.NVM_SUBSCRIBER_API_KEY! });

      // =========================================================
      // PHASE A: registration reconciliation. SUN-0900B checkpoint
      // 1's agent/plan already exists (see checkpoint-fixture.ts) —
      // this MUST reuse it, never call registerAgentAndPlan again for
      // it. registerAgentAndPlan below is reachable only for a
      // genuinely fresh sandbox account with no prior checkpoint
      // registration (state: 'absent'), and only after a bounded,
      // read-only reconciliation positively proves absence — never
      // from a single failed read (the exact failure mode that
      // produced this reconciliation module in the first place).
      // =========================================================
      const declaration = NEVERMINED_DECLARATIONS[SERVICE_ID];
      expect(declaration.plan.gross_buyer_amount_atomic).toBe(AMOUNT);
      expect(SUN_0900B_CHECKPOINT_1_REGISTRATION.gross_buyer_amount_atomic).toBe(AMOUNT);
      expect(SUN_0900B_CHECKPOINT_1_REGISTRATION.seller_receiver).toBe(SELLER_ADDRESS);
      expect(SUN_0900B_CHECKPOINT_1_REGISTRATION.asset_token_address).toBe(BASE_SEPOLIA_USDC);

      const registryClient: NeverminedRegistryClient = {
        getAgent: async (id) => {
          const agent = (await builder.agents.getAgent(id)) as {
            metadata?: { main?: { name?: string } };
          };
          return { id, name: agent?.metadata?.main?.name };
        },
        getAgents: async () => {
          const page = await builder.agents.getAgents(1, 100, 'createdAt', 'desc');
          return {
            agents: (page.agents as { id: string; metadata?: { main?: { name?: string } } }[]).map(
              (a) => ({
                id: a.id,
                name: a.metadata?.main?.name,
              })
            ),
          };
        },
        getAgentPlans: async (id) => {
          const result = await builder.agents.getAgentPlans(id);
          const list: { id?: string; planId?: string }[] = Array.isArray(result)
            ? result
            : (result?.plans ?? []);
          return {
            planIds: list.map((p) => p.id ?? p.planId).filter((x): x is string => Boolean(x)),
          };
        },
        getPlan: async (id) => {
          const plan = (await builder.plans.getPlan(id)) as {
            metadata?: { main?: { name?: string } };
          };
          return { id, name: plan?.metadata?.main?.name };
        },
        getPlans: async () => {
          const page = await builder.plans.getPlans(1, 100, 'createdAt', 'desc');
          return {
            plans: (page.plans as { id: string; metadata?: { main?: { name?: string } } }[]).map(
              (p) => ({
                id: p.id,
                name: p.metadata?.main?.name,
              })
            ),
          };
        },
      };

      const reconciliation = await reconcileNeverminedRegistration(registryClient, {
        agentName: SUN_0900B_CHECKPOINT_1_REGISTRATION.agent_name,
        planName: SUN_0900B_CHECKPOINT_1_REGISTRATION.plan_name,
        knownAgentId: SUN_0900B_CHECKPOINT_1_REGISTRATION.agent_id,
        knownPlanId: SUN_0900B_CHECKPOINT_1_REGISTRATION.plan_id,
      });

      // eslint-disable-next-line no-console
      console.log('SUN-0900B registration reconciliation (sanitized):', {
        state: reconciliation.state,
      });

      if (reconciliation.state === 'existing') {
        agentId = reconciliation.agentId;
        planId = reconciliation.planId;
      } else if (reconciliation.state === 'absent') {
        // Guarded: only ever reached for a genuinely fresh sandbox
        // account, positively proven absent across the full bounded
        // backoff schedule — never for this checkpoint's own registration.
        const priceConfig = await builder.plans.getPayAsYouGoPriceConfig(
          BigInt(AMOUNT),
          SELLER_ADDRESS,
          BASE_SEPOLIA_USDC
        );
        const creditsConfig = builder.plans.getPayAsYouGoCreditsConfig();
        const registered = await builder.agents.registerAgentAndPlan(
          { name: declaration.agent.title, description: declaration.agent.description },
          { endpoints: [{ POST: `https://utility.siteborne.net${declaration.agent.endpoint}` }] },
          { name: `${declaration.agent.title} — PAYG plan`, accessLimit: 'credits' },
          priceConfig,
          creditsConfig,
          'credits'
        );
        agentId = registered.agentId;
        planId = registered.planId;
      } else {
        throw new Error(
          `SUN-0900B live test: registration reconciliation did not resolve to 'existing' or 'absent' (got "${reconciliation.state}") — refusing to guess. Never register when reconciliation reports partial/conflicting/timeout state.`
        );
      }
      expect(agentId).toBeTruthy();
      expect(planId).toBeTruthy();

      // =========================================================
      // PHASE B: subscriber delegation. Least-privilege, plan-bound,
      // short-lived.
      // =========================================================
      const { delegationId } = await subscriber.delegation.createDelegation({
        provider: 'erc4337',
        spendingLimitCents: 1, // >= $0.009, least-privilege ceiling for one call
        durationSecs: 3600,
        currency: 'usdc',
        planId,
      });
      expect(delegationId).toBeTruthy();

      // =========================================================
      // PHASE C: ephemeral x402 authorization bound to that delegation.
      // =========================================================
      const tokenResult = await subscriber.x402.getX402AccessToken(planId, agentId, {
        delegationConfig: { delegationId },
      });
      accessToken = tokenResult.accessToken;
      expect(accessToken).toBeTruthy();

      // PHASES D-F (real verify, service execution, real settle) happen
      // inside the mounted route below, driven by the `it()` block's HTTP
      // requests — never here in beforeAll.
      const evidenceProvider = NeverminedPaymentEvidenceProvider.authenticated({
        apiKey: process.env.NVM_API_KEY!,
        environment: 'sandbox',
        liveGuard: {
          runLiveNevermined: process.env.RUN_LIVE_NEVERMINED,
          apiKeyEnvironment: 'sandbox',
        },
      });

      app = new Hono();
      const { signer, registry: keyRegistry } = await createFixtureSigner();
      createX402ServiceRoute(app, {
        serviceId: SERVICE_ID,
        scheme: 'exact',
        pricingKey: 'web_context_verified_direct',
        network: NETWORK,
        asset: 'nevermined:credits',
        path: NEVERMINED_ROUTES[SERVICE_ID],
        inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
        contractRelease: '1.0.0',
        inputSchemaHash: 'sha256:d3b0762020d4cc1d1e846960ed978cf1237b1741f90213adabe8ed931c2845ea',
        outputSchemaHash: 'sha256:138bccc34ad8c320daec36890b8867fca9f709040b80c689710fd4bde49042de',
        pccDependency: '1.0.0',
        db,
        clock: clockValue,
        payTo: 'siteborne:nevermined-publisher-not-registered',
        evidenceMode: 'production',
        evidenceProvider,
        rail: 'nevermined',
        nevermined: { agentId, planId },
        executor: async (input): Promise<ExecutorOutcome> => {
          executionCount += 1;
          const context = buildServiceContext(SERVICE_ID, {
            clock: createTestClock(),
            artifact_store: createTestArtifactStore(),
            audit: createTestServiceAuditSink(),
            execution_mode: 'fixture',
          });
          const httpClient = {
            async fetch() {
              return new Response(
                '<html><head><title>Fixture Page</title></head><body>hello</body></html>',
                { status: 200, headers: { 'content-type': 'text/html' } }
              );
            },
          };
          const registry = buildFixtureRegistry({
            httpClient,
            context,
            worker: new FixtureDocumentWorkerBridge(new Map()),
            signer,
            keyRegistry,
          });
          const result = await executeLocalService(registry, SERVICE_ID, input, context);
          return { result };
        },
      });
    }, 120_000);

    afterAll(async () => {
      await mf.dispose();
    });

    it('real Nevermined verifyPermissions -> execute once -> real settlePermissions -> 200, then replay proves zero second charge, then duplicate_conflict is rejected', async () => {
      // PHASE D-F: the route itself drives real verify -> execute once ->
      // real settle for this single POST/retry pair.
      const res402 = await app.request(NEVERMINED_ROUTES[SERVICE_ID], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(WEB_INPUT),
      });
      expect(res402.status).toBe(402);
      const decoded = decodeNeverminedPaymentRequiredHeaderSafe(
        res402.headers.get('PAYMENT-REQUIRED') ?? ''
      );
      expect(decoded.ok).toBe(true);
      const required = (decoded as { ok: true; value: NeverminedPaymentRequired }).value;
      expect(required.accepts[0]).toMatchObject({ scheme: 'nvm:erc4337', network: NETWORK });

      const paymentIdentifier = generateSiteborneePaymentId();
      const res = await app.request(NEVERMINED_ROUTES[SERVICE_ID], {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': accessToken,
          [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
        },
        body: JSON.stringify(WEB_INPUT),
      });
      const body = (await res.clone().json()) as Record<string, unknown>;
      // eslint-disable-next-line no-console
      console.log('SUN-0900B live settlement result (sanitized):', {
        status: res.status,
        service_id: body.service_id,
        receipt_id: body.receipt_id,
        link_id: body.link_id,
        error: body.error,
      });
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(executionCount).toBe(1);

      const settled = decodeNeverminedPaymentResponseHeaderSafe(
        res.headers.get('PAYMENT-RESPONSE') ?? ''
      );
      expect(settled.ok).toBe(true);
      if (settled.ok) {
        expect(settled.value.success).toBe(true);
        expect(settled.value.creditsRedeemed).toBe(AMOUNT);
      }

      const attempt = await db
        .prepare(
          'SELECT payment_rail, payment_provider, nevermined_agent_id, nevermined_plan_id, consumed_at FROM payment_attempts WHERE payment_identifier = ?'
        )
        .bind(paymentIdentifier)
        .first<Record<string, unknown>>();
      expect(attempt).toMatchObject({
        payment_rail: 'nevermined',
        nevermined_agent_id: agentId,
        nevermined_plan_id: planId,
      });
      expect(attempt?.consumed_at).toBeTruthy();

      // PHASE G: replay/conflict.
      // --- replay: identical request/identity, zero second verify/settle/execution ---
      const replay = await app.request(NEVERMINED_ROUTES[SERVICE_ID], {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': accessToken,
          [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
        },
        body: JSON.stringify(WEB_INPUT),
      });
      expect(replay.status).toBe(200);
      expect(executionCount).toBe(1); // unchanged — reconstructed from D1, not re-executed
      const replayBody = (await replay.json()) as Record<string, unknown>;
      expect(replayBody.link_id).toBe(body.link_id);

      // --- duplicate_conflict: same identifier, different (conflicting) input ---
      const conflictRes = await app.request(NEVERMINED_ROUTES[SERVICE_ID], {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': accessToken,
          [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
        },
        body: JSON.stringify({
          target_url: 'https://different.example/',
          retrieval_mode: 'direct',
        }),
      });
      expect(conflictRes.status).toBe(409);
      expect(executionCount).toBe(1);
    }, 180_000);
  }
);
