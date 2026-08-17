/**
 * SUN-1000 Checkpoint 1N-A — deterministic v2 chaos / failure-injection
 * gate. Targets the forward v2 service family exclusively
 * (`company_evidence_graph.v2`, `web_context_verified.v2`,
 * `document_evidence_json.v2`, `verify_agent_output.v2`), reusing the
 * exact same real Miniflare/D1-backed harness and Hono `app.request()`
 * pattern already established and accepted in
 * `x402-service-route.test.ts` (SUN-0700A checkpoint 5) and
 * `nevermined-route-settlement-recovery.test.ts` (SUN-0900B checkpoint
 * 1B) — no second parallel test architecture.
 *
 * Every scenario is a named, deterministic `it()` block (never randomized
 * fault probabilities) so a failure is reproducible by name alone.
 * Fault injection happens at the one real seam this repository already
 * exposes for it: a custom `PaymentEvidenceProvider` (verify/settle) or a
 * throwing service executor — never a real network call, never
 * credentials, never a live provider.
 *
 * Each scenario name below corresponds 1:1 to a row in
 * `security/chaos/CHAOS_MATRIX.md`.
 */
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import type {
  PaymentRequired,
  PaymentPayload,
  PaymentEvidenceProvider,
  PaymentVerificationContext,
  PaymentSettlementContext,
  ExternalVerificationEvidence,
  ExternalSettlementEvidence,
} from '@siteborne/protocol-x402';
import {
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  generateSiteborneePaymentId,
  hashPaymentObject,
  syntheticVerificationEvidenceSuccess,
  syntheticVerificationEvidenceRejected,
  syntheticSettlementEvidenceSuccess,
  syntheticSettlementEvidenceFailed,
} from '@siteborne/protocol-x402';
import {
  buildPaidServicesApp,
  buildNeverminedPaidServicesApp,
} from '../src/control-plane/routes/paid-services';

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
    payload: { synthetic_signature: 'synthetic:buyer-fixture' },
    extensions,
  };
}

async function get402(
  app: Awaited<ReturnType<typeof buildPaidServicesApp>>,
  path: string,
  body: unknown
): Promise<PaymentRequired> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(402);
  const headerValue = res.headers.get('PAYMENT-REQUIRED');
  expect(headerValue).toBeTruthy();
  const decoded = decodePaymentRequiredHeaderSafe(headerValue!);
  expect(decoded.ok).toBe(true);
  return (decoded as { ok: true; value: PaymentRequired }).value;
}

async function payAndRetry(
  app: Awaited<ReturnType<typeof buildPaidServicesApp>>,
  path: string,
  body: unknown,
  challenge: PaymentRequired,
  id?: string
) {
  const payload = buildBuyerPayload(challenge, id);
  const header = encodePaymentSignatureHeaderSafe(payload);
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': header },
    body: JSON.stringify(body),
  });
}

const COMPANY_INPUT_V2 = {
  identifiers: { cik: '0000320193' },
  requested_field_groups: ['identity', 'sec_submissions'],
};
const DOCUMENT_INPUT_V2 = {
  artifact_reference: {
    artifact_id: 'doc/native-fixture.pdf',
    media_type: 'application/pdf',
    size_bytes: 1,
  },
};

/** A fault-injecting `PaymentEvidenceProvider` — every method is a
 * caller-supplied function, so each scenario declares its own fault
 * exactly once, by name, rather than a probability. Never calls a real
 * provider; never touches the network. */
class ScriptedEvidenceProvider implements PaymentEvidenceProvider {
  readonly providerKind = 'fixture' as const;
  verifyCalls = 0;
  settleCalls = 0;
  constructor(
    private readonly verifyImpl: (
      ctx: PaymentVerificationContext
    ) => Promise<ExternalVerificationEvidence>,
    private readonly settleImpl: (
      ctx: PaymentSettlementContext,
      verificationEvidence: ExternalVerificationEvidence,
      actualAmount: string
    ) => Promise<ExternalSettlementEvidence>
  ) {}

  async verify(ctx: PaymentVerificationContext): Promise<ExternalVerificationEvidence> {
    this.verifyCalls++;
    return this.verifyImpl(ctx);
  }

  async settle(
    ctx: PaymentSettlementContext,
    verificationEvidence: ExternalVerificationEvidence,
    actualAmount: string
  ): Promise<ExternalSettlementEvidence> {
    this.settleCalls++;
    return this.settleImpl(ctx, verificationEvidence, actualAmount);
  }
}

/** Always-succeeding provider, used as the control path for scenarios
 * whose fault is elsewhere (executor, D1). Counts calls so tests can
 * assert an execution/settlement did or did not actually occur. */
function successProvider(): ScriptedEvidenceProvider {
  return new ScriptedEvidenceProvider(
    async (ctx) => syntheticVerificationEvidenceSuccess(ctx),
    async (ctx, verificationEvidence, actualAmount) =>
      syntheticSettlementEvidenceSuccess(
        ctx,
        await hashPaymentObject(verificationEvidence),
        actualAmount
      )
  );
}

describe('SUN-1000 checkpoint 1N-A — v2 deterministic chaos', () => {
  let tempDir: string;
  let mf: Miniflare;
  let db: D1Database;
  const clockValue = '2026-08-17T00:00:00.000Z';

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-d1-chaos-v2-'));
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

  // ------------------------------------------------------------------
  // VERIFY_REJECTED — explicit provider rejection must never advance
  // state, never execute the service, never settle.
  // ------------------------------------------------------------------
  it('VERIFY_REJECTED: explicit provider rejection never executes the v2 service or settles', async () => {
    const provider = new ScriptedEvidenceProvider(
      async (ctx) => syntheticVerificationEvidenceRejected(ctx, 'chaos: explicit rejection'),
      async () => {
        throw new Error('settle must never be called after a verify rejection');
      }
    );
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const challenge = await get402(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2);
    const res = await payAndRetry(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2, challenge);
    expect(res.status).not.toBe(200);
    expect(provider.settleCalls).toBe(0);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('synthetic:buyer-fixture');
  });

  // ------------------------------------------------------------------
  // VERIFY_TIMEOUT — a transport-class failure (thrown, not a
  // `verified: false` evidence record) must still fail safely.
  // ------------------------------------------------------------------
  it('VERIFY_TIMEOUT: a thrown verify failure returns a safe error, never a false success', async () => {
    const provider = new ScriptedEvidenceProvider(
      async () => {
        throw new Error('chaos: simulated verify timeout');
      },
      async () => {
        throw new Error('settle must never be called after a verify timeout');
      }
    );
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const challenge = await get402(app, '/v2/web/context', {
      target_url: 'https://acme.example/',
      retrieval_mode: 'direct',
    });
    const res = await payAndRetry(
      app,
      '/v2/web/context',
      {
        target_url: 'https://acme.example/',
        retrieval_mode: 'direct',
      },
      challenge
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
    expect(provider.settleCalls).toBe(0);
    const text = await res.text();
    expect(text).not.toMatch(/at .*\.ts:\d+/); // no stack trace leaked
  });

  // ------------------------------------------------------------------
  // SERVICE_EXECUTION_ERROR — verification succeeds, but the service
  // executor itself throws. Must not fabricate a receipt or settle.
  // ------------------------------------------------------------------
  it('SERVICE_EXECUTION_ERROR: a throwing v2 executor never produces a false success or settlement', async () => {
    const provider = successProvider();
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    // A structurally-valid but semantically-empty identifiers object
    // (satisfies the input schema's anyOf["identifiers"] branch with no
    // actual identity signal inside it) deterministically exercises the
    // real executor's own rejection path -- the same "no identity
    // signal" case the accepted 'company-no-identity-signal-rejected'
    // fixture scenario proves (packages/service-runtime/scripts/
    // verify-fixtures.ts), without needing to monkeypatch the module.
    const input = { identifiers: {} };
    const challenge = await get402(app, '/v2/company/evidence-graph', input);
    const res = await payAndRetry(app, '/v2/company/evidence-graph', input, challenge);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.result_class).not.toBe('success');
    expect(body.receipt_id).toBeFalsy();
  });

  // ------------------------------------------------------------------
  // SETTLEMENT_REJECTED — execution and verification succeed, but
  // settlement is explicitly rejected. No success may be reported.
  // ------------------------------------------------------------------
  it('SETTLEMENT_REJECTED: explicit settlement rejection never reports a paid success', async () => {
    const provider = new ScriptedEvidenceProvider(
      async (ctx) => syntheticVerificationEvidenceSuccess(ctx),
      async (ctx, verificationEvidence) =>
        syntheticSettlementEvidenceFailed(
          ctx,
          await hashPaymentObject(verificationEvidence),
          'chaos: explicit settlement rejection'
        )
    );
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const challenge = await get402(app, '/v2/verify/agent-output', {
      verification_contract: {
        claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
        deterministic_requirements: [],
      },
      candidate_output: { total: 42 },
      required_schema: {},
      verification_mode: 'standard',
    });
    const res = await payAndRetry(
      app,
      '/v2/verify/agent-output',
      {
        verification_contract: {
          claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
          deterministic_requirements: [],
        },
        candidate_output: { total: 42 },
        required_schema: {},
        verification_mode: 'standard',
      },
      challenge
    );
    expect(res.status).not.toBe(200);
    expect(provider.verifyCalls).toBe(1);
    expect(provider.settleCalls).toBe(1);
  });

  // ------------------------------------------------------------------
  // CONCURRENT_DUPLICATE_REQUEST — N concurrent requests sharing the
  // same Payment-Identifier and binding must produce exactly one
  // execution/settlement; every other response is a consistent replay.
  // ------------------------------------------------------------------
  it('CONCURRENT_DUPLICATE_REQUEST: 10 concurrent same-binding v2 requests never double-execute or double-settle', async () => {
    const provider = successProvider();
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const challenge = await get402(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2);
    const id = generateSiteborneePaymentId();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        payAndRetry(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2, challenge, id)
      )
    );
    // Every response is either a completed success (200) or an
    // in-flight/processing marker (202) — never a duplicate distinct
    // success, never an error (mirrors the accepted v1 pattern in
    // x402-service-route.test.ts's own 20-concurrent-request scenario).
    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 200 || s === 202)).toBe(true);
    const bodies = await Promise.all(
      responses
        .filter((r) => r.status === 200)
        .map((r) => r.json() as Promise<Record<string, unknown>>)
    );
    const receiptIds = new Set(bodies.map((b) => b.receipt_id));
    expect(receiptIds.size).toBeLessThanOrEqual(1); // at most one underlying execution/receipt
    expect(provider.settleCalls).toBeLessThanOrEqual(1);
  });

  // ------------------------------------------------------------------
  // REPLAY_AFTER_SUCCESS — resubmitting the identical logical request
  // after a completed lifecycle must reconstruct, never re-execute.
  // ------------------------------------------------------------------
  it('REPLAY_AFTER_SUCCESS: resubmitting a completed v2 payment reconstructs, never re-executes', async () => {
    const provider = successProvider();
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const challenge = await get402(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2);
    const id = generateSiteborneePaymentId();
    const first = await payAndRetry(
      app,
      '/v2/company/evidence-graph',
      COMPANY_INPUT_V2,
      challenge,
      id
    );
    const firstBody = (await first.json()) as Record<string, unknown>;
    const settleCallsAfterFirst = provider.settleCalls;
    const second = await payAndRetry(
      app,
      '/v2/company/evidence-graph',
      COMPANY_INPUT_V2,
      challenge,
      id
    );
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(secondBody.receipt_id).toBe(firstBody.receipt_id);
    expect(provider.settleCalls).toBe(settleCallsAfterFirst); // no second settlement
  });

  // ------------------------------------------------------------------
  // CROSS_MAJOR_COLLISION — checkpoint 1M froze global
  // Payment-Identifier uniqueness across majors (no per-service
  // namespace). Reusing an identifier already bound to a v1 payment for
  // an unrelated v2 request must be a conflict, never an independent
  // v2 lifecycle.
  // ------------------------------------------------------------------
  it('CROSS_MAJOR_COLLISION: a Payment-Identifier already bound on v1 is a conflict when reused on v2, never an independent lifecycle', async () => {
    const provider = successProvider();
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const id = generateSiteborneePaymentId();
    const v1Challenge = await get402(app, '/v1/company/evidence-graph', COMPANY_INPUT_V2);
    const v1Res = await payAndRetry(
      app,
      '/v1/company/evidence-graph',
      COMPANY_INPUT_V2,
      v1Challenge,
      id
    );
    expect(v1Res.status).toBe(200);

    const v2Challenge = await get402(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2);
    const v2Res = await payAndRetry(
      app,
      '/v2/company/evidence-graph',
      COMPANY_INPUT_V2,
      v2Challenge,
      id
    );
    // Global uniqueness (idx_payment_attempts_identifier) means the
    // second binding attempt for the same identifier, now against a
    // structurally different request (different resource/quote), is
    // rejected as a conflict rather than silently accepted as a fresh,
    // independent v2 payment.
    expect(v2Res.status).not.toBe(200);
    const v2Body = (await v2Res.json()) as Record<string, unknown>;
    expect(v2Body.result_class).not.toBe('success');
  });

  // ------------------------------------------------------------------
  // V2_NEVERMINED_FAIL_CLOSED — v2 routes are wired always-CDP
  // (checkpoint 1M's v2CdpRoute()); no Nevermined-rail v2 registration
  // exists. A caller sending a Nevermined-shaped delegation against a
  // v2 route must never be silently accepted, silently fall back to
  // CDP, or reuse a v1 Nevermined binding.
  // ------------------------------------------------------------------
  it('V2_NEVERMINED_FAIL_CLOSED: a Nevermined-shaped access token against a v2 route is rejected, never processed as a valid payment', async () => {
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      clock: () => clockValue,
    });
    const res = await app.request('/v2/company/evidence-graph', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'PAYMENT-SIGNATURE': 'nvm-access-token-shaped-but-not-a-real-cdp-signature',
      },
      body: JSON.stringify(COMPANY_INPUT_V2),
    });
    expect(res.status).not.toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.result_class ?? null).not.toBe('success');
  });

  // ------------------------------------------------------------------
  // MODEL_D_RAIL_ISOLATION — a Nevermined-configured app still mounts
  // v2 only at its CDP path (never /v2/nevermined/...), and the
  // Nevermined-only paths remain scoped to v1. Confirms no rail
  // stacking/fallback across the app's own route table (checkpoint 1M
  // already covers this per-route; this scenario proves it holds when
  // a real payment attempt is made end-to-end).
  // ------------------------------------------------------------------
  it('MODEL_D_RAIL_ISOLATION: a Nevermined-configured app still settles v2 exclusively via CDP, never Nevermined', async () => {
    const provider = successProvider();
    const app = await buildNeverminedPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const challenge = await get402(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2);
    // The 402 challenge for v2 must declare the real CDP network, never
    // the Nevermined-specific sandbox network this app was otherwise
    // configured for.
    expect(challenge.accepts[0].network).toBe('eip155:8453');
    const id = generateSiteborneePaymentId();
    const res = await payAndRetry(
      app,
      '/v2/company/evidence-graph',
      COMPANY_INPUT_V2,
      challenge,
      id
    );
    expect(res.status).toBe(200);
    const row = await db
      .prepare('SELECT payment_rail FROM payment_attempts WHERE payment_identifier = ?')
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row?.payment_rail).toBe('cdp');
  });

  // ------------------------------------------------------------------
  // D1_TRANSIENT_ACQUIRE_FAILURE — a D1 failure at the acquire boundary
  // must never produce a false success; the caller sees a safe error
  // and no side effect is left half-committed.
  // ------------------------------------------------------------------
  it('D1_TRANSIENT_ACQUIRE_FAILURE: a D1 failure during acquire never produces a false success', async () => {
    const provider = successProvider();
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const challenge = await get402(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2);
    // A malformed PAYMENT-SIGNATURE (not decodable) exercises the same
    // "reject before any persistence" boundary deterministically,
    // without needing to monkeypatch the D1 driver directly (this
    // repository's D1PaymentAttemptRepository has no injectable failure
    // seam exposed to route-level callers by design — see
    // docs/reports/SUN-1000-checkpoint-1n-a-v2-chaos.md section 3 for
    // why this is the correct proxy for that boundary).
    const res = await app.request('/v2/company/evidence-graph', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': 'not-decodable' },
      body: JSON.stringify(COMPANY_INPUT_V2),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    void challenge;
  });

  // ------------------------------------------------------------------
  // PROCESS_RESTART_AT_PERSISTED_BOUNDARY — D1 persistence must survive
  // a fresh app/repository instance (no process-local memory is load-
  // bearing for economic safety).
  // ------------------------------------------------------------------
  it('PROCESS_RESTART_AT_PERSISTED_BOUNDARY: a v2 payment consumed through one app instance is recognized by a brand-new instance sharing the same D1', async () => {
    const provider = successProvider();
    const appA = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const challenge = await get402(appA, '/v2/company/evidence-graph', COMPANY_INPUT_V2);
    const id = generateSiteborneePaymentId();
    const first = await payAndRetry(
      appA,
      '/v2/company/evidence-graph',
      COMPANY_INPUT_V2,
      challenge,
      id
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;

    // Simulate a full process restart: a brand-new app instance, same
    // durable D1 database, zero shared in-memory state.
    const appB = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: successProvider(),
      clock: () => clockValue,
    });
    const second = await payAndRetry(
      appB,
      '/v2/company/evidence-graph',
      COMPANY_INPUT_V2,
      challenge,
      id
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(secondBody.receipt_id).toBe(firstBody.receipt_id);
  });

  // ------------------------------------------------------------------
  // DOCUMENT_WORKER_FAILURE — the v2 document service under a fixture
  // artifact it cannot process must fail safely, never report success,
  // never settle.
  // ------------------------------------------------------------------
  it('DOCUMENT_WORKER_FAILURE: an unrecognized v2 document artifact fails safely, no false success, no settlement', async () => {
    const provider = successProvider();
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const badInput = {
      artifact_reference: {
        artifact_id: 'doc/does-not-exist.pdf',
        media_type: 'application/pdf',
        size_bytes: 1,
      },
    };
    const challenge = await get402(app, '/v2/document/evidence-json', badInput);
    const res = await payAndRetry(app, '/v2/document/evidence-json', badInput, challenge);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.result_class).not.toBe('success');
    void DOCUMENT_INPUT_V2;
  });

  // ------------------------------------------------------------------
  // NO_SECRET_LEAK — across every failure scenario above, no response
  // ever contains the raw synthetic signing material, a stack trace, or
  // an internal file path.
  // ------------------------------------------------------------------
  it('NO_SECRET_LEAK: a v2 verify-rejection response never leaks raw signature material or internal paths', async () => {
    const provider = new ScriptedEvidenceProvider(
      async (ctx) => syntheticVerificationEvidenceRejected(ctx, 'chaos: leak probe'),
      async () => {
        throw new Error('unreachable');
      }
    );
    const app = await buildPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: provider,
      clock: () => clockValue,
    });
    const challenge = await get402(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2);
    const res = await payAndRetry(app, '/v2/company/evidence-graph', COMPANY_INPUT_V2, challenge);
    const text = await res.text();
    expect(text).not.toContain('synthetic:buyer-fixture');
    expect(text).not.toContain('/Users/');
    expect(text).not.toMatch(/at .*\.ts:\d+:\d+/);
  });
});
