import { createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import type {
  ResultAssuranceLevel,
  ResultSubjectType,
  VerifiedPrincipalEvidence,
} from './result-authorization';
import { normalizeResultSubject } from './result-authorization';

export interface OidcIssuerConfiguration {
  readonly issuer: string;
  readonly audience: string;
  readonly allowed_algorithms: readonly 'RS256'[];
  readonly keys: readonly (JsonWebKey & {
    readonly kid: string;
    readonly alg: 'RS256';
    readonly use?: 'sig';
  })[];
  readonly subject_type: ResultSubjectType;
  readonly assurance_level: ResultAssuranceLevel;
}

export type OidcVerificationResult =
  | { readonly status: 'VERIFIED'; readonly principal: VerifiedPrincipalEvidence }
  | {
      readonly status: 'REJECTED';
      readonly principal: null;
      readonly reason:
        | 'MALFORMED'
        | 'ALGORITHM_NOT_ALLOWED'
        | 'UNTRUSTED_ISSUER'
        | 'AUDIENCE_MISMATCH'
        | 'SUBJECT_REQUIRED'
        | 'TOKEN_EXPIRED'
        | 'TOKEN_NOT_ACTIVE'
        | 'INVALID_SIGNATURE';
    };

function rejected(
  reason: Exclude<OidcVerificationResult, { status: 'VERIFIED' }>['reason']
): OidcVerificationResult {
  return { status: 'REJECTED', principal: null, reason };
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createOidcPrincipalVerifier(
  configurations: readonly OidcIssuerConfiguration[],
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000)
): (rawJwt: string) => Promise<OidcVerificationResult> {
  const byIssuer = new Map(
    configurations.map((configuration) => [configuration.issuer, configuration])
  );
  return async (rawJwt) => {
    const segments = rawJwt.split('.');
    if (segments.length !== 3 || segments.some((segment, index) => index < 2 && !segment)) {
      return rejected('MALFORMED');
    }
    const header = decodeJson(segments[0]);
    const claims = decodeJson(segments[1]);
    if (!header || !claims) return rejected('MALFORMED');
    if (header.alg !== 'RS256') return rejected('ALGORITHM_NOT_ALLOWED');
    const issuer = typeof claims.iss === 'string' ? claims.iss : '';
    const configuration = byIssuer.get(issuer);
    if (!configuration) return rejected('UNTRUSTED_ISSUER');
    if (!configuration.allowed_algorithms.includes('RS256'))
      return rejected('ALGORITHM_NOT_ALLOWED');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(configuration.audience)) return rejected('AUDIENCE_MISMATCH');
    if (typeof claims.sub !== 'string' || !claims.sub.trim()) return rejected('SUBJECT_REQUIRED');
    const now = nowSeconds();
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || now >= claims.exp)
      return rejected('TOKEN_EXPIRED');
    if (
      claims.nbf !== undefined &&
      (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf))
    )
      return rejected('MALFORMED');
    if (
      claims.iat !== undefined &&
      (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat))
    )
      return rejected('MALFORMED');
    if (typeof claims.nbf === 'number' && now < claims.nbf) return rejected('TOKEN_NOT_ACTIVE');
    if (typeof claims.iat === 'number' && now < claims.iat) return rejected('TOKEN_NOT_ACTIVE');
    const key = configuration.keys.find(
      (candidate) =>
        candidate.kid === header.kid &&
        candidate.alg === header.alg &&
        (candidate.use === undefined || candidate.use === 'sig')
    );
    if (!key) return rejected('INVALID_SIGNATURE');
    let valid = false;
    try {
      valid = verifySignature(
        'RSA-SHA256',
        Buffer.from(`${segments[0]}.${segments[1]}`),
        createPublicKey({ key, format: 'jwk' }),
        Buffer.from(segments[2], 'base64url')
      );
    } catch {
      valid = false;
    }
    if (!valid) return rejected('INVALID_SIGNATURE');
    const authenticatedAt =
      typeof claims.iat === 'number'
        ? new Date(claims.iat * 1000).toISOString()
        : new Date(now * 1000).toISOString();
    return {
      status: 'VERIFIED',
      principal: Object.freeze({
        verification_status: 'VERIFIED',
        evidence_type: 'cryptographically_authenticated',
        verifier_id: 'siteborne.identity-evidence-verifier.v1',
        subject: normalizeResultSubject({
          schema_version: 'result_subject.v1',
          subject_type: configuration.subject_type,
          issuer: configuration.issuer,
          subject_id: claims.sub,
          authentication_method: 'oidc',
          assurance_level: configuration.assurance_level,
          authenticated_at: authenticatedAt,
          credential_binding: null,
        }),
      }),
    };
  };
}
