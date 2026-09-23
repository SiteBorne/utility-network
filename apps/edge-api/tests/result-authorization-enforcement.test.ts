import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  canonicalOperationScopeReference,
  canonicalResourceReference,
  canonicalSubjectReference,
  createResultSubjectBinding,
  evaluateResultReleaseAuthorization,
  governedResultConfidentiality,
  normalizeResultSubject,
  publicResultAuthorizationError,
  type ResultResourceV1,
  type ResultSubjectV1,
  type VerifiedPrincipalEvidence,
} from '../src/control-plane/security/result-authorization';
import {
  createOidcPrincipalVerifier,
  type OidcIssuerConfiguration,
} from '../src/control-plane/security/oidc-principal';
import { mapVerifiedMtlsPrincipal } from '../src/control-plane/security/mtls-principal';
import { createX402ServiceRoute } from '../src/control-plane/routes/x402-service';

const NOW = '2026-09-22T12:00:00.000Z';
const KEY = new Uint8Array(32).fill(0x4a);

function subject(id: string, issuer = 'https://identity.siteborne.test'): ResultSubjectV1 {
  return {
    schema_version: 'result_subject.v1',
    subject_type: 'human',
    issuer,
    subject_id: id,
    authentication_method: 'oidc',
    assurance_level: 'verified_single_factor',
    authenticated_at: NOW,
    credential_binding: null,
  };
}

function principal(id: string, issuer?: string): VerifiedPrincipalEvidence {
  return {
    verification_status: 'VERIFIED',
    evidence_type: 'cryptographically_authenticated',
    verifier_id: 'siteborne.identity-evidence-verifier.v1',
    subject: subject(id, issuer),
  };
}

function resource(overrides: Partial<ResultResourceV1> = {}): ResultResourceV1 {
  return {
    schema_version: 'result_resource.v1',
    operation_id: 'job-1',
    result_id: 'res-1',
    artifact_id: 'r2:results/pcc/sha256-aaaa',
    pcc_document_hash: `sha256:${'a'.repeat(64)}`,
    service_id: 'document_evidence_json.v3',
    service_version: 'v3',
    contract_release: '3.0.0',
    confidentiality_class: 'BUYER_AUTHORIZED',
    result_binding_id: 'rb-1',
    ...overrides,
  };
}

describe('production result authorization policy', () => {
  it('derives a deterministic issuer-qualified keyed subject reference without exposing the subject', () => {
    const a = canonicalSubjectReference(subject('buyer-1'), { key: KEY, keyVersion: 'k1' });
    const again = canonicalSubjectReference(subject('buyer-1'), { key: KEY, keyVersion: 'k1' });
    const otherIssuer = canonicalSubjectReference(subject('buyer-1', 'https://other.test'), {
      key: KEY,
      keyVersion: 'k1',
    });
    expect(a).toBe(again);
    expect(a).not.toBe(otherIssuer);
    expect(a).toMatch(/^k1:[a-f0-9]{64}$/);
    expect(a).not.toContain('buyer-1');
  });

  it('normalizes canonical text/time and rejects unknown semantic vocabulary', () => {
    expect(
      normalizeResultSubject({
        ...subject('buyer-1'),
        issuer: 'https://identity.siteborne.test/',
        authenticated_at: '2026-09-22T07:00:00-05:00',
      })
    ).toMatchObject({
      issuer: 'https://identity.siteborne.test',
      authenticated_at: NOW,
    });
    expect(() =>
      normalizeResultSubject({ ...subject('buyer-1'), subject_type: 'wallet' as never })
    ).toThrow('invalid_subject_type');
  });

  it('classifies only the governed Release 3 services', () => {
    expect(governedResultConfidentiality('company_evidence_graph.v3', 'v3', '3.0.0')).toBe(
      'PUBLIC'
    );
    expect(governedResultConfidentiality('verify_agent_output.v3', 'v3', '3.0.0')).toBe(
      'BUYER_AUTHORIZED'
    );
    expect(governedResultConfidentiality('verify_agent_output.v2', 'v2', '2.0.0')).toBeNull();
  });

  it('releases public results anonymously without changing economic admission', () => {
    const publicResource = resource({
      service_id: 'company_evidence_graph.v3',
      confidentiality_class: 'PUBLIC',
    });
    expect(
      evaluateResultReleaseAuthorization({
        verified_principal: null,
        result_resource: publicResource,
        subject_binding: null,
        confidentiality_class: 'PUBLIC',
        delegation_evidence: null,
        binding_policy_version: null,
        release_policy_version: 'result_release_policy.v1',
        revoked_subject_refs: [],
        evaluated_at: NOW,
      }).decision
    ).toBe('PUBLIC_RESULT');
  });

  it('uses the same closed policy for owner, missing principal, wrong principal, revocation, and substitution', () => {
    const owner = principal('buyer-1');
    const target = resource();
    const binding = createResultSubjectBinding(target, owner, {
      subjectReferenceKey: { key: KEY, keyVersion: 'k1' },
      binding_id: 'rb-1',
      created_at: NOW,
      authority_context_id: 'ac-1',
      policy_evaluation_id: 'pe-1',
    });
    const evaluate = (
      caller: VerifiedPrincipalEvidence | null,
      overrides: Partial<Parameters<typeof evaluateResultReleaseAuthorization>[0]> = {}
    ) =>
      evaluateResultReleaseAuthorization({
        verified_principal: caller,
        result_resource: target,
        subject_binding: binding,
        confidentiality_class: 'BUYER_AUTHORIZED',
        delegation_evidence: null,
        binding_policy_version: 'result_binding_policy.v1',
        release_policy_version: 'result_release_policy.v1',
        revoked_subject_refs: [],
        evaluated_at: NOW,
        subject_reference_key: { key: KEY, keyVersion: 'k1' },
        ...overrides,
      });

    expect(evaluate(null).decision).toBe('NO_AUTHENTICATED_PRINCIPAL');
    expect(evaluate(principal('buyer-2')).decision).toBe('SUBJECT_MISMATCH');
    expect(evaluate(owner).decision).toBe('MATCH');
    expect(evaluate(owner, { revoked_subject_refs: [binding.owner_subject_ref] }).decision).toBe(
      'SUBJECT_REVOKED'
    );
    expect(
      evaluate(owner, {
        result_resource: resource({ result_binding_id: 'rb-substitute' }),
      }).decision
    ).toBe('RESOURCE_MISMATCH');
    expect(canonicalOperationScopeReference(target)).toBe(binding.operation_scope_ref);
    expect(canonicalResourceReference(target)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('returns byte-identical policy decisions for initial delivery and replay inputs', () => {
    const owner = principal('buyer-1');
    const target = resource();
    const binding = createResultSubjectBinding(target, owner, {
      subjectReferenceKey: { key: KEY, keyVersion: 'k1' },
      binding_id: 'rb-1',
      created_at: NOW,
      authority_context_id: 'ac-1',
      policy_evaluation_id: 'pe-1',
    });
    const context = {
      verified_principal: owner,
      result_resource: target,
      subject_binding: binding,
      confidentiality_class: 'BUYER_AUTHORIZED' as const,
      delegation_evidence: null,
      binding_policy_version: 'result_binding_policy.v1',
      release_policy_version: 'result_release_policy.v1',
      revoked_subject_refs: [] as string[],
      evaluated_at: NOW,
      subject_reference_key: { key: KEY, keyVersion: 'k1' },
    };
    expect(evaluateResultReleaseAuthorization({ ...context })).toEqual(
      evaluateResultReleaseAuthorization({ ...context })
    );
  });

  it('does not let a shared payer or replay tuple distinguish or authorize callers', () => {
    const owner = principal('buyer-1');
    const attacker = principal('buyer-2');
    const target = resource();
    const binding = createResultSubjectBinding(target, owner, {
      subjectReferenceKey: { key: KEY, keyVersion: 'k1' },
      binding_id: 'rb-1',
      created_at: NOW,
      authority_context_id: 'ac-1',
      policy_evaluation_id: 'pe-1',
    });
    const decision = evaluateResultReleaseAuthorization({
      verified_principal: attacker,
      result_resource: target,
      subject_binding: binding,
      confidentiality_class: 'BUYER_AUTHORIZED',
      delegation_evidence: null,
      binding_policy_version: 'result_binding_policy.v1',
      release_policy_version: 'result_release_policy.v1',
      revoked_subject_refs: [],
      evaluated_at: NOW,
      subject_reference_key: { key: KEY, keyVersion: 'k1' },
    });
    expect(decision.decision).toBe('SUBJECT_MISMATCH');
    expect(publicResultAuthorizationError(decision.decision)).toEqual({
      status: 404,
      code: 'result_not_available',
    });
  });

  it('fails sensitive legacy records and unsupported policy versions closed', () => {
    const common = {
      verified_principal: principal('buyer-1'),
      result_resource: resource(),
      subject_binding: null,
      confidentiality_class: 'BUYER_AUTHORIZED' as const,
      delegation_evidence: null,
      binding_policy_version: null,
      revoked_subject_refs: [] as string[],
      evaluated_at: NOW,
      subject_reference_key: { key: KEY, keyVersion: 'k1' },
    };
    expect(
      evaluateResultReleaseAuthorization({
        ...common,
        release_policy_version: 'result_release_policy.v1',
      }).decision
    ).toBe('LEGACY_UNBOUND');
    expect(
      evaluateResultReleaseAuthorization({
        ...common,
        release_policy_version: 'unsupported',
      }).decision
    ).toBe('POLICY_ERROR');
  });
});

describe('verified mTLS principal registry boundary', () => {
  it('maps only a Cloudflare-verified certificate through the governed registry', () => {
    const mapped = mapVerifiedMtlsPrincipal(
      {
        state: 'valid',
        identity: { fingerprintSha256: 'AA:BB', issuerDN: 'CN=SITEBORNE Test CA' },
      },
      [
        {
          issuer_dn: 'CN=SITEBORNE Test CA',
          certificate_sha256: 'aabb',
          issuer: 'siteborne:mtls:workloads',
          subject_id: 'workload-1',
          subject_type: 'workload',
          assurance_level: 'cryptographic_workload',
        },
      ],
      NOW
    );
    expect(mapped?.subject.subject_id).toBe('workload-1');
    expect(mapped?.subject.authentication_method).toBe('mtls');
    expect(
      mapVerifiedMtlsPrincipal(
        {
          state: 'valid',
          identity: { fingerprintSha256: 'CC:DD', issuerDN: 'CN=SITEBORNE Test CA' },
        },
        [],
        NOW
      )
    ).toBeNull();
  });
});

describe('buyer-authorized REST boundary', () => {
  it('authenticates before parsing input, minting a quote, or looking up a result', async () => {
    const app = new Hono();
    createX402ServiceRoute(app, {
      serviceId: 'verify_agent_output.v3',
      scheme: 'exact',
      pricingKey: 'verify_agent_output_standard',
      network: 'eip155:84532',
      asset: '0x0000000000000000000000000000000000000001',
      path: '/v3/agent/verify',
      inputSchema: { type: 'object' },
      inputValidator: Object.assign(() => true, { errors: null }) as never,
      contractRelease: '3.0.0',
      inputSchemaHash: `sha256:${'1'.repeat(64)}`,
      outputSchemaHash: `sha256:${'2'.repeat(64)}`,
      pccDependency: '2.0.0',
      db: {} as never,
      clock: () => NOW,
      evidenceMode: 'fixture',
      executor: async () => ({ result: { result_class: 'success' } }),
      resultAuthorization: {
        authenticate: async () => null,
        subjectReferenceKey: { key: KEY, keyVersion: 'k1' },
        revokedSubjectRefs: async () => [],
      },
    });
    const response = await app.request('/v3/agent/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User': 'buyer-1',
        'X-Principal': 'buyer-1',
      },
      body: 'not-json',
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'authentication_required' });
  });
});

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function jwt(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  claims: Record<string, unknown>,
  algorithm: 'RS256' | 'none' = 'RS256'
): string {
  const encodedHeader = base64url(JSON.stringify({ alg: algorithm, kid: 'oidc-k1', typ: 'JWT' }));
  const encodedClaims = base64url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature =
    algorithm === 'none'
      ? ''
      : base64url(sign('RSA-SHA256', Buffer.from(signingInput), privateKey));
  return `${signingInput}.${signature}`;
}

describe('OIDC JWT principal verifier', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = keys.publicKey.export({ format: 'jwk' });
  const config: OidcIssuerConfiguration = {
    issuer: 'https://identity.siteborne.test',
    audience: 'siteborne-result-release',
    allowed_algorithms: ['RS256'],
    keys: [{ ...publicJwk, kid: 'oidc-k1', alg: 'RS256', use: 'sig' }],
    subject_type: 'human',
    assurance_level: 'verified_single_factor',
  };
  const claims = {
    iss: config.issuer,
    aud: config.audience,
    sub: 'buyer-1',
    iat: 1_795_000_000,
    nbf: 1_795_000_000,
    exp: 1_795_000_600,
  };
  const verify = createOidcPrincipalVerifier([config], () => 1_795_000_100);

  it('accepts a configured signed owner token and never returns the raw token', async () => {
    const result = await verify(jwt(keys.privateKey, claims));
    expect(result.status).toBe('VERIFIED');
    if (result.status === 'VERIFIED') {
      expect(result.principal.subject.subject_id).toBe('buyer-1');
      expect(JSON.stringify(result.principal)).not.toContain(jwt(keys.privateKey, claims));
    }
  });

  it.each([
    [
      'wrong issuer',
      { ...claims, iss: 'https://attacker.invalid' },
      keys.privateKey,
      'UNTRUSTED_ISSUER',
    ],
    ['wrong audience', { ...claims, aud: 'other-service' }, keys.privateKey, 'AUDIENCE_MISMATCH'],
    ['expired', { ...claims, exp: 1_795_000_099 }, keys.privateKey, 'TOKEN_EXPIRED'],
    ['not active', { ...claims, nbf: 1_795_000_101 }, keys.privateKey, 'TOKEN_NOT_ACTIVE'],
    ['issued in future', { ...claims, iat: 1_795_000_101 }, keys.privateKey, 'TOKEN_NOT_ACTIVE'],
    ['malformed not-before', { ...claims, nbf: '1795000101' }, keys.privateKey, 'MALFORMED'],
    ['malformed issued-at', { ...claims, iat: '1795000101' }, keys.privateKey, 'MALFORMED'],
    ['bad signature', claims, otherKeys.privateKey, 'INVALID_SIGNATURE'],
  ])('rejects %s', async (_name, tokenClaims, signingKey, reason) => {
    expect(await verify(jwt(signingKey, tokenClaims))).toMatchObject({
      status: 'REJECTED',
      reason,
    });
  });

  it('rejects unsigned and malformed JWTs', async () => {
    expect(await verify(jwt(keys.privateKey, claims, 'none'))).toMatchObject({
      status: 'REJECTED',
      reason: 'ALGORITHM_NOT_ALLOWED',
    });
    expect(await verify('not-a-jwt')).toMatchObject({ status: 'REJECTED', reason: 'MALFORMED' });
  });

  it('keeps the reference derivation independent of payer evidence', () => {
    const expected = createHmac('sha256', KEY)
      .update(
        JSON.stringify({
          domain: 'siteborne.subject_digest.v1',
          key_version: 'k1',
          subject_type: 'authenticated_caller_subject',
          value: `principal:${createHmac('sha256', KEY)
            .update('https://identity.siteborne.test\0human\0buyer-1')
            .digest('hex')}`,
        })
      )
      .digest('hex');
    const actual = canonicalSubjectReference(subject('buyer-1'), { key: KEY, keyVersion: 'k1' });
    expect(actual).toMatch(/^k1:[a-f0-9]{64}$/);
    expect(actual).not.toContain(expected);
    expect(actual).not.toContain('wallet');
  });
});
