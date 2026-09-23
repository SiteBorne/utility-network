import type { MtlsCallerContext } from './mtls-caller-context';
import type {
  ResultAssuranceLevel,
  ResultSubjectType,
  VerifiedPrincipalEvidence,
} from './result-authorization';
import { normalizeResultSubject } from './result-authorization';

export interface MtlsPrincipalRegistryRecord {
  readonly issuer_dn: string;
  readonly certificate_sha256: string;
  readonly issuer: string;
  readonly subject_id: string;
  readonly subject_type: Extract<ResultSubjectType, 'workload' | 'service_account' | 'agent'>;
  readonly assurance_level: Extract<ResultAssuranceLevel, 'cryptographic_workload'>;
}

function normalizeFingerprint(value: string): string {
  return value.replace(/:/gu, '').toLowerCase();
}

export function mapVerifiedMtlsPrincipal(
  context: MtlsCallerContext,
  registry: readonly MtlsPrincipalRegistryRecord[],
  authenticatedAt: string
): VerifiedPrincipalEvidence | null {
  if (context.state !== 'valid' || !context.identity) return null;
  const fingerprint = normalizeFingerprint(context.identity.fingerprintSha256);
  const record = registry.find(
    (candidate) =>
      candidate.issuer_dn === context.identity!.issuerDN &&
      normalizeFingerprint(candidate.certificate_sha256) === fingerprint
  );
  if (!record) return null;
  return Object.freeze({
    verification_status: 'VERIFIED',
    evidence_type: 'cryptographically_authenticated',
    verifier_id: 'siteborne.identity-evidence-verifier.v1',
    subject: normalizeResultSubject({
      schema_version: 'result_subject.v1',
      subject_type: record.subject_type,
      issuer: record.issuer,
      subject_id: record.subject_id,
      authentication_method: 'mtls',
      assurance_level: record.assurance_level,
      authenticated_at: new Date(authenticatedAt).toISOString(),
      credential_binding: Object.freeze({
        kind: 'certificate_sha256',
        value: fingerprint,
      }),
    }),
  });
}
