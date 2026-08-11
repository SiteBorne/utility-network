import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import {
  NEVERMINED_ROUTES,
  PAYMENT_IDENTIFIER_HEADER,
  decodeNeverminedPaymentRequiredHeaderSafe,
  decodeNeverminedPaymentResponseHeaderSafe,
  type NeverminedFacilitatorClient,
  type NeverminedPaymentRequired,
} from '@siteborne/protocol-nevermined';
import { generateSiteborneePaymentId } from '@siteborne/protocol-x402';
import { NeverminedPaymentEvidenceProvider } from '../src/control-plane/evidence/nevermined-provider';
import { buildNeverminedPaidServicesApp } from '../src/control-plane/routes/paid-services';
import { buildPaidServicesApp } from '../src/control-plane/routes/paid-services';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));
const PAYMENT_CARRIER = 'fixture_000000000000000000000000000000';
const BUYER = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99';

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

const COMPANY_INPUT = {
  identifiers: { cik: '0000320193' },
  requested_field_groups: ['identity', 'sec_submissions'],
};
const WEB_INPUT = { target_url: 'https://acme.example/', retrieval_mode: 'direct' };
const DOCUMENT_INPUT = {
  artifact_reference: {
    artifact_id: 'doc/native-fixture.pdf',
    media_type: 'application/pdf',
    size_bytes: 1,
  },
};
const AGENT_INPUT = {
  verification_contract: {
    claims: [{ claim_id: 'total', predicate: 'equals', expected_value: 42 }],
    deterministic_requirements: [],
  },
  candidate_output: { total: 42 },
  required_schema: {},
  verification_mode: 'standard',
};

function client(counters: { verify: number; settle: number }): NeverminedFacilitatorClient {
  return {
    async verifyPermissions() {
      counters.verify += 1;
      return {
        isValid: true,
        payer: BUYER,
        network: 'eip155:84532',
        agentRequestId: `fixture-request-${counters.verify}`,
      };
    },
    async settlePermissions(input) {
      counters.settle += 1;
      return {
        success: true,
        payer: BUYER,
        transaction: `fixture:settlement:${counters.settle}`,
        network: 'eip155:84532',
        creditsRedeemed: input.actualAmount,
        remainingBalance: '988000',
      };
    },
  };
}

async function challenge(
  app: Awaited<ReturnType<typeof buildNeverminedPaidServicesApp>>,
  path: string,
  body: unknown
) {
  const response = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(402);
  const decoded = decodeNeverminedPaymentRequiredHeaderSafe(
    response.headers.get('PAYMENT-REQUIRED') ?? ''
  );
  expect(decoded.ok).toBe(true);
  return (decoded as { ok: true; value: NeverminedPaymentRequired }).value;
}

function pay(
  app: Awaited<ReturnType<typeof buildNeverminedPaidServicesApp>>,
  path: string,
  body: unknown,
  paymentIdentifier: string
) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'payment-signature': PAYMENT_CARRIER,
      [PAYMENT_IDENTIFIER_HEADER]: paymentIdentifier,
    },
    body: JSON.stringify(body),
  });
}

describe('Nevermined alternative rail HTTP lifecycle', () => {
  let tempDir: string;
  let miniflare: Miniflare;
  let db: D1Database;
  let counters: { verify: number; settle: number };
  let app: Awaited<ReturnType<typeof buildNeverminedPaidServicesApp>>;
  const now = '2026-08-11T02:00:00.000Z';

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'siteborne-nevermined-http-'));
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      d1Persist: join(tempDir, 'test.db'),
    });
    db = await miniflare.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    counters = { verify: 0, settle: 0 };
    app = await buildNeverminedPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: NeverminedPaymentEvidenceProvider.fixture(client(counters)),
      clock: () => now,
    });
  }, 30_000);

  afterAll(async () => {
    await miniflare.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('mounts exactly the four declared Nevermined-only routes', () => {
    expect(
      app.routes
        .filter((route) => route.method === 'POST')
        .map((route) => route.path)
        .sort()
    ).toEqual(Object.values(NEVERMINED_ROUTES).sort());
  });

  it('fails closed when no Nevermined provider is supplied or a fixture is selected for production', async () => {
    await expect(
      buildPaidServicesApp({ db, evidenceMode: 'fixture', rail: 'nevermined', clock: () => now })
    ).rejects.toThrow(/Nevermined.*provider/i);
    await expect(
      buildNeverminedPaidServicesApp({
        db,
        evidenceMode: 'production',
        evidenceProvider: NeverminedPaymentEvidenceProvider.fixture(
          client({ verify: 0, settle: 0 })
        ),
        clock: () => now,
      })
    ).rejects.toThrow(/production/i);
  });

  it.each([
    [NEVERMINED_ROUTES['company_evidence_graph.v1'], COMPANY_INPUT, '39000', 'exact'],
    [NEVERMINED_ROUTES['web_context_verified.v1'], WEB_INPUT, '9000', 'exact'],
    [NEVERMINED_ROUTES['document_evidence_json.v1'], DOCUMENT_INPUT, '190000', 'upto'],
    [NEVERMINED_ROUTES['verify_agent_output.v1'], AGENT_INPUT, '19000', 'exact'],
  ])(
    '%s issues the official scheme with canonical amount %s',
    async (path, input, amount, semantics) => {
      const required = await challenge(app, path, input);
      expect(required).toMatchObject({
        x402Version: 2,
        resource: { url: `http://localhost${path}` },
        accepts: [{ scheme: 'nvm:erc4337', network: 'eip155:84532' }],
      });
      expect(required.extensions['net.siteborne.payment']).toMatchObject({
        amount,
        semantics,
        production_enabled: false,
        payment_identifier_required: true,
      });
    }
  );

  it('runs fixed PAYG through D1, service/PCC/linkage, settle, and a bounded response', async () => {
    await challenge(app, NEVERMINED_ROUTES['company_evidence_graph.v1'], COMPANY_INPUT);
    const id = generateSiteborneePaymentId();
    const response = await pay(
      app,
      NEVERMINED_ROUTES['company_evidence_graph.v1'],
      COMPANY_INPUT,
      id
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ result_class: 'success' });
    expect(body.receipt_id).toBeTruthy();
    expect(body.link_id).toBeTruthy();
    const settled = decodeNeverminedPaymentResponseHeaderSafe(
      response.headers.get('PAYMENT-RESPONSE') ?? ''
    );
    expect(settled).toMatchObject({ ok: true, value: { creditsRedeemed: '39000' } });
    const attempt = await db
      .prepare(
        'SELECT payment_rail, payment_provider, nevermined_agent_id, nevermined_plan_id, consumed_at FROM payment_attempts WHERE payment_identifier = ?'
      )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(attempt).toMatchObject({
      payment_rail: 'nevermined',
      payment_provider: 'nevermined-payments@1.10.0',
    });
    expect(attempt?.consumed_at).toBeTruthy();
  });

  it('authorizes document maximum 190000 but calculates and settles actual usage 12000', async () => {
    await challenge(app, NEVERMINED_ROUTES['document_evidence_json.v1'], DOCUMENT_INPUT);
    const response = await pay(
      app,
      NEVERMINED_ROUTES['document_evidence_json.v1'],
      DOCUMENT_INPUT,
      generateSiteborneePaymentId()
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ authorized_maximum: '190000', actual_amount: '12000' });
    const decoded = decodeNeverminedPaymentResponseHeaderSafe(
      response.headers.get('PAYMENT-RESPONSE') ?? ''
    );
    expect(decoded).toMatchObject({ ok: true, value: { creditsRedeemed: '12000' } });
  });

  it('reconstructs replay from D1 with no second verify, settle, job, or result', async () => {
    await challenge(app, NEVERMINED_ROUTES['web_context_verified.v1'], WEB_INPUT);
    const id = generateSiteborneePaymentId();
    const before = { ...counters };
    const first = await pay(app, NEVERMINED_ROUTES['web_context_verified.v1'], WEB_INPUT, id);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    const second = await pay(app, NEVERMINED_ROUTES['web_context_verified.v1'], WEB_INPUT, id);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(secondBody.link_id).toBe(firstBody.link_id);
    expect(counters.verify - before.verify).toBe(1);
    expect(counters.settle - before.settle).toBe(1);
    const jobs = await db
      .prepare('SELECT COUNT(*) AS count FROM jobs WHERE idempotency_key = ?')
      .bind(id)
      .first<{ count: number }>();
    expect(jobs?.count).toBe(1);
  });

  it('same Payment-Identifier with changed input is a conflict and leaks no prior result', async () => {
    await challenge(app, NEVERMINED_ROUTES['company_evidence_graph.v1'], COMPANY_INPUT);
    const id = generateSiteborneePaymentId();
    expect(
      (await pay(app, NEVERMINED_ROUTES['company_evidence_graph.v1'], COMPANY_INPUT, id)).status
    ).toBe(200);
    const changed = { ...COMPANY_INPUT, requested_field_groups: ['identity'] };
    await challenge(app, NEVERMINED_ROUTES['company_evidence_graph.v1'], changed);
    const conflict = await pay(app, NEVERMINED_ROUTES['company_evidence_graph.v1'], changed, id);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: 'replay_conflict' });
  });

  it('rejects malformed token and missing Payment-Identifier before provider verification', async () => {
    const before = counters.verify;
    const malformed = await app.request(NEVERMINED_ROUTES['company_evidence_graph.v1'], {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'payment-signature': 'contains spaces',
        [PAYMENT_IDENTIFIER_HEADER]: generateSiteborneePaymentId(),
      },
      body: JSON.stringify(COMPANY_INPUT),
    });
    expect(malformed.status).toBe(400);
    const missingId = await app.request(NEVERMINED_ROUTES['company_evidence_graph.v1'], {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'payment-signature': PAYMENT_CARRIER },
      body: JSON.stringify(COMPANY_INPUT),
    });
    expect(missingId.status).toBe(400);
    expect(counters.verify).toBe(before);
  });

  it('rejects a mutated stored plan binding locally before provider verification', async () => {
    const input = { target_url: 'https://mutated-plan.example/', retrieval_mode: 'direct' };
    const required = await challenge(app, NEVERMINED_ROUTES['web_context_verified.v1'], input);
    const extension = required.extensions['net.siteborne.payment'] as { quote_id: string };
    const mutated = {
      ...required,
      accepts: [{ ...required.accepts[0], planId: 'mutated-plan' }],
    };
    await db
      .prepare('UPDATE x402_quotes SET requirement_json = ? WHERE quote_id = ?')
      .bind(JSON.stringify(mutated), extension.quote_id)
      .run();
    const before = counters.verify;
    const response = await pay(
      app,
      NEVERMINED_ROUTES['web_context_verified.v1'],
      input,
      generateSiteborneePaymentId()
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_payment_structure' });
    expect(counters.verify).toBe(before);
  });

  it('provider verification rejection executes and settles zero times', async () => {
    const rejectedCounters = { verify: 0, settle: 0 };
    const rejectedApp = await buildNeverminedPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: NeverminedPaymentEvidenceProvider.fixture({
        async verifyPermissions() {
          rejectedCounters.verify += 1;
          return { isValid: false, invalidReason: 'permissions_denied' };
        },
        async settlePermissions() {
          rejectedCounters.settle += 1;
          throw new Error('must not settle');
        },
      }),
      clock: () => now,
    });
    const beforeExecution = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'service_execution_started'"
      )
      .first<{ count: number }>();
    await challenge(rejectedApp, NEVERMINED_ROUTES['verify_agent_output.v1'], AGENT_INPUT);
    const response = await pay(
      rejectedApp,
      NEVERMINED_ROUTES['verify_agent_output.v1'],
      AGENT_INPUT,
      generateSiteborneePaymentId()
    );
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: 'payment_verification_rejected' });
    const afterExecution = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'service_execution_started'"
      )
      .first<{ count: number }>();
    expect(rejectedCounters).toEqual({ verify: 1, settle: 0 });
    expect(afterExecution?.count).toBe(beforeExecution?.count);
  });

  it('provider verification exception is normalized and cannot fall back to CDP', async () => {
    const exceptionCounters = { verify: 0, settle: 0 };
    const exceptionApp = await buildNeverminedPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: NeverminedPaymentEvidenceProvider.fixture({
        async verifyPermissions() {
          exceptionCounters.verify += 1;
          throw new Error(`unsafe ${PAYMENT_CARRIER}`);
        },
        async settlePermissions() {
          exceptionCounters.settle += 1;
          throw new Error('must not settle');
        },
      }),
      clock: () => now,
    });
    await challenge(exceptionApp, NEVERMINED_ROUTES['company_evidence_graph.v1'], COMPANY_INPUT);
    const response = await pay(
      exceptionApp,
      NEVERMINED_ROUTES['company_evidence_graph.v1'],
      COMPANY_INPUT,
      generateSiteborneePaymentId()
    );
    expect(response.status).toBe(402);
    expect(JSON.stringify(await response.json())).not.toContain(PAYMENT_CARRIER);
    expect(exceptionCounters).toEqual({ verify: 1, settle: 0 });
  });

  it('settlement rejection returns no success/header and leaves D1 unconsumed', async () => {
    const rejectedCounters = { verify: 0, settle: 0 };
    const rejectedApp = await buildNeverminedPaidServicesApp({
      db,
      evidenceMode: 'fixture',
      evidenceProvider: NeverminedPaymentEvidenceProvider.fixture({
        async verifyPermissions() {
          rejectedCounters.verify += 1;
          return {
            isValid: true,
            payer: BUYER,
            network: 'eip155:84532',
            agentRequestId: 'reject-settle-request',
          };
        },
        async settlePermissions() {
          rejectedCounters.settle += 1;
          return {
            success: false,
            errorReason: 'settlement_denied',
            transaction: '',
            network: 'eip155:84532',
          };
        },
      }),
      clock: () => now,
    });
    await challenge(rejectedApp, NEVERMINED_ROUTES['web_context_verified.v1'], WEB_INPUT);
    const id = generateSiteborneePaymentId();
    const response = await pay(
      rejectedApp,
      NEVERMINED_ROUTES['web_context_verified.v1'],
      WEB_INPUT,
      id
    );
    expect(response.status).toBe(402);
    expect(response.headers.get('PAYMENT-RESPONSE')).toBeNull();
    expect(await response.json()).toMatchObject({ error: 'settlement_rejected' });
    const attempt = await db
      .prepare(
        'SELECT lifecycle_stage, consumed_at FROM payment_attempts WHERE payment_identifier = ?'
      )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(attempt).toEqual({ lifecycle_stage: 'settlement_failed', consumed_at: null });
    expect(rejectedCounters).toEqual({ verify: 1, settle: 1 });
  });

  it('never persists the opaque payment-signature in audit or result records', async () => {
    const audits = await db
      .prepare('SELECT details FROM audit_events WHERE details LIKE ?')
      .bind(`%${PAYMENT_CARRIER}%`)
      .all();
    const results = await db
      .prepare('SELECT result_json FROM x402_service_results WHERE result_json LIKE ?')
      .bind(`%${PAYMENT_CARRIER}%`)
      .all();
    expect(audits.results).toHaveLength(0);
    expect(results.results).toHaveLength(0);
  });

  it('performs no global network request in fixture mode', async () => {
    const originalFetch = globalThis.fetch;
    let attempted = false;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      attempted = true;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      await challenge(app, NEVERMINED_ROUTES['verify_agent_output.v1'], AGENT_INPUT);
      const response = await pay(
        app,
        NEVERMINED_ROUTES['verify_agent_output.v1'],
        AGENT_INPUT,
        generateSiteborneePaymentId()
      );
      expect(response.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(attempted).toBe(false);
  });
});
