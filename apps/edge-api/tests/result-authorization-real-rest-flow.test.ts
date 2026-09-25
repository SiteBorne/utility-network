import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
import {
  createMcpX402ServiceBoundary,
  type McpX402RouteHandler,
} from '../src/control-plane/mcp/x402-mcp-adapter';
import { X402ServiceResultRepository } from '../src/control-plane/repositories/d1/x402-quotes';
import { D1ResultAuthorizationRepository } from '../src/control-plane/repositories/d1/result-authorization';
import type {
  WorkflowBindingLike,
  WorkflowInstanceLike,
} from '../src/control-plane/continuation/handoff';
import type { VerifiedPrincipalEvidence } from '../src/control-plane/security/result-authorization';
import { consumeVerifiedPrincipal } from '../src/control-plane/security/verified-principal-context';

vi.mock('../src/control-plane/results/pcc-result-artifact', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/control-plane/results/pcc-result-artifact')>();
  return { ...actual, validateGovernedVNextPcc: async () => null };
});

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

class CompletedInstance implements WorkflowInstanceLike {
  constructor(
    readonly id: string,
    private readonly output: unknown
  ) {}
  async status() {
    return { status: 'complete' as const, output: this.output };
  }
}

describe('real buyer-authorized v3 REST initial/replay flows', () => {
  let directory: string;
  let miniflare: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'siteborne-result-auth-real-rest-'));
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
    '%s enforces one policy on initial delivery and replay without re-invoking the provider',
    async (serviceId, path) => {
      const artifacts = new Map<string, Record<string, unknown>>();
      const fixture = new FixturePaymentEvidenceProvider();
      const verify = vi.fn<PaymentEvidenceProvider['verify']>((context) => fixture.verify(context));
      const provider: PaymentEvidenceProvider = {
        providerKind: 'fixture',
        verify,
        settle: (...args) => fixture.settle(...args),
      };
      const instances = new Map<string, WorkflowInstanceLike>();
      const workflow: WorkflowBindingLike = {
        create: async ({ id }) => {
          const job = await db
            .prepare(
              `SELECT id, idempotency_key FROM jobs
                WHERE service_id = ? ORDER BY rowid DESC LIMIT 1`
            )
            .bind(serviceId)
            .first<{ id: string; idempotency_key: string }>();
          if (!job) throw new Error('workflow_job_missing');
          const binding = await db
            .prepare('SELECT binding_id FROM result_subject_bindings WHERE operation_id = ?')
            .bind(job.id)
            .first<{ binding_id: string }>();
          if (!binding) throw new Error('workflow_subject_binding_missing');
          const contentHash =
            `sha256:${createHash('sha256').update(job.id).digest('hex')}` as const;
          const pccHash = `sha256:${createHash('sha256').update(`${job.id}:pcc`).digest('hex')}`;
          const pcc = {
            receipt_id: `rcpt_${job.id}`,
            service_id: serviceId,
            extensions: {
              // Real governed PCC shape: `pcc_document_hash` lives nested
              // inside the proof's signed `receipt`
              // (`extensions[PCC_PROOF_NAMESPACE].receipt.pcc_document_hash`
              // — see `packages/service-runtime/src/pcc/vnext-proof.ts`'s
              // `VNextProof`/`VNextReceipt`), never flat on the proof
              // object itself. This fixture used to place it flat, which
              // matched the release gate's OLD (buggy) field lookup rather
              // than reality — now that the gate reads through the shared
              // `readGovernedPccDocumentHash` accessor, this fixture must
              // match the real shape too.
              'net.siteborne.verification-proof.v1': { receipt: { pcc_document_hash: pccHash } },
            },
          };
          artifacts.set(contentHash, pcc);
          await new X402ServiceResultRepository(db).create(
            job.id,
            job.idempotency_key,
            {
              status: 200,
              result_format: 'SELF_VERIFYING_PCC_VNEXT',
              result_reference: {
                storage: 'R2_CONTENT_ADDRESS',
                content_hash: contentHash,
                byte_length: JSON.stringify(pcc).length,
                media_type: 'application/pcc+json',
              },
              settleResponse: {
                success: true,
                transaction: 'fixture:tx',
                network: 'eip155:84532',
                amount: '19000',
              },
            },
            NOW
          );
          await db
            .prepare("UPDATE jobs SET current_state = 'DELIVERED', updated_at = ? WHERE id = ?")
            .bind(NOW, job.id)
            .run();
          const instance = new CompletedInstance(id, {
            status: 'settled',
            job_id: job.id,
            receipt_id: pcc.receipt_id,
          });
          instances.set(id, instance);
          return instance;
        },
        get: async (id) => {
          const instance = instances.get(id);
          if (!instance) throw new Error('workflow_instance_missing');
          return instance;
        },
      };
      const resultAuthorizationRepo = new D1ResultAuthorizationRepository(db);
      const readArtifact = vi.fn(async (reference: { content_hash: string }) => {
        const artifact = artifacts.get(reference.content_hash);
        if (!artifact) throw new Error('artifact_not_found');
        return artifact;
      });
      const app = new Hono();
      const continuationEnvelopeKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
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
        workflow,
        continuationEnvelopeKey,
        resultArtifactReader: { read: readArtifact },
        resultAuthorization: {
          authenticate: async (context) => {
            const transported = consumeVerifiedPrincipal(context.req.raw);
            if (transported) return transported;
            const authorization = context.req.header('Authorization');
            // Subject ids are scoped per-service: this suite's revocation
            // is exercised globally against a real, persisted subject
            // reference (RESULT-AUTHORIZATION-REVOCATION-01), and the
            // canonical subject reference is derived from
            // (issuer, subject_id, subject_type) alone -- not the
            // operation. Using the SAME subject id across both
            // `it.each` services would let a revocation from one
            // iteration leak into the other; scoping it per service
            // isolates the two iterations while keeping each one's
            // revocation semantics realistic (one global subject,
            // checked against every operation it owns).
            if (authorization === 'Bearer owner') return principal(`buyer-1:${serviceId}`);
            if (authorization === 'Bearer attacker') return principal(`buyer-2:${serviceId}`);
            return null;
          },
          subjectReferenceKey: { key: KEY, keyVersion: 'k1' },
          // Real, persisted revocation authority (RESULT-AUTHORIZATION-
          // REVOCATION-01) -- not a simulated in-memory flag. Whatever this
          // test has actually written to `result_subject_revocations`
          // through `resultAuthorizationRepo.revokeSubject` is what gates
          // release, exactly as the two production runtime call sites
          // (`production-public-v3-candidate-routes.ts`, `mcp.ts`) wire it.
          revokedSubjectRefs: () => resultAuthorizationRepo.revokedSubjectRefs(),
        },
      });

      const noPrincipal = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(noPrincipal.status).toBe(401);

      const challengeResponse = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' },
        body: '{}',
      });
      const decoded = decodePaymentRequiredHeaderSafe(
        challengeResponse.headers.get('PAYMENT-REQUIRED') ?? ''
      );
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) throw new Error(decoded.error);
      const payload = buyerPayload(decoded.value);
      const paymentHeader = encodePaymentSignatureHeaderSafe(payload);

      const initial = await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer owner',
          'PAYMENT-SIGNATURE': paymentHeader,
        },
        body: '{}',
      });
      expect(initial.status).toBe(200);
      expect(readArtifact).toHaveBeenCalledTimes(1);
      const initialPcc = await initial.json();
      expect(initialPcc).toMatchObject({ service_id: serviceId });
      const pccBeforeDenial = JSON.stringify(initialPcc);

      const wrongPrincipalReplay = await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer attacker',
          'PAYMENT-SIGNATURE': paymentHeader,
        },
        body: '{}',
      });
      expect(wrongPrincipalReplay.status).toBe(404);
      expect(await wrongPrincipalReplay.json()).toEqual({ error: 'result_not_available' });
      expect(readArtifact).toHaveBeenCalledTimes(1);

      const ownerReplay = await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer owner',
          'PAYMENT-SIGNATURE': paymentHeader,
        },
        body: '{}',
      });
      expect(ownerReplay.status).toBe(200);
      expect(await ownerReplay.json()).toEqual(initialPcc);
      expect(readArtifact).toHaveBeenCalledTimes(2);

      const handler: McpX402RouteHandler = async (context) => app.request(context.req.raw);
      const ownerMcp = createMcpX402ServiceBoundary(
        {} as never,
        { [serviceId]: handler },
        'https://utility.siteborne.net',
        principal(`buyer-1:${serviceId}`)
      );
      const attackerMcp = createMcpX402ServiceBoundary(
        {} as never,
        { [serviceId]: handler },
        'https://utility.siteborne.net',
        principal(`buyer-2:${serviceId}`)
      );
      const anonymousMcp = createMcpX402ServiceBoundary(
        {} as never,
        { [serviceId]: handler },
        'https://utility.siteborne.net'
      );
      const mcpInput = { mcp_flow: true };
      const mcpChallenge = await ownerMcp.execute(
        serviceId,
        mcpInput,
        { protocol_version: '2026-07-28' },
        undefined
      );
      expect(mcpChallenge.outcome).toBe('payment_required');
      if (mcpChallenge.outcome !== 'payment_required' || !mcpChallenge.paymentRequired) {
        throw new Error('mcp_payment_challenge_missing');
      }
      const mcpPayment = buyerPayload(mcpChallenge.paymentRequired);
      const mcpInitial = await ownerMcp.execute(
        serviceId,
        mcpInput,
        { protocol_version: '2026-07-28' },
        mcpPayment
      );
      expect(mcpInitial).toMatchObject({
        outcome: 'fulfilled',
        result: { service_id: serviceId },
      });
      expect(
        await attackerMcp.execute(
          serviceId,
          mcpInput,
          { protocol_version: '2026-07-28' },
          mcpPayment
        )
      ).toMatchObject({ outcome: 'rejected', code: 'result_not_available' });
      expect(
        await anonymousMcp.execute(
          serviceId,
          { ...mcpInput, client_name: 'buyer-1', _meta: { principal: 'buyer-1' } },
          { protocol_version: '2026-07-28', client_name: 'buyer-1' },
          mcpPayment
        )
      ).toMatchObject({ outcome: 'rejected', code: 'authentication_required' });
      expect(
        await ownerMcp.execute(serviceId, mcpInput, { protocol_version: '2026-07-28' }, mcpPayment)
      ).toMatchObject({ outcome: 'fulfilled', result: { service_id: serviceId } });
      expect(verify).toHaveBeenCalledTimes(2);

      artifacts.clear();
      const missingArtifactReplay = await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer owner',
          'PAYMENT-SIGNATURE': paymentHeader,
        },
        body: '{}',
      });
      expect(missingArtifactReplay.status).toBe(404);
      expect(await missingArtifactReplay.json()).toEqual({ error: 'result_not_available' });

      // A tuple holder sees the same 404 whether a protected result exists
      // or its durable result row is missing; neither case reads PCC bytes.
      const firstJob = await db
        .prepare('SELECT id FROM jobs WHERE service_id = ? ORDER BY rowid ASC LIMIT 1')
        .bind(serviceId)
        .first<{ id: string }>();
      if (!firstJob) throw new Error('first_job_missing');
      await db.prepare('DELETE FROM x402_service_results WHERE job_id = ?').bind(firstJob.id).run();
      const readsBeforeMissing = readArtifact.mock.calls.length;
      const missingResultReplay = await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer attacker',
          'PAYMENT-SIGNATURE': paymentHeader,
        },
        body: '{}',
      });
      expect(missingResultReplay.status).toBe(404);
      expect(await missingResultReplay.json()).toEqual({ error: 'result_not_available' });
      expect(readArtifact).toHaveBeenCalledTimes(readsBeforeMissing);

      // --- RESULT-AUTHORIZATION-REVOCATION-01: real, persisted revocation ---
      // Revocation is deliberately exercised last in this flow: it is not
      // reversible (no un-revoke/reactivation is implemented), so every
      // assertion below this point must hold with the owning subject
      // permanently revoked.
      const ownerBinding = await db
        .prepare(
          `SELECT owner_subject_ref FROM result_subject_bindings
           WHERE operation_id IN (SELECT id FROM jobs WHERE service_id = ?)
           ORDER BY rowid DESC LIMIT 1`
        )
        .bind(serviceId)
        .first<{ owner_subject_ref: string }>();
      if (!ownerBinding) throw new Error('owner_binding_missing');
      const ownerRef = ownerBinding.owner_subject_ref;

      expect(await resultAuthorizationRepo.revokeSubject(ownerRef, { revokedAt: NOW })).toBe(
        'revoked'
      );
      // Idempotent: revoking the same, already-revoked subject again is a
      // no-op, never a second distinct revocation record or state change.
      expect(await resultAuthorizationRepo.revokeSubject(ownerRef, { revokedAt: NOW })).toBe(
        'already_revoked'
      );
      // This DB is shared across both `it.each` iterations, so the revoked
      // set may already contain the other iteration's owner ref too --
      // the assertion only needs THIS subject to be present in it.
      expect(await resultAuthorizationRepo.revokedSubjectRefs()).toContain(ownerRef);

      // Applies to REST replay/reconstruction of a result finalized BEFORE
      // revocation: authorized-at-execution-time does not imply
      // authorized-at-later-release-time.
      const revokedReplay = await app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer owner',
          'PAYMENT-SIGNATURE': paymentHeader,
        },
        body: '{}',
      });
      expect(revokedReplay.status).toBe(404);
      expect(await revokedReplay.json()).toEqual({ error: 'result_not_available' });
      expect(JSON.stringify(initialPcc)).toBe(pccBeforeDenial);

      // Applies identically through the MCP transport -- same persisted
      // repository authority, no protocol-specific revocation logic.
      expect(
        await ownerMcp.execute(serviceId, mcpInput, { protocol_version: '2026-07-28' }, mcpPayment)
      ).toMatchObject({ outcome: 'rejected', code: 'result_not_available' });
    }
  );

  it('fails closed: a revocation-authority lookup failure denies BUYER_AUTHORIZED release rather than defaulting to an empty revoked set', async () => {
    const serviceId = 'document_evidence_json.v3';
    const path = '/v3/document/evidence-json';
    const artifacts = new Map<string, Record<string, unknown>>();
    const fixture = new FixturePaymentEvidenceProvider();
    const provider: PaymentEvidenceProvider = {
      providerKind: 'fixture',
      verify: (context) => fixture.verify(context),
      settle: (...args) => fixture.settle(...args),
    };
    const instances = new Map<string, WorkflowInstanceLike>();
    const workflow: WorkflowBindingLike = {
      create: async ({ id }) => {
        const job = await db
          .prepare(
            `SELECT id, idempotency_key FROM jobs
              WHERE service_id = ? ORDER BY rowid DESC LIMIT 1`
          )
          .bind(serviceId)
          .first<{ id: string; idempotency_key: string }>();
        if (!job) throw new Error('workflow_job_missing');
        const binding = await db
          .prepare('SELECT binding_id FROM result_subject_bindings WHERE operation_id = ?')
          .bind(job.id)
          .first<{ binding_id: string }>();
        if (!binding) throw new Error('workflow_subject_binding_missing');
        const contentHash = `sha256:${createHash('sha256').update(job.id).digest('hex')}` as const;
        const pccHash = `sha256:${createHash('sha256').update(`${job.id}:pcc`).digest('hex')}`;
        const pcc = {
          receipt_id: `rcpt_${job.id}`,
          service_id: serviceId,
          extensions: {
            'net.siteborne.verification-proof.v1': { receipt: { pcc_document_hash: pccHash } },
          },
        };
        artifacts.set(contentHash, pcc);
        await new X402ServiceResultRepository(db).create(
          job.id,
          job.idempotency_key,
          {
            status: 200,
            result_format: 'SELF_VERIFYING_PCC_VNEXT',
            result_reference: {
              storage: 'R2_CONTENT_ADDRESS',
              content_hash: contentHash,
              byte_length: JSON.stringify(pcc).length,
              media_type: 'application/pcc+json',
            },
            settleResponse: {
              success: true,
              transaction: 'fixture:tx',
              network: 'eip155:84532',
              amount: '19000',
            },
          },
          NOW
        );
        await db
          .prepare("UPDATE jobs SET current_state = 'DELIVERED', updated_at = ? WHERE id = ?")
          .bind(NOW, job.id)
          .run();
        const instance = new CompletedInstance(id, {
          status: 'settled',
          job_id: job.id,
          receipt_id: pcc.receipt_id,
        });
        instances.set(id, instance);
        return instance;
      },
      get: async (id) => {
        const instance = instances.get(id);
        if (!instance) throw new Error('workflow_instance_missing');
        return instance;
      },
    };
    const app = new Hono();
    const continuationEnvelopeKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
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
      workflow,
      continuationEnvelopeKey,
      resultArtifactReader: {
        read: async (reference: { content_hash: string }) => {
          const artifact = artifacts.get(reference.content_hash);
          if (!artifact) throw new Error('artifact_not_found');
          return artifact;
        },
      },
      resultAuthorization: {
        authenticate: async () => principal('fail-closed-buyer'),
        subjectReferenceKey: { key: KEY, keyVersion: 'k1' },
        // Simulates the revocation authority (D1) being unreachable. Per
        // RESULT-AUTHORIZATION-REVOCATION-01, a repository failure MUST
        // surface as a rejection here -- never resolve to `[]` -- and this
        // route must deny release rather than silently treat "lookup
        // failed" as "nothing is revoked".
        revokedSubjectRefs: async () => {
          throw new Error('result_subject_revocation_lookup_failed');
        },
      },
    });

    const challengeResponse = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const decoded = decodePaymentRequiredHeaderSafe(
      challengeResponse.headers.get('PAYMENT-REQUIRED') ?? ''
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.error);
    const payload = buyerPayload(decoded.value);
    const paymentHeader = encodePaymentSignatureHeaderSafe(payload);

    // Initial delivery itself -- not just replay -- must be denied when the
    // revocation authority cannot be consulted.
    const initial = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': paymentHeader },
      body: '{}',
    });
    expect(initial.status).toBe(404);
    expect(await initial.json()).toEqual({ error: 'result_not_available' });
  });
});
