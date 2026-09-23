import { createHash, createHmac } from 'node:crypto';

export type ResultConfidentialityClass = 'PUBLIC' | 'BUYER_AUTHORIZED';
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
  readonly value: string;
}

export interface ResultSubjectV1 {
  readonly schema_version: 'result_subject.v1';
  readonly subject_type: ResultSubjectType;
  readonly issuer: string;
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

export interface SubjectReferenceKey {
  readonly key: Uint8Array;
  readonly keyVersion: string;
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
  readonly confidentiality_class: ResultConfidentialityClass;
  readonly result_binding_id: string;
}

export interface ResultSubjectBindingV1 {
  readonly schema_version: 'result_subject_binding.v1';
  readonly binding_id: string;
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

export type ResultReleaseDecision =
  | 'MATCH'
  | 'PUBLIC_RESULT'
  | 'VALID_DELEGATION'
  | 'NO_AUTHENTICATED_PRINCIPAL'
  | 'SUBJECT_MISMATCH'
  | 'SUBJECT_REVOKED'
  | 'DELEGATION_INVALID'
  | 'RESOURCE_MISMATCH'
  | 'LEGACY_UNBOUND'
  | 'POLICY_ERROR';

export interface ResultAuthorizationContextV1 {
  readonly schema_version: 'result_authorization_context.v1';
  readonly verified_principal: VerifiedPrincipalEvidence | null;
  readonly result_resource: ResultResourceV1;
  readonly confidentiality_class: ResultConfidentialityClass;
  readonly subject_binding: ResultSubjectBindingV1 | null;
  readonly delegation_evidence: ResultAccessDelegationV1 | null;
  readonly binding_policy_version: string | null;
  readonly release_policy_version: string;
  readonly revoked_subject_refs: readonly string[];
  readonly evaluated_at: string;
  readonly subject_reference_key?: SubjectReferenceKey;
  readonly authority_context_id?: string;
  readonly policy_evaluation_id?: string;
}

export interface ResultReleaseEvaluation {
  readonly decision: ResultReleaseDecision;
  readonly resource_ref: string;
  readonly policy_version: string;
  readonly reason_codes: readonly string[];
}

const GOVERNED_V3_CONFIDENTIALITY: Readonly<Record<string, ResultConfidentialityClass>> =
  Object.freeze({
    'company_evidence_graph.v3': 'PUBLIC',
    'web_context_verified.v3': 'PUBLIC',
    'document_evidence_json.v3': 'BUYER_AUTHORIZED',
    'verify_agent_output.v3': 'BUYER_AUTHORIZED',
  });

const SUBJECT_TYPES = new Set<ResultSubjectType>([
  'human',
  'organization',
  'service_account',
  'workload',
  'agent',
]);
const AUTHENTICATION_METHODS = new Set<ResultAuthenticationMethod>([
  'oidc',
  'signed_request',
  'api_key',
  'mtls',
  'gateway_assertion',
]);
const ASSURANCE_LEVELS = new Set<ResultAssuranceLevel>([
  'verified_single_factor',
  'verified_multi_factor',
  'cryptographic_workload',
  'trusted_gateway_assertion',
]);
const CREDENTIAL_BINDING_KINDS = new Set<CredentialBindingV1['kind']>([
  'jwk_thumbprint',
  'certificate_sha256',
  'key_id',
]);

function normalizedText(value: string, name: string): string {
  const normalized = value.normalize('NFC').trim();
  const hasControlCharacter = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!normalized || normalized.length > 1024 || hasControlCharacter) {
    throw new Error(`invalid_${name}`);
  }
  return normalized;
}

export function normalizeResultSubject(subject: ResultSubjectV1): ResultSubjectV1 {
  if (!SUBJECT_TYPES.has(subject.subject_type)) throw new Error('invalid_subject_type');
  if (!AUTHENTICATION_METHODS.has(subject.authentication_method)) {
    throw new Error('invalid_authentication_method');
  }
  if (!ASSURANCE_LEVELS.has(subject.assurance_level)) throw new Error('invalid_assurance_level');
  if (
    subject.credential_binding &&
    !CREDENTIAL_BINDING_KINDS.has(subject.credential_binding.kind)
  ) {
    throw new Error('invalid_credential_binding_kind');
  }
  const authenticatedAt = new Date(subject.authenticated_at);
  if (!Number.isFinite(authenticatedAt.getTime())) throw new Error('invalid_authenticated_at');
  return Object.freeze({
    ...subject,
    issuer: normalizedText(subject.issuer, 'issuer').replace(/\/$/u, ''),
    subject_id: normalizedText(subject.subject_id, 'subject_id'),
    authenticated_at: authenticatedAt.toISOString(),
    credential_binding: subject.credential_binding
      ? Object.freeze({
          kind: subject.credential_binding.kind,
          value: normalizedText(subject.credential_binding.value, 'credential_binding'),
        })
      : null,
  });
}

function digestReference(domain: string, fields: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  for (const field of fields) {
    hash.update('\0', 'utf8');
    hash.update(field, 'utf8');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function canonicalSubjectReference(
  rawSubject: ResultSubjectV1,
  referenceKey: SubjectReferenceKey
): string {
  if (
    !/^[A-Za-z0-9._-]{1,64}$/u.test(referenceKey.keyVersion) ||
    referenceKey.key.byteLength < 32
  ) {
    throw new Error('invalid_subject_reference_key');
  }
  const subject = normalizeResultSubject(rawSubject);
  const qualified = createHash('sha256')
    .update(
      JSON.stringify({
        issuer: subject.issuer,
        subject_id: subject.subject_id,
        subject_type: subject.subject_type,
      }),
      'utf8'
    )
    .digest('hex');
  const digest = createHmac('sha256', referenceKey.key)
    .update(
      JSON.stringify({
        domain: 'siteborne.subject_digest.v1',
        key_version: referenceKey.keyVersion,
        subject_type: 'authenticated_caller_subject',
        value: `principal:${qualified}`,
      }),
      'utf8'
    )
    .digest('hex');
  return `${referenceKey.keyVersion}:${digest}`;
}

export function canonicalOperationScopeReference(resource: ResultResourceV1): string {
  return digestReference('SITEBORNE-RESULT-OPERATION-SCOPE-V1', [
    resource.operation_id,
    resource.service_id,
    resource.service_version,
    resource.contract_release,
    resource.confidentiality_class,
  ]);
}

export function canonicalResourceReference(resource: ResultResourceV1): string {
  return digestReference('SITEBORNE-RESULT-RESOURCE-V1', [
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

/** Stable across Workflow retries without placing caller or payment data in
 * the result identifier. The operation ID is a random, server-owned UUID. */
export function canonicalOpaqueResultId(operationId: string): string {
  return `result_${digestReference('SITEBORNE-RESULT-ID-V1', [operationId]).slice(7)}`;
}

export function governedResultConfidentiality(
  serviceId: string,
  serviceVersion: string,
  contractRelease: string
): ResultConfidentialityClass | null {
  if (serviceVersion !== 'v3' || contractRelease !== '3.0.0') return null;
  return GOVERNED_V3_CONFIDENTIALITY[serviceId] ?? null;
}

export function createResultSubjectBinding(
  resource: ResultResourceV1,
  principal: VerifiedPrincipalEvidence,
  input: {
    readonly subjectReferenceKey: SubjectReferenceKey;
    readonly binding_id: string;
    readonly created_at: string;
    readonly authority_context_id: string;
    readonly policy_evaluation_id: string;
  }
): ResultSubjectBindingV1 {
  return Object.freeze({
    schema_version: 'result_subject_binding.v1',
    binding_id: input.binding_id,
    operation_scope_ref: canonicalOperationScopeReference(resource),
    owner_subject_ref: canonicalSubjectReference(principal.subject, input.subjectReferenceKey),
    binding_policy_version: 'result_binding_policy.v1',
    creation_authority: 'siteborne:request-admission',
    created_at: new Date(input.created_at).toISOString(),
    authority_context_id: input.authority_context_id,
    policy_evaluation_id: input.policy_evaluation_id,
  });
}

function evaluated(
  decision: ResultReleaseDecision,
  resource: ResultResourceV1,
  policyVersion: string,
  reason: string
): ResultReleaseEvaluation {
  return Object.freeze({
    decision,
    resource_ref: canonicalResourceReference(resource),
    policy_version: policyVersion,
    reason_codes: Object.freeze([reason]),
  });
}

export function evaluateResultReleaseAuthorization(
  context: ResultAuthorizationContextV1
): ResultReleaseEvaluation {
  const { result_resource: resource } = context;
  if (
    context.release_policy_version !== 'result_release_policy.v1' ||
    !Number.isFinite(Date.parse(context.evaluated_at))
  ) {
    return evaluated(
      'POLICY_ERROR',
      resource,
      context.release_policy_version,
      'unsupported_policy'
    );
  }
  const governed = governedResultConfidentiality(
    resource.service_id,
    resource.service_version,
    resource.contract_release
  );
  if (
    !governed ||
    governed !== resource.confidentiality_class ||
    governed !== context.confidentiality_class
  ) {
    return evaluated(
      'POLICY_ERROR',
      resource,
      context.release_policy_version,
      'classification_mismatch'
    );
  }
  if (governed === 'PUBLIC') {
    return evaluated('PUBLIC_RESULT', resource, context.release_policy_version, 'public_result');
  }
  if (!context.subject_binding) {
    return evaluated('LEGACY_UNBOUND', resource, context.release_policy_version, 'legacy_unbound');
  }
  if (context.binding_policy_version !== 'result_binding_policy.v1') {
    return evaluated(
      'POLICY_ERROR',
      resource,
      context.release_policy_version,
      'unsupported_binding_policy'
    );
  }
  if (
    context.subject_binding.binding_id !== resource.result_binding_id ||
    context.subject_binding.operation_scope_ref !== canonicalOperationScopeReference(resource)
  ) {
    return evaluated(
      'RESOURCE_MISMATCH',
      resource,
      context.release_policy_version,
      'resource_mismatch'
    );
  }
  if (!context.verified_principal) {
    return evaluated(
      'NO_AUTHENTICATED_PRINCIPAL',
      resource,
      context.release_policy_version,
      'authentication_required'
    );
  }
  if (!context.subject_reference_key) {
    return evaluated(
      'POLICY_ERROR',
      resource,
      context.release_policy_version,
      'subject_key_unavailable'
    );
  }
  const callerRef = canonicalSubjectReference(
    context.verified_principal.subject,
    context.subject_reference_key
  );
  if (
    context.revoked_subject_refs.includes(callerRef) ||
    context.revoked_subject_refs.includes(context.subject_binding.owner_subject_ref)
  ) {
    return evaluated(
      'SUBJECT_REVOKED',
      resource,
      context.release_policy_version,
      'subject_revoked'
    );
  }
  if (callerRef === context.subject_binding.owner_subject_ref) {
    return evaluated('MATCH', resource, context.release_policy_version, 'owner_subject_match');
  }
  // Delegation persistence/API is intentionally deferred for first activation.
  return evaluated(
    context.delegation_evidence ? 'DELEGATION_INVALID' : 'SUBJECT_MISMATCH',
    resource,
    context.release_policy_version,
    context.delegation_evidence ? 'delegation_not_supported' : 'owner_subject_mismatch'
  );
}

export function publicResultAuthorizationError(
  decision: ResultReleaseDecision
): { status: 401 | 404; code: 'authentication_required' | 'result_not_available' } | null {
  if (decision === 'MATCH' || decision === 'PUBLIC_RESULT' || decision === 'VALID_DELEGATION')
    return null;
  return decision === 'NO_AUTHENTICATED_PRINCIPAL'
    ? { status: 401, code: 'authentication_required' }
    : { status: 404, code: 'result_not_available' };
}
