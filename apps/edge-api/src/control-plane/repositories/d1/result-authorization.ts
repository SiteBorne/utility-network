import type { D1Database } from '@cloudflare/workers-types';
import { validatePaymentAttemptBinding, type PaymentAttemptRecord } from '@siteborne/protocol-x402';
import type { Job } from '../../types';
import type { ResultResourceV1, ResultSubjectBindingV1 } from '../../security/result-authorization';

type CreateOutcome = 'created' | 'already_exists';

function bindingFromRow(row: Record<string, unknown>): ResultSubjectBindingV1 {
  if (
    row.binding_policy_version !== 'result_binding_policy.v1' ||
    row.creation_authority !== 'siteborne:request-admission'
  ) {
    throw new Error('result_subject_binding_policy_invalid');
  }
  return {
    schema_version: 'result_subject_binding.v1',
    binding_id: String(row.binding_id),
    operation_scope_ref: String(row.operation_scope_ref),
    owner_subject_ref: String(row.owner_subject_ref),
    binding_policy_version: row.binding_policy_version,
    creation_authority: row.creation_authority,
    created_at: String(row.created_at),
    authority_context_id: String(row.authority_context_id),
    policy_evaluation_id: String(row.policy_evaluation_id),
  };
}

function resourceFromRow(row: Record<string, unknown>): ResultResourceV1 {
  return {
    schema_version: 'result_resource.v1',
    operation_id: String(row.operation_id),
    result_id: String(row.result_id),
    artifact_id: String(row.artifact_id),
    pcc_document_hash: String(row.pcc_document_hash),
    service_id: String(row.service_id),
    service_version: String(row.service_version),
    contract_release: String(row.contract_release),
    confidentiality_class: row.confidentiality_class as ResultResourceV1['confidentiality_class'],
    result_binding_id: String(row.binding_id),
  };
}

function sameBinding(left: ResultSubjectBindingV1, right: ResultSubjectBindingV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameResource(left: ResultResourceV1, right: ResultResourceV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface RevokeSubjectInput {
  readonly revokedAt: string;
  readonly reasonCode?: string;
  readonly revokingAuthority?: string;
}

export type RevokeSubjectOutcome = 'revoked' | 'already_revoked';

export class D1ResultAuthorizationRepository {
  constructor(private readonly db: D1Database) {}

  /** Atomically reserves the payment identifier, creates the operation, and
   * binds its owner. A failed batch leaves no unowned acquired attempt. */
  async acquireBuyerAuthorizedOperation(
    attempt: PaymentAttemptRecord,
    job: Job,
    binding: ResultSubjectBindingV1
  ): Promise<'acquired' | 'conflict'> {
    const validation = validatePaymentAttemptBinding(attempt.binding);
    if (!validation.valid) throw new Error('invalid_payment_attempt_binding');
    const b = attempt.binding;
    try {
      const results = await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO payment_attempts (
              id, payment_identifier, binding_digest, quote_id, requirement_id,
              service_id, service_version, contract_release, request_input_hash,
              resource_id, scheme, network, asset, amount, payee, job_id,
              idempotency_key, created_at, expires_at, binding_version, payment_rail,
              payment_provider, nevermined_agent_id, nevermined_plan_id, nevermined_delegation_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID(),
            attempt.payment_identifier,
            attempt.binding_digest,
            b.quote_id,
            b.requirement_id,
            b.service_id,
            b.service_version,
            b.contract_release,
            b.request_input_hash,
            b.resource_id,
            b.scheme,
            b.network,
            b.asset,
            b.amount,
            b.payee,
            null,
            null,
            attempt.created_at,
            attempt.expires_at,
            b.binding_version,
            b.payment_rail ?? null,
            b.payment_provider ?? null,
            b.nevermined_agent_id ?? null,
            b.nevermined_plan_id ?? null,
            b.nevermined_delegation_id ?? null
          ),
        this.db
          .prepare(
            `INSERT INTO jobs (
              id, request_id, service_id, service_version, input_hash, input_schema_hash,
              output_schema_hash, idempotency_key, contract_release, pcc_dependency,
              current_state, created_at, updated_at, expires_at, attempt_count,
              max_authorized_cost, production_enabled
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            job.id,
            job.request_id,
            job.service_id,
            job.service_version,
            job.input_hash,
            job.input_schema_hash,
            job.output_schema_hash,
            job.idempotency_key,
            job.contract_release,
            job.pcc_dependency,
            job.current_state,
            job.created_at,
            job.updated_at,
            job.expires_at,
            job.attempt_count,
            job.max_authorized_cost ?? null,
            job.production_enabled ? 1 : 0
          ),
        this.db
          .prepare(
            `INSERT INTO result_subject_bindings (
              binding_id, operation_id, operation_scope_ref, owner_subject_ref,
              binding_policy_version, creation_authority, created_at,
              authority_context_id, policy_evaluation_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            binding.binding_id,
            job.id,
            binding.operation_scope_ref,
            binding.owner_subject_ref,
            binding.binding_policy_version,
            binding.creation_authority,
            binding.created_at,
            binding.authority_context_id,
            binding.policy_evaluation_id
          ),
      ]);
      if (results.length !== 3 || results.some((result) => !result.success)) {
        throw new Error('result_subject_admission_failed');
      }
      return 'acquired';
    } catch (error) {
      const existing = await this.db
        .prepare('SELECT payment_identifier FROM payment_attempts WHERE payment_identifier = ?')
        .bind(attempt.payment_identifier)
        .first();
      if (existing) return 'conflict';
      throw error;
    }
  }

  async createSubjectBinding(
    operationId: string,
    binding: ResultSubjectBindingV1
  ): Promise<CreateOutcome> {
    const existing = await this.getSubjectBindingByOperation(operationId);
    if (existing) {
      if (sameBinding(existing, binding)) return 'already_exists';
      throw new Error('result_subject_binding_conflict');
    }
    try {
      const result = await this.db
        .prepare(
          `INSERT INTO result_subject_bindings (
          binding_id, operation_id, operation_scope_ref, owner_subject_ref,
          binding_policy_version, creation_authority, created_at,
          authority_context_id, policy_evaluation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          binding.binding_id,
          operationId,
          binding.operation_scope_ref,
          binding.owner_subject_ref,
          binding.binding_policy_version,
          binding.creation_authority,
          binding.created_at,
          binding.authority_context_id,
          binding.policy_evaluation_id
        )
        .run();
      if (!result.success) throw new Error('result_subject_binding_create_failed');
    } catch {
      const raced = await this.getSubjectBindingByOperation(operationId);
      if (raced && sameBinding(raced, binding)) return 'already_exists';
      throw new Error('result_subject_binding_conflict');
    }
    return 'created';
  }

  async getSubjectBindingByOperation(operationId: string): Promise<ResultSubjectBindingV1 | null> {
    const result = await this.db
      .prepare('SELECT * FROM result_subject_bindings WHERE operation_id = ?')
      .bind(operationId)
      .all();
    if (!result.success || result.results.length !== 1) return null;
    return bindingFromRow(result.results[0] as Record<string, unknown>);
  }

  async createResultResource(
    resource: ResultResourceV1,
    createdAt: string
  ): Promise<CreateOutcome> {
    const existing = await this.getResultResourceByOperation(resource.operation_id);
    if (existing) {
      if (sameResource(existing, resource)) return 'already_exists';
      throw new Error('result_resource_conflict');
    }
    const binding = await this.getSubjectBindingByOperation(resource.operation_id);
    if (!binding || binding.binding_id !== resource.result_binding_id) {
      throw new Error('result_subject_binding_missing');
    }
    try {
      const result = await this.db
        .prepare(
          `INSERT INTO result_resources (
          result_id, operation_id, artifact_id, pcc_document_hash, service_id,
          service_version, contract_release, confidentiality_class, binding_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          resource.result_id,
          resource.operation_id,
          resource.artifact_id,
          resource.pcc_document_hash,
          resource.service_id,
          resource.service_version,
          resource.contract_release,
          resource.confidentiality_class,
          resource.result_binding_id,
          createdAt
        )
        .run();
      if (!result.success) throw new Error('result_resource_create_failed');
    } catch {
      const raced = await this.getResultResourceByOperation(resource.operation_id);
      if (raced && sameResource(raced, resource)) return 'already_exists';
      throw new Error('result_resource_conflict');
    }
    return 'created';
  }

  async getResultResourceByOperation(operationId: string): Promise<ResultResourceV1 | null> {
    const result = await this.db
      .prepare('SELECT * FROM result_resources WHERE operation_id = ?')
      .bind(operationId)
      .all();
    if (!result.success || result.results.length !== 1) return null;
    return resourceFromRow(result.results[0] as Record<string, unknown>);
  }

  /** Persists a subject revocation. Idempotent: a subject already revoked
   * keeps its original `revoked_at`/reason/authority -- a repeated revoke
   * of the same subject reference is a no-op, never a duplicate row and
   * never a second, later revocation timestamp. This repository is the
   * sole revocation authority; there is no parallel in-memory list. */
  async revokeSubject(
    subjectRef: string,
    input: RevokeSubjectInput
  ): Promise<RevokeSubjectOutcome> {
    const result = await this.db
      .prepare(
        `INSERT INTO result_subject_revocations (
          subject_ref, revoked_at, reason_code, revoking_authority
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT (subject_ref) DO NOTHING`
      )
      .bind(subjectRef, input.revokedAt, input.reasonCode ?? null, input.revokingAuthority ?? null)
      .run();
    if (!result.success) throw new Error('result_subject_revocation_write_failed');
    return (result.meta?.changes ?? 0) > 0 ? 'revoked' : 'already_revoked';
  }

  async isSubjectRevoked(subjectRef: string): Promise<boolean> {
    const result = await this.db
      .prepare('SELECT 1 FROM result_subject_revocations WHERE subject_ref = ?')
      .bind(subjectRef)
      .all();
    if (!result.success) throw new Error('result_subject_revocation_lookup_failed');
    return result.results.length > 0;
  }

  /** The full currently-revoked subject-reference set. This is the sole,
   * persisted authority `buildResultAuthorizationRuntime` wires into the
   * release evaluator's `revoked_subject_refs` input -- a repository
   * failure here MUST throw, never resolve to `[]`, so every caller
   * (both the HTTP and MCP result-release paths) fails BUYER_AUTHORIZED
   * release closed rather than silently treating "lookup failed" as
   * "nothing is revoked". */
  async revokedSubjectRefs(): Promise<readonly string[]> {
    const result = await this.db.prepare('SELECT subject_ref FROM result_subject_revocations').all();
    if (!result.success) throw new Error('result_subject_revocation_lookup_failed');
    return result.results.map((row) => String((row as Record<string, unknown>).subject_ref));
  }
}
