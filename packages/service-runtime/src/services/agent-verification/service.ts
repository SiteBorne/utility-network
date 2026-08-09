/**
 * verify_agent_output.v1 — composes the SUN-0500 verification mesh
 * directly (never a second verification engine). Two distinct schema
 * validations happen here and must not be confused: (1) the buyer-supplied
 * `required_schema` against `candidate_output` — a per-request, dynamic
 * check this service performs itself via a scoped ajv instance, reported
 * as the `schema_valid` deterministic requirement; and (2) this service's
 * own frozen PCC output against `agent-verification-output.schema.json` —
 * always performed by SUN-0500's SchemaVerifier inside verifyAndSign,
 * exactly like every other service in this package.
 */
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ReproductionInput, Signer } from '@siteborne/verification';
import { buildClaim } from '../../claims/builder';
import { buildEvidence } from '../../evidence/builder';
import { buildDraftDocument, defaultProvenance, verifyAndSign } from '../../pcc';
import type { PccClaim, PccEvidenceItem } from '../../pcc/document-types';
import type { LocalService, ServiceExecutionContext, ServiceExecutionResult } from '../../types';
import { evaluateClaim } from './claim-evaluation';
import type {
  AgentVerificationExtension,
  AgentVerificationInput,
  DeterministicCheck,
} from './types';

export interface AgentVerificationServiceDeps {
  signer: Signer;
  /** Only consulted when verification_mode === 'independent_reproduction'.
   * SUN-0600 does not perform any live independent reproduction — this is
   * always a caller-supplied fixture/local result (or null, in which case
   * the mesh's reproduction_verifier fails closed — see ADR 0034). */
  reproduction?: ReproductionInput | null;
}

export class VerifyAgentOutputService
  implements LocalService<AgentVerificationInput, AgentVerificationExtension>
{
  readonly serviceId = 'verify_agent_output.v1' as const;
  readonly serviceVersion = 'v1' as const;

  constructor(private readonly deps: AgentVerificationServiceDeps) {}

  async execute(
    input: AgentVerificationInput,
    context: ServiceExecutionContext
  ): Promise<ServiceExecutionResult<AgentVerificationExtension>> {
    const startedMs = context.clock.nowMs();
    const inputHash = 'sha256:' + createHash('sha256').update(JSON.stringify(input)).digest('hex');

    if (
      !input.verification_contract ||
      !input.candidate_output ||
      !input.required_schema ||
      !input.verification_mode
    ) {
      return rejected(
        context,
        startedMs,
        inputHash,
        'verification_contract, candidate_output, required_schema, and verification_mode are all required'
      );
    }

    const candidateOutputHash =
      'sha256:' + createHash('sha256').update(JSON.stringify(input.candidate_output)).digest('hex');
    const candidateEvidence = buildEvidence({
      seed: `verify_agent_output.v1:candidate_output:${candidateOutputHash}`,
      sourceUri: `candidate://${context.job_id}`,
      retrievedAtIso: new Date(context.clock.nowMs()).toISOString(),
      contentHash: candidateOutputHash,
      mediaType: 'application/json',
      locator: { type: 'json_pointer', value: '/' },
      authorizationClassification: 'buyer_authorized',
    });

    const claims: PccClaim[] = [];
    const evidence: PccEvidenceItem[] = [candidateEvidence];
    const requirementResults: NonNullable<AgentVerificationExtension['requirement_results']> = [];
    const failedRequirements: string[] = [];
    const unverifiableAssertions: string[] = [];

    // --- verification_contract.claims ---
    let supportedClaims = 0;
    for (const contractClaim of input.verification_contract.claims) {
      const evaluation = evaluateClaim(input.candidate_output, contractClaim);
      if (evaluation.passed) supportedClaims++;
      claims.push(
        buildClaim({
          seed: `verify_agent_output.v1:claim:${contractClaim.claim_id}:${candidateOutputHash}`,
          predicate: contractClaim.claim_id,
          value: evaluation.passed,
          confidence: evaluation.passed ? 0.95 : 0.5,
          evidenceIds: [candidateEvidence.evidence_id],
          verificationStatus: evaluation.passed ? 'verified' : 'unsupported',
        })
      );
      if (!evaluation.passed) failedRequirements.push(`claim:${contractClaim.claim_id}`);
    }

    // --- deterministic_requirements ---
    for (const requirement of input.verification_contract.deterministic_requirements) {
      const outcome = evaluateDeterministicRequirement(
        requirement.check,
        input,
        requirement.parameters
      );
      requirementResults.push({
        requirement_id: requirement.requirement_id,
        passed: outcome.passed,
        details: outcome.details,
        evidence_ids: [candidateEvidence.evidence_id],
      });
      if (!outcome.passed) failedRequirements.push(`requirement:${requirement.requirement_id}`);
      if (outcome.unverifiable)
        unverifiableAssertions.push(
          `requirement:${requirement.requirement_id} (${requirement.check}) is not implemented in this increment`
        );
    }

    const totalClaims = input.verification_contract.claims.length;
    const claimScore = totalClaims === 0 ? 1 : supportedClaims / totalClaims;
    const requirementsPassed = requirementResults.every((r) => r.passed);

    const extension: AgentVerificationExtension = {
      verification_mode: input.verification_mode,
      requirement_results: requirementResults,
      claim_support_result: {
        supported: supportedClaims === totalClaims,
        supported_count: supportedClaims,
        unsupported_count: totalClaims - supportedClaims,
      },
      failed_requirements: failedRequirements.length ? failedRequirements : undefined,
      unverifiable_assertions: unverifiableAssertions.length ? unverifiableAssertions : undefined,
      candidate_output_hash: candidateOutputHash,
      policy_version: 'v1.0.0',
    };

    const nowIso = new Date(context.clock.nowMs()).toISOString();
    const requestedFields =
      totalClaims + input.verification_contract.deterministic_requirements.length;
    const supportedFields = supportedClaims + requirementResults.filter((r) => r.passed).length;

    const draft = buildDraftDocument({
      seed: `verify_agent_output.v1:${inputHash}:${context.job_id}`,
      serviceId: 'verify_agent_output.v1',
      serviceVersion: 'v1',
      inputHash,
      inputSchemaHash: 'sha256:' + '1'.repeat(64),
      outputSchemaHash: 'sha256:' + '2'.repeat(64),
      contractMode: 'offline_verification',
      freshnessSeconds: 3600,
      issuedAtIso: nowIso,
      expiresAtIso: new Date(context.clock.nowMs() + 3_600_000).toISOString(),
      subject: { type: 'other', canonical_name: `candidate:${context.job_id}` },
      claims,
      evidence,
      completeness: {
        requested_fields: requestedFields,
        populated_fields: requestedFields,
        supported_fields: supportedFields,
        score: requestedFields === 0 ? 1 : supportedFields / requestedFields,
        missing_fields: [],
        unsupported_fields:
          requestedFields === supportedFields
            ? []
            : ['some claims or deterministic requirements did not pass'],
        stale_fields: [],
        vector: [
          {
            dimension: 'requirements',
            requested: requestedFields,
            populated: requestedFields,
            supported: supportedFields,
            score: requestedFields === 0 ? 1 : supportedFields / requestedFields,
          },
        ],
      },
      provenance: defaultProvenance('service-runtime:verify-agent-output', '0.1.0'),
      extensionKey: 'net.siteborne.agent-verification.v1',
      extensionPayload: extension,
    });

    const signed = await verifyAndSign({
      draft,
      context,
      signer: this.deps.signer,
      reproduction:
        input.verification_mode === 'independent_reproduction'
          ? (this.deps.reproduction ?? null)
          : undefined,
    });

    const meshPassed = signed.verdict.decision === 'pass';
    const outcome: 'pass' | 'fail' | 'conditional' = !meshPassed
      ? signed.verdict.decision === 'conditional'
        ? 'conditional'
        : 'fail'
      : requirementsPassed && claimScore === 1
        ? 'pass'
        : 'conditional';
    extension.outcome = outcome;
    extension.score = meshPassed ? (claimScore + (requirementsPassed ? 1 : 0)) / 2 : 0;

    return {
      result_class:
        outcome === 'pass' && meshPassed
          ? 'success'
          : meshPassed
            ? 'partial'
            : 'internal_verification_failed',
      service_id: 'verify_agent_output.v1',
      service_version: 'v1',
      contract_release: context.contract_release,
      request_id: context.request_id,
      job_id: draft.job_id,
      input_hash: inputHash,
      output: meshPassed
        ? signed.document.extensions['net.siteborne.agent-verification.v1']
        : undefined,
      output_hash: signed.outputHash,
      pcc_hash: signed.outputHash,
      receipt_id: signed.receiptId,
      warnings: [],
      limitations: unverifiableAssertions,
      completeness: {
        requested_fields: requestedFields,
        populated_fields: requestedFields,
        supported_fields: supportedFields,
        missing_fields: [],
      },
      audit_references: [context.request_id],
      metrics: {
        elapsed_ms: context.clock.nowMs() - startedMs,
        dependency_calls: 0,
        claims_produced: claims.length,
        evidence_produced: evidence.length,
        output_bytes: JSON.stringify(signed.document).length,
      },
      failure: meshPassed
        ? undefined
        : {
            code: 'verification_failed',
            message: `verification mesh decision was "${signed.verdict.decision}"`,
            retryable: false,
            details: signed.verdict.verification.deterministic_failures,
          },
    };
  }
}

function evaluateDeterministicRequirement(
  check: DeterministicCheck,
  input: AgentVerificationInput,
  parameters?: Record<string, unknown>
): { passed: boolean; details: string; unverifiable?: boolean } {
  if (check === 'schema_valid') {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    try {
      const validate = ajv.compile(input.required_schema);
      const valid = Boolean(validate(input.candidate_output));
      return {
        passed: valid,
        details: valid
          ? 'candidate_output matches required_schema'
          : `candidate_output violates required_schema: ${JSON.stringify(validate.errors ?? []).slice(0, 300)}`,
      };
    } catch (err) {
      return { passed: false, details: `required_schema failed to compile: ${String(err)}` };
    }
  }
  if (check === 'hash_match') {
    const expectedHash = parameters?.expected_hash;
    if (typeof expectedHash !== 'string')
      return { passed: false, details: 'hash_match requires parameters.expected_hash' };
    const actualHash =
      'sha256:' + createHash('sha256').update(JSON.stringify(input.candidate_output)).digest('hex');
    const passed = actualHash === expectedHash;
    return {
      passed,
      details: passed
        ? 'candidate_output hash matches expected_hash'
        : `candidate_output hash ${actualHash} does not match expected_hash ${expectedHash}`,
    };
  }
  // signature_valid / evidence_resolves / no_pii / no_secrets: recognized
  // by the frozen schema's enum but not implemented in this increment —
  // reported as a failed, non-fabricated requirement rather than a silent
  // pass, with `unverifiable: true` surfaced as a limitation.
  return {
    passed: false,
    details: `deterministic check "${check}" is not implemented in this increment (SUN-0600)`,
    unverifiable: true,
  };
}

function rejected(
  context: ServiceExecutionContext,
  startedMs: number,
  inputHash: string,
  message: string
): ServiceExecutionResult<AgentVerificationExtension> {
  return {
    result_class: 'rejected',
    service_id: 'verify_agent_output.v1',
    service_version: 'v1',
    contract_release: context.contract_release,
    request_id: context.request_id,
    job_id: context.job_id,
    input_hash: inputHash,
    warnings: [],
    limitations: [],
    audit_references: [],
    metrics: {
      elapsed_ms: context.clock.nowMs() - startedMs,
      dependency_calls: 0,
      claims_produced: 0,
      evidence_produced: 0,
      output_bytes: 0,
    },
    failure: { code: 'invalid_request', message, retryable: false },
  };
}
