import { createHash, createHmac } from 'node:crypto';

/**
 * RESULT-AUTHORIZATION-DESIGN-01 local reference model.
 *
 * TEST/DESIGN ONLY: no production route imports this module. It performs no
 * I/O, provider/payment call, persistence, or mutation. It models only result
 * release after a protocol adapter has independently verified identity
 * evidence. Economic replay, execution, settlement, and PCC validity remain
 * separate authorities.
 */

export const RESULT_CONFIDENTIALITY_CLASSES = ['PUBLIC', 'BUYER_AUTHORIZED'] as const;
export type ResultConfidentialityClass = (typeof RESULT_CONFIDENTIALITY_CLASSES)[number];

export const RESULT_RELEASE_DECISIONS = [
  'MATCH',
  'PUBLIC_RESULT',
  'VALID_DELEGATION',
  'NO_AUTHENTICATED_PRINCIPAL',
  'SUBJECT_MISMATCH',
  'SUBJECT_REVOKED',
  'DELEGATION_INVALID',
  'RESOURCE_MISMATCH',
  'LEGACY_UNBOUND',
  'POLICY_ERROR',
] as const;
export type ResultReleaseDecision = (typeof RESULT_RELEASE_DECISIONS)[number];

export type ResultSubjectType = 'human' | 'organization' | 'service_account' | 'workload' | 'agent';

export type ResultAuthenticationMethod =
  | 'oidc'
  | 'signed_request'
  | 'api_key'
  | 'mtls'
  | 'gateway_assertion';

export type ResultAssuranceLevel =
  | 'verified_single_factor'
  | 'verified_multi_factor'
  | 'cryptographic_workload'
  | 'trusted_gateway_assertion';

export interface CredentialBindingV1 {
  readonly kind: 'jwk_thumbprint' | 'certificate_sha256' | 'key_id';
  /** A one-way thumbprint or non-secret key identifier; never key material. */
  readonly value: string;
}

export interface ResultSubjectV1 {
  readonly schema_version: 'result_subject.v1';
  readonly subject_type: ResultSubjectType;
  /** Normalized issuer URI or SITEBORNE-controlled issuer identifier. */
  readonly issuer: string;
  /** Issuer-scoped stable pseudonymous ID; never email, username, wallet, or IP. */
  readonly subject_id: string;
  readonly authentication_method: ResultAuthenticationMethod;
  readonly assurance_level: ResultAssuranceLevel;
  readonly authenticated_at: string;
  readonly credential_binding: CredentialBindingV1 | null;
}

export interface VerifiedPrincipalEvidence {
  readonly verification_status: 'VERIFIED';
  readonly subject: ResultSubjectV1;
  readonly evidence_type: 'cryptographically_authenticated' | 'gateway_asserted';
  readonly verifier_id: 'siteborne.identity-evidence-verifier.v1';
}

export interface ExternalIdentityEvidence {
  readonly evidence_type:
    | 'oidc_bearer'
    | 'signed_request'
    | 'api_key'
    | 'mtls'
    | 'gateway_assertion'
    | 'self_asserted_header'
    | 'payment_derived';
  readonly issuer: string;
  readonly subject_id: string;
  readonly audience: string;
  readonly authenticated_at: string;
  readonly assurance_level: ResultAssuranceLevel;
  readonly integrity_verified: boolean;
  readonly freshness_verified: boolean;
  readonly credential_binding: CredentialBindingV1 | null;
  readonly subject_type?: ResultSubjectType;
  readonly asserting_intermediary?: string;
  readonly intermediary_authenticated?: boolean;
  readonly assertion_semantics?: string;
}

export type IdentityEvidenceVerificationReason =
  | 'VERIFIED'
  | 'UNSUITABLE_EVIDENCE_SOURCE'
  | 'INTEGRITY_UNVERIFIED'
  | 'STALE_EVIDENCE'
  | 'UNTRUSTED_ISSUER'
  | 'AUDIENCE_MISMATCH'
  | 'UNTRUSTED_INTERMEDIARY'
  | 'UNSUPPORTED_ASSERTION_SEMANTICS';

export type IdentityEvidenceVerification =
  | {
      readonly status: 'VERIFIED';
      readonly reason: 'VERIFIED';
      readonly principal: VerifiedPrincipalEvidence;
    }
  | {
      readonly status: 'REJECTED';
      readonly reason: Exclude<IdentityEvidenceVerificationReason, 'VERIFIED'>;
      readonly principal: null;
    };

const TRUSTED_ISSUERS = new Set([
  'https://identity.siteborne.test',
  'siteborne:api-key-registry',
  'siteborne:mtls-trust-domain',
]);
const TRUSTED_AUDIENCE = 'siteborne-result-release';
const TRUSTED_INTERMEDIARIES = new Set(['cloudflare-access', 'kong-enterprise']);
const TRUSTED_GATEWAY_SEMANTICS = new Set(['oidc-claims-v1', 'workload-identity-v1']);

const rejectEvidence = (
  reason: Exclude<IdentityEvidenceVerificationReason, 'VERIFIED'>
): IdentityEvidenceVerification => ({ status: 'REJECTED', reason, principal: null });

function authenticationMethodFor(
  evidenceType: ExternalIdentityEvidence['evidence_type']
): ResultAuthenticationMethod | null {
  switch (evidenceType) {
    case 'oidc_bearer':
      return 'oidc';
    case 'signed_request':
      return 'signed_request';
    case 'api_key':
      return 'api_key';
    case 'mtls':
      return 'mtls';
    case 'gateway_assertion':
      return 'gateway_assertion';
    case 'self_asserted_header':
    case 'payment_derived':
      return null;
  }
}

function defaultSubjectType(
  evidenceType: ExternalIdentityEvidence['evidence_type']
): ResultSubjectType {
  switch (evidenceType) {
    case 'mtls':
      return 'workload';
    case 'signed_request':
    case 'api_key':
      return 'service_account';
    default:
      return 'human';
  }
}

/**
 * Adapter-boundary reference: cryptographic verification itself happens in
 * the protocol-specific verifier; this pure step admits only its verified,
 * audience/freshness/trust-qualified evidence into the canonical subject.
 */
export function verifyIdentityEvidence(
  evidence: ExternalIdentityEvidence
): IdentityEvidenceVerification {
  const authenticationMethod = authenticationMethodFor(evidence.evidence_type);
  if (!authenticationMethod) return rejectEvidence('UNSUITABLE_EVIDENCE_SOURCE');
  if (!evidence.integrity_verified) return rejectEvidence('INTEGRITY_UNVERIFIED');
  if (!evidence.freshness_verified) return rejectEvidence('STALE_EVIDENCE');
  if (!TRUSTED_ISSUERS.has(evidence.issuer)) return rejectEvidence('UNTRUSTED_ISSUER');
  if (evidence.audience !== TRUSTED_AUDIENCE) return rejectEvidence('AUDIENCE_MISMATCH');
  if (evidence.evidence_type === 'gateway_assertion') {
    if (
      evidence.intermediary_authenticated !== true ||
      !evidence.asserting_intermediary ||
      !TRUSTED_INTERMEDIARIES.has(evidence.asserting_intermediary)
    ) {
      return rejectEvidence('UNTRUSTED_INTERMEDIARY');
    }
    if (
      !evidence.assertion_semantics ||
      !TRUSTED_GATEWAY_SEMANTICS.has(evidence.assertion_semantics)
    ) {
      return rejectEvidence('UNSUPPORTED_ASSERTION_SEMANTICS');
    }
  }

  return {
    status: 'VERIFIED',
    reason: 'VERIFIED',
    principal: Object.freeze({
      verification_status: 'VERIFIED',
      evidence_type:
        evidence.evidence_type === 'gateway_assertion'
          ? 'gateway_asserted'
          : 'cryptographically_authenticated',
      verifier_id: 'siteborne.identity-evidence-verifier.v1',
      subject: Object.freeze({
        schema_version: 'result_subject.v1',
        subject_type: evidence.subject_type ?? defaultSubjectType(evidence.evidence_type),
        issuer: evidence.issuer,
        subject_id: evidence.subject_id,
        authentication_method: authenticationMethod,
        assurance_level: evidence.assurance_level,
        authenticated_at: evidence.authenticated_at,
        credential_binding: evidence.credential_binding
          ? Object.freeze({ ...evidence.credential_binding })
          : null,
      }),
    }),
  };
}

export interface ResultResourceV1 {
  readonly schema_version: 'result_resource.v1';
  readonly operation_id: string;
  readonly result_id: string;
  readonly artifact_id: string;
  readonly pcc_document_hash: string;
  readonly service_id: string;
  readonly service_version: string;
  readonly contract_release: string;
  /** Derived from the governed immutable service contract, never caller input. */
  readonly confidentiality_class: ResultConfidentialityClass;
  readonly result_binding_id: string;
}

export interface ResultSubjectBindingV1 {
  readonly schema_version: 'result_subject_binding.v1';
  readonly binding_id: string;
  /** Future-result scope fixed at admission, before any result bytes exist. */
  readonly operation_scope_ref: string;
  readonly owner_subject_ref: string;
  readonly binding_policy_version: 'result_binding_policy.v1';
  readonly creation_authority: 'siteborne:request-admission';
  readonly created_at: string;
  readonly authority_context_id: string;
  readonly policy_evaluation_id: string;
}

export interface ResultAccessDelegationV1 {
  readonly schema_version: 'result_access_delegation.v1';
  readonly delegation_id: string;
  readonly issuer_subject_ref: string;
  readonly delegate_subject_ref: string;
  readonly resource_ref: string;
  readonly permission: 'result:read';
  readonly not_before: string;
  readonly expires_at: string;
  readonly issuance_authority: 'siteborne:delegation-registry';
  readonly integrity_ref: string;
}

export interface ResultAuthorizationPolicyV1 {
  readonly policy_version: 'result_release_policy.v1';
  readonly evaluated_at: string;
  readonly revoked_subject_refs: readonly string[];
  readonly revoked_delegation_ids: readonly string[];
}

export interface ResultReleaseAuthorizationInput {
  readonly verified_principal: VerifiedPrincipalEvidence | null;
  readonly result_resource: ResultResourceV1;
  readonly subject_binding: ResultSubjectBindingV1 | null;
  readonly confidentiality_class: ResultConfidentialityClass;
  readonly delegation_evidence: ResultAccessDelegationV1 | null;
  readonly policy: ResultAuthorizationPolicyV1;
}

export interface ResultReleaseAuthorizationEvaluation {
  readonly decision: ResultReleaseDecision;
  readonly resource_ref: string;
  readonly policy_version: string;
  readonly reason_codes: readonly string[];
}

export interface PayerEvidenceV1 {
  readonly evidence_type: 'payment_derived';
  readonly payer_ref: string;
}

export interface ResultDeliveryCompositionInput {
  /** Existing payment/admission authority; result policy cannot satisfy it. */
  readonly admission_authorized: boolean;
  /** Replay tuple may locate, but never authorizes, a result. */
  readonly result_located: boolean;
  /** PCC validity is required independently from release authorization. */
  readonly pcc_valid: boolean;
  /** Carried for economic audit only and intentionally not used as ownership. */
  readonly payer_evidence: PayerEvidenceV1 | null;
  readonly authorization_input: ResultReleaseAuthorizationInput;
}

export interface ResultDeliveryCompositionEvaluation {
  readonly path: 'initial' | 'replay';
  readonly deliver: boolean;
  readonly release_authorization: ResultReleaseAuthorizationEvaluation;
}

function sha256Reference(domain: string, fields: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  for (const field of fields) {
    hash.update('\0', 'utf8');
    hash.update(field, 'utf8');
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * One-way, issuer-qualified canonical subject reference for durable binding.
 * This test-only key demonstrates the repository's existing HMAC/key-version
 * authority shape; production must inject a non-extractable managed key.
 */
export function canonicalSubjectReference(subject: ResultSubjectV1): string {
  const testOnlyKey = new Uint8Array(32).fill(0x5a);
  const keyVersion = 'test-k1';
  const issuerQualifiedPrincipalId = `principal:${createHash('sha256')
    .update(
      JSON.stringify({
        issuer: subject.issuer,
        subject_id: subject.subject_id,
        subject_type: subject.subject_type,
      }),
      'utf8'
    )
    .digest('hex')}`;
  const hmac = createHmac('sha256', testOnlyKey);
  hmac.update(
    JSON.stringify({
      domain: 'siteborne.subject_digest.v1',
      key_version: keyVersion,
      subject_type: 'authenticated_caller_subject',
      value: issuerQualifiedPrincipalId,
    }),
    'utf8'
  );
  // Compact serialization of the existing { subject_digest,
  // digest_key_version } tuple for this test-only binding record.
  return `${keyVersion}:${hmac.digest('hex')}`;
}

/** Resource identity excludes payment_identifier and any caller credential. */
export function canonicalResourceReference(resource: ResultResourceV1): string {
  return sha256Reference('SITEBORNE-RESULT-RESOURCE-V1', [
    resource.operation_id,
    resource.result_id,
    resource.artifact_id,
    resource.pcc_document_hash,
    resource.service_id,
    resource.service_version,
    resource.contract_release,
    resource.confidentiality_class,
    resource.result_binding_id,
  ]);
}

/** Scope that exists at request admission, before result/artifact hashes exist. */
export function canonicalOperationScopeReference(resource: ResultResourceV1): string {
  return sha256Reference('SITEBORNE-RESULT-OPERATION-SCOPE-V1', [
    resource.operation_id,
    resource.service_id,
    resource.service_version,
    resource.contract_release,
    resource.confidentiality_class,
  ]);
}

function sameDelegation(a: ResultAccessDelegationV1, b: ResultAccessDelegationV1): boolean {
  return (
    a.schema_version === b.schema_version &&
    a.delegation_id === b.delegation_id &&
    a.issuer_subject_ref === b.issuer_subject_ref &&
    a.delegate_subject_ref === b.delegate_subject_ref &&
    a.resource_ref === b.resource_ref &&
    a.permission === b.permission &&
    a.not_before === b.not_before &&
    a.expires_at === b.expires_at &&
    a.issuance_authority === b.issuance_authority &&
    a.integrity_ref === b.integrity_ref
  );
}

/**
 * Reference for the trusted delegation-registry boundary. A caller-supplied
 * object is not evidence: it must byte-semantically match an active record in
 * the server-owned, closure-held registry snapshot.
 */
function verifyResultAccessDelegation(
  candidate: ResultAccessDelegationV1,
  trustedRegistryRecords: readonly ResultAccessDelegationV1[]
): ResultAccessDelegationV1 | null {
  if (
    candidate.issuance_authority !== 'siteborne:delegation-registry' ||
    !/^sha256:[0-9a-f]{64}$/.test(candidate.integrity_ref)
  ) {
    return null;
  }
  const trusted = trustedRegistryRecords.find(
    (record) => record.delegation_id === candidate.delegation_id
  );
  return trusted && sameDelegation(candidate, trusted) ? trusted : null;
}

export function createResultSubjectBinding(
  resource: ResultResourceV1,
  principal: VerifiedPrincipalEvidence,
  inputs: Readonly<{
    binding_id: string;
    created_at: string;
    authority_context_id: string;
    policy_evaluation_id: string;
  }>
): ResultSubjectBindingV1 {
  return Object.freeze({
    schema_version: 'result_subject_binding.v1',
    binding_id: inputs.binding_id,
    operation_scope_ref: canonicalOperationScopeReference(resource),
    owner_subject_ref: canonicalSubjectReference(principal.subject),
    binding_policy_version: 'result_binding_policy.v1',
    creation_authority: 'siteborne:request-admission',
    created_at: inputs.created_at,
    authority_context_id: inputs.authority_context_id,
    policy_evaluation_id: inputs.policy_evaluation_id,
  });
}

function evaluation(
  decision: ResultReleaseDecision,
  resourceRef: string,
  policyVersion: string,
  reasonCodes: readonly string[]
): ResultReleaseAuthorizationEvaluation {
  return Object.freeze({
    decision,
    resource_ref: resourceRef,
    policy_version: policyVersion,
    reason_codes: Object.freeze([...reasonCodes]),
  });
}

function validInstant(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Closed local projection of the governed Release 3 service metadata. */
const GOVERNED_V3_CONFIDENTIALITY: Readonly<Record<string, ResultConfidentialityClass>> =
  Object.freeze({
    'company_evidence_graph.v3': 'PUBLIC',
    'web_context_verified.v3': 'PUBLIC',
    'document_evidence_json.v3': 'BUYER_AUTHORIZED',
    'verify_agent_output.v3': 'BUYER_AUTHORIZED',
  });

function governedConfidentialityClass(
  resource: ResultResourceV1
): ResultConfidentialityClass | null {
  if (resource.contract_release !== '3.0.0' || resource.service_version !== 'v3') return null;
  return GOVERNED_V3_CONFIDENTIALITY[resource.service_id] ?? null;
}

/**
 * Deterministic, provider-free result-release policy. Both initial delivery
 * and cached replay must invoke this exact function after locating the same
 * resource; no economic or PCC validity decision is made here.
 */
function evaluateResultReleaseAuthorizationWithRegistry(
  input: ResultReleaseAuthorizationInput,
  trustedDelegationRegistryRecords: readonly ResultAccessDelegationV1[]
): ResultReleaseAuthorizationEvaluation {
  const resourceRef = canonicalResourceReference(input.result_resource);
  if (input.policy.policy_version !== 'result_release_policy.v1') {
    return evaluation('POLICY_ERROR', resourceRef, String(input.policy.policy_version), [
      'unsupported_policy_version',
    ]);
  }
  if (validInstant(input.policy.evaluated_at) === null) {
    return evaluation('POLICY_ERROR', resourceRef, input.policy.policy_version, [
      'invalid_evaluation_time',
    ]);
  }
  const governedClass = governedConfidentialityClass(input.result_resource);
  if (
    governedClass === null ||
    input.confidentiality_class !== governedClass ||
    input.result_resource.confidentiality_class !== governedClass
  ) {
    return evaluation('POLICY_ERROR', resourceRef, input.policy.policy_version, [
      'governed_confidentiality_class_mismatch',
    ]);
  }
  if (input.confidentiality_class === 'PUBLIC') {
    return evaluation('PUBLIC_RESULT', resourceRef, input.policy.policy_version, ['public_result']);
  }
  if (!input.subject_binding) {
    return evaluation('LEGACY_UNBOUND', resourceRef, input.policy.policy_version, [
      'sensitive_result_has_no_subject_binding',
    ]);
  }
  if (
    input.subject_binding.operation_scope_ref !==
      canonicalOperationScopeReference(input.result_resource) ||
    input.subject_binding.binding_id !== input.result_resource.result_binding_id
  ) {
    return evaluation('RESOURCE_MISMATCH', resourceRef, input.policy.policy_version, [
      'subject_binding_resource_mismatch',
    ]);
  }
  if (!input.verified_principal) {
    return evaluation('NO_AUTHENTICATED_PRINCIPAL', resourceRef, input.policy.policy_version, [
      'authenticated_principal_required',
    ]);
  }

  const callerRef = canonicalSubjectReference(input.verified_principal.subject);
  if (
    input.policy.revoked_subject_refs.includes(callerRef) ||
    input.policy.revoked_subject_refs.includes(input.subject_binding.owner_subject_ref)
  ) {
    return evaluation('SUBJECT_REVOKED', resourceRef, input.policy.policy_version, [
      'subject_access_revoked',
    ]);
  }
  if (callerRef === input.subject_binding.owner_subject_ref) {
    return evaluation('MATCH', resourceRef, input.policy.policy_version, ['owner_subject_match']);
  }

  const candidateGrant = input.delegation_evidence;
  if (!candidateGrant) {
    return evaluation('SUBJECT_MISMATCH', resourceRef, input.policy.policy_version, [
      'owner_subject_mismatch',
    ]);
  }
  const grant = verifyResultAccessDelegation(candidateGrant, trustedDelegationRegistryRecords);
  if (!grant) {
    return evaluation('DELEGATION_INVALID', resourceRef, input.policy.policy_version, [
      'delegation_evidence_unverified',
    ]);
  }
  const evaluatedAt = validInstant(input.policy.evaluated_at);
  const notBefore = validInstant(grant.not_before);
  const expiresAt = validInstant(grant.expires_at);
  const delegationValid =
    grant.schema_version === 'result_access_delegation.v1' &&
    grant.issuance_authority === 'siteborne:delegation-registry' &&
    grant.permission === 'result:read' &&
    grant.resource_ref === resourceRef &&
    grant.issuer_subject_ref === input.subject_binding.owner_subject_ref &&
    grant.delegate_subject_ref === callerRef &&
    !input.policy.revoked_delegation_ids.includes(grant.delegation_id) &&
    evaluatedAt !== null &&
    notBefore !== null &&
    expiresAt !== null &&
    notBefore <= evaluatedAt &&
    evaluatedAt < expiresAt;

  return delegationValid
    ? evaluation('VALID_DELEGATION', resourceRef, input.policy.policy_version, [
        'valid_result_read_delegation',
      ])
    : evaluation('DELEGATION_INVALID', resourceRef, input.policy.policy_version, [
        'delegation_invalid_or_out_of_scope',
      ]);
}

export type ResultReleaseAuthorizationEvaluator = (
  input: ResultReleaseAuthorizationInput
) => ResultReleaseAuthorizationEvaluation;

/**
 * Composition-root factory. The trusted registry snapshot is closed over by
 * the server-owned evaluator and is never accepted from a request or policy
 * call. The default exported evaluator has no trusted delegations.
 */
export function createResultReleaseAuthorizationEvaluator(
  trustedDelegationRegistryRecords: readonly ResultAccessDelegationV1[]
): ResultReleaseAuthorizationEvaluator {
  const registrySnapshot = Object.freeze(
    trustedDelegationRegistryRecords.map((record) => Object.freeze({ ...record }))
  );
  return (input) => evaluateResultReleaseAuthorizationWithRegistry(input, registrySnapshot);
}

export const evaluateResultReleaseAuthorization = createResultReleaseAuthorizationEvaluator(
  Object.freeze([])
);

/** The two delivery paths are aliases of the same policy function by design. */
export const authorizeInitialResultRelease = evaluateResultReleaseAuthorization;
export const authorizeReplayResultRelease = evaluateResultReleaseAuthorization;

/** Existing admission/payment authority and result release are both required. */
export function composeResultDeliveryEligibility(
  admissionAuthorized: boolean,
  release: ResultReleaseAuthorizationEvaluation
): boolean {
  return (
    admissionAuthorized &&
    (release.decision === 'PUBLIC_RESULT' ||
      release.decision === 'MATCH' ||
      release.decision === 'VALID_DELEGATION')
  );
}

function evaluateResultDeliveryComposition(
  path: 'initial' | 'replay',
  input: ResultDeliveryCompositionInput
): ResultDeliveryCompositionEvaluation {
  const release = evaluateResultReleaseAuthorization(input.authorization_input);
  return Object.freeze({
    path,
    deliver:
      input.result_located &&
      input.pcc_valid &&
      composeResultDeliveryEligibility(input.admission_authorized, release),
    release_authorization: release,
  });
}

export function evaluateInitialResultDelivery(
  input: ResultDeliveryCompositionInput
): ResultDeliveryCompositionEvaluation {
  return evaluateResultDeliveryComposition('initial', input);
}

export function evaluateReplayResultDelivery(
  input: ResultDeliveryCompositionInput
): ResultDeliveryCompositionEvaluation {
  return evaluateResultDeliveryComposition('replay', input);
}
