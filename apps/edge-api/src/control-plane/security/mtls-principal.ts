import type { MtlsCallerContext } from './mtls-caller-context';
import type {
  ResultAssuranceLevel,
  ResultSubjectType,
  VerifiedPrincipalEvidence,
} from './result-authorization';
import { normalizeResultSubject } from './result-authorization';

/**
 * Registry record binding one Cloudflare-verified client certificate to a
 * durable SITEBORNE principal. Authority is `issuer_ski` (Subject Key
 * Identifier of the direct issuer) AND the exact leaf `certificate_sha256`.
 * Neither value participates in the durable principal identity
 * (`issuer` + `subject_id` + `subject_type`), so a rotated certificate that
 * maps to the same principal preserves result ownership.
 */
export interface MtlsPrincipalRegistryRecord {
  readonly issuer_ski: string;
  readonly certificate_sha256: string;
  readonly issuer: string;
  readonly subject_id: string;
  readonly subject_type: Extract<ResultSubjectType, 'workload' | 'service_account' | 'agent'>;
  readonly assurance_level: Extract<ResultAssuranceLevel, 'cryptographic_workload'>;
}

const SUBJECT_TYPES: ReadonlySet<string> = new Set(['workload', 'service_account', 'agent']);

/** Uppercase hex with `:`/whitespace separators removed; `null` if malformed. */
export function normalizeIssuerSki(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[:\s]/gu, '').toUpperCase();
  if (!/^[0-9A-F]{32,128}$/u.test(normalized) || normalized.length % 2 !== 0) return null;
  return normalized;
}

/** Lowercase hex with separators removed; `null` unless exactly 32 bytes. */
export function normalizeCertificateSha256(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[:\s]/gu, '').toLowerCase();
  return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Strict ingestion validation. Fails closed: any malformed record, or two
 * records binding the same issuer_ski + certificate_sha256 to different
 * durable principals, rejects the whole configuration.
 */
export function validateMtlsPrincipalRegistry(
  records: readonly unknown[]
): readonly MtlsPrincipalRegistryRecord[] {
  const bindings = new Map<string, string>();
  for (const raw of records) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('result_auth_mtls_registry_record_invalid');
    }
    const record = raw as Record<string, unknown>;
    const ski = normalizeIssuerSki(record.issuer_ski);
    if (ski === null) throw new Error('result_auth_mtls_registry_issuer_ski_invalid');
    const sha = normalizeCertificateSha256(record.certificate_sha256);
    if (sha === null) throw new Error('result_auth_mtls_registry_certificate_sha256_invalid');
    if (!nonEmpty(record.issuer)) throw new Error('result_auth_mtls_registry_issuer_invalid');
    if (!nonEmpty(record.subject_id)) {
      throw new Error('result_auth_mtls_registry_subject_id_invalid');
    }
    if (typeof record.subject_type !== 'string' || !SUBJECT_TYPES.has(record.subject_type)) {
      throw new Error('result_auth_mtls_registry_subject_type_invalid');
    }
    if (record.assurance_level !== 'cryptographic_workload') {
      throw new Error('result_auth_mtls_registry_assurance_level_invalid');
    }
    const principal = JSON.stringify([record.issuer, record.subject_id, record.subject_type]);
    const key = `${ski}:${sha}`;
    const existing = bindings.get(key);
    if (existing !== undefined && existing !== principal) {
      throw new Error('result_auth_mtls_registry_conflicting_binding');
    }
    bindings.set(key, principal);
  }
  return records as readonly MtlsPrincipalRegistryRecord[];
}

export function mapVerifiedMtlsPrincipal(
  context: MtlsCallerContext,
  registry: readonly MtlsPrincipalRegistryRecord[],
  authenticatedAt: string
): VerifiedPrincipalEvidence | null {
  if (context.state !== 'valid' || !context.identity) return null;
  const fingerprint = normalizeCertificateSha256(context.identity.fingerprintSha256);
  const issuerSki = normalizeIssuerSki(context.identity.issuerSKI);
  if (fingerprint === null || issuerSki === null) return null;
  const record = registry.find(
    (candidate) =>
      normalizeIssuerSki(candidate.issuer_ski) === issuerSki &&
      normalizeCertificateSha256(candidate.certificate_sha256) === fingerprint
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
