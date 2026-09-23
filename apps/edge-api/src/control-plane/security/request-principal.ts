import { deriveMtlsCallerContext } from './mtls-caller-context';
import { mapVerifiedMtlsPrincipal, type MtlsPrincipalRegistryRecord } from './mtls-principal';
import { createOidcPrincipalVerifier, type OidcIssuerConfiguration } from './oidc-principal';
import type { SubjectReferenceKey, VerifiedPrincipalEvidence } from './result-authorization';

export interface ResultPrincipalConfiguration {
  readonly oidcIssuers: readonly OidcIssuerConfiguration[];
  readonly mtlsRegistry: readonly MtlsPrincipalRegistryRecord[];
  readonly now?: () => string;
}

export interface ResultAuthorizationEnvironment {
  readonly RESULT_AUTH_OIDC_ISSUERS_JSON?: string;
  readonly RESULT_AUTH_MTLS_REGISTRY_JSON?: string;
  readonly RESULT_SUBJECT_REFERENCE_KEY?: string;
  readonly RESULT_SUBJECT_REFERENCE_KEY_VERSION?: string;
}

/** Transport-neutral verifier seam. Implementations may consume external
 * identity evidence, but authorization receives only this server-created,
 * verified principal result. */
export interface IdentityEvidenceVerifierV1 {
  verify(request: Request): Promise<VerifiedPrincipalEvidence | null>;
}

export async function authenticateResultPrincipal(
  request: Request,
  configuration: ResultPrincipalConfiguration
): Promise<VerifiedPrincipalEvidence | null> {
  const now = configuration.now?.() ?? new Date().toISOString();
  const authorization = request.headers.get('Authorization');
  if (authorization !== null) {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorization);
    if (!match) return null;
    const verifier = createOidcPrincipalVerifier(configuration.oidcIssuers, () =>
      Math.floor(new Date(now).getTime() / 1000)
    );
    const verification = await verifier(match[1]);
    return verification.status === 'VERIFIED' ? verification.principal : null;
  }
  const tlsClientAuth = (
    request as Request & { cf?: { tlsClientAuth?: Parameters<typeof deriveMtlsCallerContext>[0] } }
  ).cf?.tlsClientAuth;
  return mapVerifiedMtlsPrincipal(
    deriveMtlsCallerContext(tlsClientAuth),
    configuration.mtlsRegistry,
    now
  );
}

function parseArray<T>(value: string | undefined, name: string): readonly T[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name}_invalid_json`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${name}_must_be_array`);
  return parsed as readonly T[];
}

export function buildResultAuthorizationRuntime(
  environment: ResultAuthorizationEnvironment,
  revokedSubjectRefs: () => Promise<readonly string[]> = async () => []
): {
  readonly authenticate: (request: Request) => Promise<VerifiedPrincipalEvidence | null>;
  readonly subjectReferenceKey: SubjectReferenceKey;
  readonly revokedSubjectRefs: () => Promise<readonly string[]>;
} | null {
  const encodedKey = environment.RESULT_SUBJECT_REFERENCE_KEY;
  const keyVersion = environment.RESULT_SUBJECT_REFERENCE_KEY_VERSION;
  if (!encodedKey && !keyVersion) return null;
  if (!encodedKey || !keyVersion)
    throw new Error('result_subject_reference_key_partial_configuration');
  let key: Uint8Array;
  try {
    key = new Uint8Array(Buffer.from(encodedKey, 'base64url'));
  } catch {
    throw new Error('result_subject_reference_key_invalid');
  }
  if (key.byteLength < 32) throw new Error('result_subject_reference_key_too_short');
  const configuration: ResultPrincipalConfiguration = {
    oidcIssuers: parseArray<OidcIssuerConfiguration>(
      environment.RESULT_AUTH_OIDC_ISSUERS_JSON,
      'result_auth_oidc_issuers'
    ),
    mtlsRegistry: parseArray<MtlsPrincipalRegistryRecord>(
      environment.RESULT_AUTH_MTLS_REGISTRY_JSON,
      'result_auth_mtls_registry'
    ),
  };
  return {
    authenticate: (request) => authenticateResultPrincipal(request, configuration),
    subjectReferenceKey: { key, keyVersion },
    revokedSubjectRefs,
  };
}
