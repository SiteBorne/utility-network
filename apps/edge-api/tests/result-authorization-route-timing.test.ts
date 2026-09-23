import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import {
  FixturePaymentEvidenceProvider,
  buildBuyerPaymentIdentifierExtensions,
  decodePaymentRequiredHeaderSafe,
  encodePaymentSignatureHeaderSafe,
  type PaymentEvidenceProvider,
  type PaymentPayload,
  type PaymentRequired,
} from '@siteborne/protocol-x402';
import { createX402ServiceRoute } from '../src/control-plane/routes/x402-service';
import type { VerifiedPrincipalEvidence } from '../src/control-plane/security/result-authorization';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations', import.meta.url));
const NOW = '2026-09-22T12:00:00.000Z';
const KEY = new Uint8Array(32).fill(0x4a);

async function runMigrations(db: D1Database): Promise<void> {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of sql
      .split(';')
      .map((raw) =>
        raw
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('--'))
          .join(' ')
          .trim()
      )
      .filter(Boolean)) {
      await db.exec(statement);
    }
  }
}

function principal(subjectId: string): VerifiedPrincipalEvidence {
  return {
    verification_status: 'VERIFIED',
    evidence_type: 'cryptographically_authenticated',
    verifier_id: 'siteborne.identity-evidence-verifier.v1',
    subject: {
      schema_version: 'result_subject.v1',
      subject_type: 'human',
      issuer: 'https://identity.siteborne.test',
      subject_id: subjectId,
      authentication_method: 'oidc',
      assurance_level: 'verified_single_factor',
      authenticated_at: NOW,
      credential_binding: null,
    },
  };
}

function buyerPayload(challenge: PaymentRequired): PaymentPayload {
  return {
    x402Version: 2,
    resource: challenge.resource,
    accepted: challenge.accepts[0]!,
    payload: { synthetic_signature: 'synthetic:buyer-fixture' },
    extensions: buildBuyerPaymentIdentifierExtensions(challenge.extensions ?? {}),
  };
}

describe('buyer-authorized v3 route binding timing', () => {
  let directory: string;
  let miniflare: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'siteborne-result-auth-route-'));
    miniflare = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response('OK'); } }`,
      d1Databases: ['DB'],
      resourcePersistencePath: directory,
    });
    db = await miniflare.getD1Database('DB');
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db);
    for (const id of ['document_evidence_json.v3', 'verify_agent_output.v3']) {
      await db
        .prepare(
          `INSERT INTO services (id, version, title, description, input_schema, output_schema, price_usd)
           VALUES (?, 'v3', 'candidate', 'candidate', '{}', '{}', '0')`
        )
        .bind(id)
        .run();
    }
  }, 30_000);

  afterAll(async () => {
    await miniflare.dispose();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each([
    ['document_evidence_json.v3', '/v3/document/evidence-json'],
    ['verify_agent_output.v3', '/v3/verify/agent-output'],
  ] as const)(
    '%s persists the subject binding before payment-provider invocation',
    async (serviceId, path) => {
      const fixture = new FixturePaymentEvidenceProvider();
      const verify = vi.fn<PaymentEvidenceProvider['verify']>(async (context) => {
        const row = await db
          .prepare(
            `SELECT b.owner_subject_ref
             FROM result_subject_bindings b
             JOIN jobs j ON j.id = b.operation_id
            WHERE j.idempotency_key = ?`
          )
          .bind(context.payment_identifier)
          .first();
        expect(String(row?.owner_subject_ref)).toMatch(/^k1:[a-f0-9]{64}$/);
        return { ...(await fixture.verify(context)), verified: false };
      });
      const provider: PaymentEvidenceProvider = {
        providerKind: 'fixture',
        verify,
        settle: (...args) => fixture.settle(...args),
      };
      const app = new Hono();
      createX402ServiceRoute(app, {
        serviceId,
        scheme: 'exact',
        pricingKey: 'verify_agent_output_standard',
        network: 'eip155:84532',
        asset: '0x0000000000000000000000000000000000000001',
        path,
        inputSchema: { type: 'object' },
        inputValidator: Object.assign(() => true, { errors: null }) as never,
        contractRelease: '3.0.0',
        inputSchemaHash: `sha256:${'1'.repeat(64)}`,
        outputSchemaHash: `sha256:${'2'.repeat(64)}`,
        pccDependency: '2.0.0',
        db,
        clock: () => NOW,
        evidenceMode: 'fixture',
        evidenceProvider: provider,
        executor: async () => ({ result: { result_class: 'success' } }),
        resultAuthorization: {
          authenticate: async (context) =>
            context.req.header('Authorization') === 'Bearer owner' ? principal('buyer-1') : null,
          subjectReferenceKey: { key: KEY, keyVersion: 'k1' },
          revokedSubjectRefs: async () => [],
        },
      });

      const unauthenticated = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(unauthenticated.status).toBe(401);
      expect(verify).not.toHaveBeenCalled();

      const challengeResponse = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' },
        body: '{}',
      });
      expect(challengeResponse.status).toBe(402);
      const decoded = decodePaymentRequiredHeaderSafe(
        challengeResponse.headers.get('PAYMENT-REQUIRED') ?? ''
      );
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) throw new Error(decoded.error);

      const paid = await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer owner',
          'PAYMENT-SIGNATURE': encodePaymentSignatureHeaderSafe(buyerPayload(decoded.value)),
        },
        body: '{}',
      });
      expect(paid.status).toBe(402);
      expect(verify).toHaveBeenCalledTimes(1);
    }
  );
});
