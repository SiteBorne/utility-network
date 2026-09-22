import { describe, expect, it } from 'vitest';
import {
  canonicalResourceReference,
  canonicalSubjectReference,
  createResultReleaseAuthorizationEvaluator,
  createResultSubjectBinding,
  evaluateInitialResultDelivery,
  evaluateReplayResultDelivery,
  evaluateResultReleaseAuthorization,
  verifyIdentityEvidence,
  type ExternalIdentityEvidence,
  type ResultAccessDelegationV1,
  type ResultAuthorizationPolicyV1,
  type ResultResourceV1,
  type ResultSubjectV1,
  type VerifiedPrincipalEvidence,
} from './support/result-authorization-reference-model';

const NOW = '2026-09-22T12:00:00.000Z';
const LATER = '2026-09-22T13:00:00.000Z';

const subject = (subjectId: string, overrides: Partial<ResultSubjectV1> = {}): ResultSubjectV1 => ({
  schema_version: 'result_subject.v1',
  subject_type: 'human',
  issuer: 'https://identity.siteborne.test',
  subject_id: subjectId,
  authentication_method: 'oidc',
  assurance_level: 'verified_single_factor',
  authenticated_at: NOW,
  credential_binding: null,
  ...overrides,
});

const principal = (
  subjectId: string,
  overrides: Partial<ResultSubjectV1> = {}
): VerifiedPrincipalEvidence => ({
  verification_status: 'VERIFIED',
  subject: subject(subjectId, overrides),
  evidence_type: 'cryptographically_authenticated',
  verifier_id: 'siteborne.identity-evidence-verifier.v1',
});

const resource = (overrides: Partial<ResultResourceV1> = {}): ResultResourceV1 => ({
  schema_version: 'result_resource.v1',
  operation_id: 'job_018f0000-0000-7000-8000-000000000001',
  result_id: 'result_018f0000-0000-7000-8000-000000000001',
  artifact_id:
    'r2:results/pcc/sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  pcc_document_hash: `sha256:${'a'.repeat(64)}`,
  service_id: 'document_evidence_json.v3',
  service_version: 'v3',
  contract_release: '3.0.0',
  confidentiality_class: 'BUYER_AUTHORIZED',
  result_binding_id: 'rb_018f0000-0000-7000-8000-000000000001',
  ...overrides,
});

const bindingFor = (owner: VerifiedPrincipalEvidence, r = resource()) =>
  createResultSubjectBinding(r, owner, {
    binding_id: 'rb_018f0000-0000-7000-8000-000000000001',
    created_at: NOW,
    authority_context_id: 'ac_018f0000-0000-7000-8000-000000000001',
    policy_evaluation_id: 'pe_018f0000-0000-7000-8000-000000000001',
  });

const policy = (
  overrides: Partial<ResultAuthorizationPolicyV1> = {}
): ResultAuthorizationPolicyV1 => ({
  policy_version: 'result_release_policy.v1',
  evaluated_at: NOW,
  revoked_subject_refs: [],
  revoked_delegation_ids: [],
  ...overrides,
});

const delegation = (
  owner: VerifiedPrincipalEvidence,
  delegate: VerifiedPrincipalEvidence,
  r = resource(),
  overrides: Partial<ResultAccessDelegationV1> = {}
): ResultAccessDelegationV1 => ({
  schema_version: 'result_access_delegation.v1',
  delegation_id: 'rd_018f0000-0000-7000-8000-000000000001',
  issuer_subject_ref: canonicalSubjectReference(owner.subject),
  delegate_subject_ref: canonicalSubjectReference(delegate.subject),
  resource_ref: canonicalResourceReference(r),
  permission: 'result:read',
  not_before: NOW,
  expires_at: LATER,
  issuance_authority: 'siteborne:delegation-registry',
  integrity_ref: `sha256:${'d'.repeat(64)}`,
  ...overrides,
});

const authorizationInput = ({
  caller,
  owner = principal('buyer-1'),
  r = resource(),
  classification = r.confidentiality_class,
  suppliedDelegation = null as ResultAccessDelegationV1 | null,
  currentPolicy = policy(),
  binding = undefined as ReturnType<typeof bindingFor> | null | undefined,
} = {}) => ({
  verified_principal: caller ?? null,
  result_resource: r,
  subject_binding: binding === undefined ? bindingFor(owner, r) : binding,
  confidentiality_class: classification,
  delegation_evidence: suppliedDelegation,
  policy: currentPolicy,
});

const evaluate = (inputs: Parameters<typeof authorizationInput>[0] = {}) => {
  const input = authorizationInput(inputs);
  const evaluator = input.delegation_evidence
    ? createResultReleaseAuthorizationEvaluator([input.delegation_evidence])
    : evaluateResultReleaseAuthorization;
  return evaluator(input);
};

describe('RESULT-AUTHORIZATION-DESIGN-01 local reference policy', () => {
  it('1. releases a public result to an anonymous caller', () => {
    const publicResource = resource({
      service_id: 'company_evidence_graph.v3',
      confidentiality_class: 'PUBLIC',
    });
    expect(evaluate({ caller: null, r: publicResource, binding: null }).decision).toBe(
      'PUBLIC_RESULT'
    );
  });

  it('2. denies a buyer-authorized result without a principal', () => {
    expect(evaluate({ caller: null }).decision).toBe('NO_AUTHENTICATED_PRINCIPAL');
  });

  it('3. releases to the matching authenticated principal', () => {
    expect(evaluate({ caller: principal('buyer-1') }).decision).toBe('MATCH');
  });

  it('4. denies a nonmatching authenticated principal', () => {
    expect(evaluate({ caller: principal('attacker') }).decision).toBe('SUBJECT_MISMATCH');
  });

  it('5. matching payer evidence cannot substitute for the wrong caller', () => {
    const result = evaluateReplayResultDelivery({
      admission_authorized: true,
      result_located: true,
      pcc_valid: true,
      payer_evidence: {
        evidence_type: 'payment_derived',
        payer_ref: 'wallet-shared-by-buyer-and-attacker',
      },
      authorization_input: authorizationInput({ caller: principal('attacker') }),
    });
    expect(result.release_authorization.decision).toBe('SUBJECT_MISMATCH');
    expect(result.deliver).toBe(false);
  });

  it('6. two principals sharing one wallet remain separately principal-bound', () => {
    const sharedWallet = '0x0000000000000000000000000000000000000001';
    const buyer = principal('buyer-1');
    const other = principal('buyer-2');
    expect(canonicalSubjectReference(buyer.subject)).not.toBe(
      canonicalSubjectReference(other.subject)
    );
    const common = {
      admission_authorized: true,
      result_located: true,
      pcc_valid: true,
      payer_evidence: { evidence_type: 'payment_derived' as const, payer_ref: sharedWallet },
    };
    expect(
      evaluateReplayResultDelivery({
        ...common,
        authorization_input: authorizationInput({ caller: buyer, owner: buyer }),
      }).deliver
    ).toBe(true);
    expect(
      evaluateReplayResultDelivery({
        ...common,
        authorization_input: authorizationInput({ caller: other, owner: buyer }),
      }).deliver
    ).toBe(false);
  });

  it('7. releases through a valid result-specific delegation', () => {
    const owner = principal('buyer-1');
    const agent = principal('agent-1', { subject_type: 'agent' });
    expect(
      evaluate({ caller: agent, owner, suppliedDelegation: delegation(owner, agent) }).decision
    ).toBe('VALID_DELEGATION');
  });

  it('8. rejects an expired delegation', () => {
    const owner = principal('buyer-1');
    const agent = principal('agent-1', { subject_type: 'agent' });
    const expired = delegation(owner, agent, resource(), {
      expires_at: '2026-09-22T11:59:59.000Z',
    });
    expect(evaluate({ caller: agent, owner, suppliedDelegation: expired }).decision).toBe(
      'DELEGATION_INVALID'
    );
  });

  it('9. rejects a delegation scoped to a different result resource', () => {
    const owner = principal('buyer-1');
    const agent = principal('agent-1', { subject_type: 'agent' });
    const other = resource({ result_id: 'result_other' });
    expect(
      evaluate({
        caller: agent,
        owner,
        suppliedDelegation: delegation(owner, agent, other),
      }).decision
    ).toBe('DELEGATION_INVALID');
  });

  it('10. rejects identity evidence from an untrusted issuer', () => {
    const evidence: ExternalIdentityEvidence = {
      evidence_type: 'oidc_bearer',
      issuer: 'https://attacker.invalid',
      subject_id: 'buyer-1',
      audience: 'siteborne-result-release',
      authenticated_at: NOW,
      assurance_level: 'verified_single_factor',
      integrity_verified: true,
      freshness_verified: true,
      credential_binding: null,
    };
    expect(verifyIdentityEvidence(evidence).reason).toBe('UNTRUSTED_ISSUER');
  });

  it('11. rejects identity evidence with the wrong audience', () => {
    const evidence: ExternalIdentityEvidence = {
      evidence_type: 'oidc_bearer',
      issuer: 'https://identity.siteborne.test',
      subject_id: 'buyer-1',
      audience: 'some-other-service',
      authenticated_at: NOW,
      assurance_level: 'verified_single_factor',
      integrity_verified: true,
      freshness_verified: true,
      credential_binding: null,
    };
    expect(verifyIdentityEvidence(evidence).reason).toBe('AUDIENCE_MISMATCH');
  });

  it('12. rejects an arbitrary gateway identity header', () => {
    const evidence: ExternalIdentityEvidence = {
      evidence_type: 'gateway_assertion',
      issuer: 'https://identity.siteborne.test',
      subject_id: 'buyer-1',
      audience: 'siteborne-result-release',
      authenticated_at: NOW,
      assurance_level: 'trusted_gateway_assertion',
      integrity_verified: true,
      freshness_verified: true,
      asserting_intermediary: 'untrusted-reverse-proxy',
      intermediary_authenticated: false,
      assertion_semantics: 'x-user-header',
      credential_binding: null,
    };
    expect(verifyIdentityEvidence(evidence).reason).toBe('UNTRUSTED_INTERMEDIARY');
  });

  it('13. matches a cryptographically authenticated workload principal', () => {
    const workload = principal('spiffe://example.test/ns/prod/sa/verifier', {
      subject_type: 'workload',
      authentication_method: 'mtls',
      assurance_level: 'cryptographic_workload',
      credential_binding: {
        kind: 'certificate_sha256',
        value: `sha256:${'b'.repeat(64)}`,
      },
    });
    expect(evaluate({ caller: workload, owner: workload }).decision).toBe('MATCH');
  });

  it('14. a matching replay tuple still denies the wrong principal', () => {
    const replay = evaluateReplayResultDelivery({
      admission_authorized: true,
      result_located: true,
      pcc_valid: true,
      payer_evidence: null,
      authorization_input: authorizationInput({ caller: principal('attacker') }),
    });
    expect(replay.release_authorization.decision).toBe('SUBJECT_MISMATCH');
    expect(replay.deliver).toBe(false);
  });

  it('15. initial delivery and cached replay invoke the identical policy function', () => {
    const buyer = principal('buyer-1');
    const r = resource();
    const common = {
      admission_authorized: true,
      result_located: true,
      pcc_valid: true,
      payer_evidence: null,
      authorization_input: authorizationInput({ caller: buyer, owner: buyer, r }),
    };
    const initial = evaluateInitialResultDelivery(common);
    const replay = evaluateReplayResultDelivery(common);
    expect(initial.release_authorization).toEqual(replay.release_authorization);
    expect(initial.deliver).toBe(true);
    expect(replay.deliver).toBe(true);
  });

  it('16. public release does not add an identity requirement to payment/admission semantics', () => {
    const publicResource = resource({
      service_id: 'web_context_verified.v3',
      confidentiality_class: 'PUBLIC',
    });
    const common = {
      result_located: true,
      pcc_valid: true,
      payer_evidence: null,
      authorization_input: authorizationInput({ caller: null, r: publicResource, binding: null }),
    };
    const deniedByAdmission = evaluateInitialResultDelivery({
      ...common,
      admission_authorized: false,
    });
    const admitted = evaluateInitialResultDelivery({ ...common, admission_authorized: true });
    expect(admitted.release_authorization.decision).toBe('PUBLIC_RESULT');
    expect(deniedByAdmission.deliver).toBe(false);
    expect(admitted.deliver).toBe(true);
  });

  it('17. a legacy sensitive result without a subject binding fails conservatively', () => {
    expect(evaluate({ caller: principal('buyer-1'), binding: null }).decision).toBe(
      'LEGACY_UNBOUND'
    );
  });

  it('18. PCC cryptographic validity is independent from result-release authorization', () => {
    const common = {
      admission_authorized: true,
      result_located: true,
      payer_evidence: null,
      authorization_input: authorizationInput({ caller: principal('buyer-1') }),
    };
    const invalidPcc = evaluateInitialResultDelivery({ ...common, pcc_valid: false });
    const validPcc = evaluateInitialResultDelivery({ ...common, pcc_valid: true });
    expect(invalidPcc.release_authorization.decision).toBe('MATCH');
    expect(validPcc.release_authorization.decision).toBe('MATCH');
    expect(invalidPcc.deliver).toBe(false);
    expect(validPcc.deliver).toBe(true);
  });

  it('19. revocation changes release permission without changing the resource/PCC identity', () => {
    const buyer = principal('buyer-1');
    const r = resource();
    const before = evaluate({ caller: buyer, owner: buyer, r });
    const after = evaluate({
      caller: buyer,
      owner: buyer,
      r,
      currentPolicy: policy({
        revoked_subject_refs: [canonicalSubjectReference(buyer.subject)],
      }),
    });
    expect(before.decision).toBe('MATCH');
    expect(after.decision).toBe('SUBJECT_REVOKED');
    expect(after.resource_ref).toBe(before.resource_ref);
  });

  it('20. durable subject bindings cannot contain raw authentication tokens', () => {
    const rawToken = 'raw-secret-bearer-token-sentinel';
    const binding = bindingFor(principal('buyer-1'));
    expect(JSON.stringify(binding)).not.toContain(rawToken);
    expect(Object.keys(binding)).toEqual([
      'schema_version',
      'binding_id',
      'operation_scope_ref',
      'owner_subject_ref',
      'binding_policy_version',
      'creation_authority',
      'created_at',
      'authority_context_id',
      'policy_evaluation_id',
    ]);
  });

  it('fails closed when a subject binding names another resource', () => {
    const owner = principal('buyer-1');
    const wrongBinding = bindingFor(owner, resource({ operation_id: 'job_other' }));
    expect(evaluate({ caller: owner, binding: wrongBinding }).decision).toBe('RESOURCE_MISMATCH');
  });

  it('rejects a revoked delegation', () => {
    const owner = principal('buyer-1');
    const agent = principal('agent-1', { subject_type: 'agent' });
    const grant = delegation(owner, agent);
    expect(
      evaluate({
        caller: agent,
        owner,
        suppliedDelegation: grant,
        currentPolicy: policy({ revoked_delegation_ids: [grant.delegation_id] }),
      }).decision
    ).toBe('DELEGATION_INVALID');
  });

  it('rejects delegation after the bound owner subject is revoked', () => {
    const owner = principal('buyer-1');
    const agent = principal('agent-1', { subject_type: 'agent' });
    expect(
      evaluate({
        caller: agent,
        owner,
        suppliedDelegation: delegation(owner, agent),
        currentPolicy: policy({
          revoked_subject_refs: [canonicalSubjectReference(owner.subject)],
        }),
      }).decision
    ).toBe('SUBJECT_REVOKED');
  });

  it('rejects integrity-unverified identity evidence', () => {
    const evidence: ExternalIdentityEvidence = {
      evidence_type: 'signed_request',
      issuer: 'https://identity.siteborne.test',
      subject_id: 'service-account-1',
      audience: 'siteborne-result-release',
      authenticated_at: NOW,
      assurance_level: 'cryptographic_workload',
      integrity_verified: false,
      freshness_verified: true,
      credential_binding: { kind: 'jwk_thumbprint', value: `sha256:${'c'.repeat(64)}` },
    };
    expect(verifyIdentityEvidence(evidence).reason).toBe('INTEGRITY_UNVERIFIED');
  });

  it('keeps subject references issuer-qualified', () => {
    expect(canonicalSubjectReference(subject('same-subject'))).not.toBe(
      canonicalSubjectReference(subject('same-subject', { issuer: 'https://other.example' }))
    );
  });

  it('rejects a caller-controlled confidentiality downgrade to PUBLIC', () => {
    expect(
      evaluate({
        caller: null,
        r: resource({ confidentiality_class: 'BUYER_AUTHORIZED' }),
        classification: 'PUBLIC',
      }).decision
    ).toBe('POLICY_ERROR');
  });

  it('rejects relabeling both a governed buyer resource and policy input as PUBLIC', () => {
    const relabeled = resource({ confidentiality_class: 'PUBLIC' });
    expect(
      evaluate({ caller: null, r: relabeled, classification: 'PUBLIC', binding: null }).decision
    ).toBe('POLICY_ERROR');
  });

  it('rejects a forged delegation object even when it claims integrity verification', () => {
    const owner = principal('buyer-1');
    const agent = principal('agent-1', { subject_type: 'agent' });
    const forged = {
      ...delegation(owner, agent),
      integrity_verified: true,
    } as unknown as ResultAccessDelegationV1;
    const input = authorizationInput({ caller: agent, owner, suppliedDelegation: forged });
    expect(evaluateResultReleaseAuthorization(input).decision).toBe('DELEGATION_INVALID');
  });
});
