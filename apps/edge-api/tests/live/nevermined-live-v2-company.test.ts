/**
 * SUN-1000 checkpoint 1O-B2 — the first live v2 Nevermined sandbox
 * payment proof (`company_evidence_graph.v2`). Mirrors the accepted
 * SUN-0900B pattern (`nevermined-live-exact.test.ts`) exactly, adapted
 * for v2's already-registered resources (checkpoint 1O-B/1O-B1: real
 * agent/plan IDs already exist and reconcile EXACT_EXISTING — this file
 * never registers anything, only reconciles to the known IDs).
 *
 * Gated so it is a no-op in every normal `pnpm test`/`pnpm check`/CI run:
 *
 *   describe.skipIf(process.env.RUN_LIVE_NEVERMINED !== '1')
 *
 * Requires: RUN_LIVE_NEVERMINED=1, NVM_API_KEY, NVM_SUBSCRIBER_API_KEY,
 * NVM_ENVIRONMENT=sandbox.
 *
 * Phases: A registration reconciliation (to the known checkpoint 1O-B
 * IDs, never a create path), B subscriber delegation, C ephemeral x402
 * authorization, D-F real verify/execute/settle (driven by the `it()`
 * block's HTTP requests), G replay/duplicate_conflict.
 *
 * `controlled_sandbox_self_test`: independent_customer=false, revenue=false,
 * open_market_purchase=false, production_ready=false, production_enabled=false.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { Payments, PaymentsError } from '@nevermined-io/payments';
import {
  NEVERMINED_DECLARATIONS,
  NEVERMINED_ROUTES,
  PAYMENT_DELEGATION_ID_HEADER,
  PAYMENT_IDENTIFIER_HEADER,
  decodeNeverminedPaymentRequiredHeaderSafe,
  decodeNeverminedPaymentResponseHeaderSafe,
  reconcileNeverminedDelegation,
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
import { NeverminedSandboxReconciliationClient } from '../../src/control-plane/evidence/nevermined-reconciliation-client';
import {
  ensureLivePersistenceDirectory,
  resolveLivePersistencePath,
} from '../../src/control-plane/live-persistence-path';

// SUN-1000 checkpoint 1O-B2: deliberately NOT imported from
// nevermined-live-exact.test.ts -- that file's own module-level
// `describe.skipIf(process.env.RUN_LIVE_NEVERMINED !== '1')` means
// importing anything from it (even a named helper) evaluates its whole
// module, which under RUN_LIVE_NEVERMINED=1 activates ITS live describe
// block too, triggering a real, unintended v1 settlement attempt
// alongside this file's v2 one -- discovered exactly that way during
// this checkpoint's first real run. Inlined instead (same idempotent
// migration-apply logic, byte-identical).
const ADD_COLUMN_PATTERN = /^ALTER TABLE (\w+) ADD COLUMN (\w+)/i;

async function columnExists(db: D1Database, table: string, column: string): Promise<boolean> {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (result.results ?? []).some((row) => row.name === column);
}

async function runMigrationsFromDir(db: D1Database, dir: string): Promise<void> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf-8');
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

const RUN_LIVE = process.env.RUN_LIVE_NEVERMINED === '1';

const NETWORK = 'eip155:84532' as const;
const SERVICE_ID = 'company_evidence_graph.v2' as const;
const AMOUNT = '39000';
const COMPANY_INPUT = {
  identifiers: { cik: '0000320193' },
  requested_field_groups: ['identity', 'sec_submissions'],
};
// SUN-1000 checkpoint 1O-B real registration (docs/operations/NEVERMINED_PROTOCOL.md)
const KNOWN_AGENT_ID =
  '8945215415179810337511916177281451484220450532075244586308753062965582716389';
const KNOWN_PLAN_ID =
  '10268032069987826322514735824876788768903142706079143267509577311063526800318';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations', import.meta.url));

function runMigrations(db: D1Database): Promise<void> {
  return runMigrationsFromDir(db, MIGRATIONS_DIR);
}

function requireEnvPresent(name: string): void {
  if (!process.env[name]) {
    throw new Error(`SUN-1000 1O-B2 live test: required environment variable "${name}" is not set`);
  }
}

describe.skipIf(!RUN_LIVE)(
  'SUN-1000 checkpoint 1O-B2 — live v2 Nevermined sandbox: reconcile, delegate, verify, execute, settle (company_evidence_graph.v2)',
  () => {
    let tempDir: string;
    let mf: Miniflare;
    let db: D1Database;
    let app: Hono;
    let accessToken: string;
    let agentId: string;
    let planId: string;
    let delegationId: string;
    let executionCount = 0;
    const clockValue = () => new Date().toISOString();

    beforeAll(async () => {
      requireEnvPresent('NVM_API_KEY');
      requireEnvPresent('NVM_SUBSCRIBER_API_KEY');
      requireEnvPresent('NVM_ENVIRONMENT');
      if (process.env.NVM_ENVIRONMENT !== 'sandbox') {
        throw new Error('SUN-1000 1O-B2 live test: NVM_ENVIRONMENT must be "sandbox"');
      }

      // Dedicated, durable, non-OS-temp v2 checkpoint directory --
      // deliberately separate from v1's own live D1
      // (sun-0900b-checkpoint1), never mixed. Never auto-deleted.
      const v2LiveDir = resolve(
        homedir(),
        '.local',
        'share',
        'siteborne',
        'live-d1',
        'sun-1000-checkpoint-1o-b2'
      );
      tempDir = resolveLivePersistencePath({
        repositoryRoot: fileURLToPath(new URL('../../../..', import.meta.url)),
        env: { ...process.env, SITEBORNE_LIVE_D1_DIR: v2LiveDir },
      });
      ensureLivePersistenceDirectory(tempDir);
      // eslint-disable-next-line no-console
      console.log('SUN-1000 1O-B2 live persistence path (sanitized, no secret material):', tempDir);

      mf = new Miniflare({
        modules: true,
        script: `export default { async fetch() { return new Response('OK'); } }`,
        d1Databases: ['DB'],
        resourcePersistencePath: tempDir,
      });
      db = await mf.getD1Database('DB');
      await db.exec('PRAGMA foreign_keys = ON');
      await runMigrations(db);
      await buildPaidServicesApp({ db, evidenceMode: 'fixture', clock: clockValue });

      const unfinished = await db
        .prepare(
          `SELECT lifecycle_stage, COUNT(*) as count FROM payment_attempts
           WHERE lifecycle_stage IN ('settlement_pending', 'settled_external', 'link_verified')
           GROUP BY lifecycle_stage`
        )
        .all<{ lifecycle_stage: string; count: number }>();
      const unfinishedCounts = Object.fromEntries(
        (unfinished.results ?? []).map((row) => [row.lifecycle_stage, row.count])
      );
      // eslint-disable-next-line no-console
      console.log(
        'SUN-1000 1O-B2 startup unfinished-attempt counts (sanitized):',
        unfinishedCounts
      );

      const builder = Payments.getInstance({ nvmApiKey: process.env.NVM_API_KEY! });
      const subscriber = Payments.getInstance({ nvmApiKey: process.env.NVM_SUBSCRIBER_API_KEY! });

      // =========================================================
      // PHASE A: registration reconciliation ONLY, to the known
      // checkpoint 1O-B IDs. Never a create path -- this checkpoint's
      // own preflight (1O-B2 §5) already proved EXACT_EXISTING for
      // all four v2 services; a state other than 'existing' here means
      // something changed since that preflight, and must STOP rather
      // than register a duplicate.
      // =========================================================
      const declaration = NEVERMINED_DECLARATIONS[SERVICE_ID];
      expect(declaration.plan.gross_buyer_amount_atomic).toBe(AMOUNT);
      expect(declaration.agent.registered_agent_id).toBe(KNOWN_AGENT_ID);
      expect(declaration.plan.registered_plan_id).toBe(KNOWN_PLAN_ID);

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
              (a) => ({ id: a.id, name: a.metadata?.main?.name })
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
              (p) => ({ id: p.id, name: p.metadata?.main?.name })
            ),
          };
        },
      };

      const reconciliation = await reconcileNeverminedRegistration(registryClient, {
        agentName: declaration.agent.nevermined_display_name,
        planName: `${declaration.agent.nevermined_display_name} — Plan`,
        knownAgentId: KNOWN_AGENT_ID,
        knownPlanId: KNOWN_PLAN_ID,
      });
      // eslint-disable-next-line no-console
      console.log('SUN-1000 1O-B2 registration reconciliation (sanitized):', {
        state: reconciliation.state,
      });
      if (reconciliation.state !== 'existing') {
        throw new Error(
          `SUN-1000 1O-B2 live test: registration reconciliation was "${reconciliation.state}", expected "existing" -- STOP, do not create a new registration here.`
        );
      }
      agentId = reconciliation.agentId;
      planId = reconciliation.planId;
      expect(agentId).toBe(KNOWN_AGENT_ID);
      expect(planId).toBe(KNOWN_PLAN_ID);

      // =========================================================
      // PHASE B: subscriber delegation (identical mechanism to v1).
      // =========================================================
      const delegationPolicy = {
        provider: 'erc4337' as const,
        currency: 'usdc',
        activeStatuses: ['active'],
        minRemainingBudgetCents: 1,
        notExpiredAsOfIso: clockValue(),
      };
      const delegationListClient = {
        listDelegations: async () => {
          const result = await subscriber.delegation.listDelegations({ accessible: true });
          return {
            delegations: result.delegations.map((d) => ({
              delegationId: d.delegationId,
              provider: d.provider,
              status: d.status,
              currency: d.currency,
              spendingLimitCents: d.spendingLimitCents,
              remainingBudgetCents: d.remainingBudgetCents,
              amountSpentCents: d.amountSpentCents,
              expiresAt: d.expiresAt,
            })),
          };
        },
      };
      const delegationReconciliation = await reconcileNeverminedDelegation(
        delegationListClient,
        delegationPolicy
      );
      // eslint-disable-next-line no-console
      console.log('SUN-1000 1O-B2 delegation reconciliation (sanitized):', {
        state: delegationReconciliation.state,
      });

      if (delegationReconciliation.state === 'exact_existing') {
        delegationId = delegationReconciliation.delegationId;
      } else if (delegationReconciliation.state === 'no_match') {
        let created: Awaited<ReturnType<typeof subscriber.delegation.createDelegation>>;
        try {
          created = await subscriber.delegation.createDelegation({
            provider: 'erc4337',
            spendingLimitCents: 1,
            durationSecs: 3600,
            currency: 'usdc',
            planId,
          });
        } catch (e) {
          if (e instanceof PaymentsError) {
            // eslint-disable-next-line no-console
            console.error('SUN-1000 1O-B2 live createDelegation failure (sanitized):', {
              code: e.code,
              message: e.message,
            });
          }
          throw e;
        }
        delegationId = created.delegationId;
      } else {
        throw new Error(
          `SUN-1000 1O-B2 live test: delegation reconciliation did not resolve to 'exact_existing' or 'no_match' (got "${delegationReconciliation.state}") -- refusing to create another delegation.`
        );
      }
      expect(delegationId).toBeTruthy();

      const delegationReadBack = await reconcileNeverminedDelegation(
        delegationListClient,
        { ...delegationPolicy, notExpiredAsOfIso: clockValue() },
        { backoffScheduleMs: [0, 2_000, 5_000, 10_000] }
      );
      if (
        delegationReadBack.state !== 'exact_existing' ||
        delegationReadBack.delegationId !== delegationId
      ) {
        throw new Error(
          `SUN-1000 1O-B2 live test: delegation ${delegationId} did not read back as exact_existing (got "${delegationReadBack.state}") -- preserving created state, not creating another.`
        );
      }

      // =========================================================
      // PHASE C: ephemeral x402 authorization bound to that delegation.
      // =========================================================
      const tokenResult = await subscriber.x402.getX402AccessToken(planId, agentId, {
        delegationConfig: { delegationId },
      });
      accessToken = tokenResult.accessToken;
      expect(accessToken).toBeTruthy();

      const evidenceProvider = NeverminedPaymentEvidenceProvider.authenticated({
        apiKey: process.env.NVM_API_KEY!,
        environment: 'sandbox',
        liveGuard: {
          runLiveNevermined: process.env.RUN_LIVE_NEVERMINED,
          apiKeyEnvironment: 'sandbox',
        },
      });
      const neverminedReconciliationClient = NeverminedSandboxReconciliationClient.authenticated({
        apiKey: process.env.NVM_API_KEY!,
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
        pricingKey: 'company_evidence_graph',
        network: NETWORK,
        asset: 'nevermined:credits',
        path: NEVERMINED_ROUTES[SERVICE_ID],
        inputSchema: BUNDLED_SERVICE_INPUT_SCHEMAS[SERVICE_ID] as Record<string, unknown>,
        contractRelease: '2.0.0',
        inputSchemaHash: 'sha256:8d9a6c432b019e24a2df4d48dd93424a8782febb49c0c88f7cf9208cf0204dd7',
        outputSchemaHash: 'sha256:5593736dfc60089aa3f01de664eb67ccba3a58e03449a66e91f477324e24861b',
        pccDependency: '1.1.0',
        db,
        clock: clockValue,
        payTo: 'siteborne:nevermined-publisher-not-registered',
        evidenceMode: 'production',
        evidenceProvider,
        rail: 'nevermined',
        nevermined: { agentId, planId },
        neverminedReconciliationClient,
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
              return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
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
      const res402 = await app.request(NEVERMINED_ROUTES[SERVICE_ID], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(COMPANY_INPUT),
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
          [PAYMENT_DELEGATION_ID_HEADER]: delegationId,
        },
        body: JSON.stringify(COMPANY_INPUT),
      });
      const body = (await res.clone().json()) as Record<string, unknown>;
      // eslint-disable-next-line no-console
      console.log('SUN-1000 1O-B2 live settlement result (sanitized):', {
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
      const replay = await app.request(NEVERMINED_ROUTES[SERVICE_ID], {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': accessToken,
          [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
          [PAYMENT_DELEGATION_ID_HEADER]: delegationId,
        },
        body: JSON.stringify(COMPANY_INPUT),
      });
      expect(replay.status).toBe(200);
      expect(executionCount).toBe(1); // unchanged -- reconstructed from D1, never re-executed
      const replayBody = (await replay.json()) as Record<string, unknown>;
      expect(replayBody.link_id).toBe(body.link_id);

      const conflictRes = await app.request(NEVERMINED_ROUTES[SERVICE_ID], {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'payment-signature': accessToken,
          [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
          [PAYMENT_DELEGATION_ID_HEADER]: delegationId,
        },
        body: JSON.stringify({
          identifiers: { cik: '0000000000' },
          requested_field_groups: ['identity'],
        }),
      });
      expect(conflictRes.status).toBe(409);
      expect(executionCount).toBe(1);
    }, 180_000);
  }
);
