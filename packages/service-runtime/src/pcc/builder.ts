/**
 * Deterministic PCC document builder — the single place every service
 * assembles a PCC 1.0.0 document (directive §7). No service hand-builds
 * PCC differently; each service supplies its subject/claims/evidence/
 * completeness/extension payload and this module fills in the rest
 * (contract envelope, provenance skeleton, and schema-shape-valid
 * placeholder verification/receipt blocks that verify-and-sign.ts later
 * replaces with the real mesh verdict and signed receipt).
 */
import { deterministicId } from './ids';
import type {
  ContractMode,
  PccClaim,
  PccCompleteness,
  PccDocument,
  PccEvidenceItem,
  PccProvenance,
  PccSubject,
} from './document-types';

export interface BuildDraftDocumentParams<TExtensionKey extends string, TExtension> {
  seed: string; // deterministic seed for job_id, e.g. `${service_id}:${input_hash}`
  serviceId: string;
  // SUN-1000 checkpoint 1M: widened from the literal 'v1' — a v2 service
  // genuinely builds a 'v2' contract.
  serviceVersion: 'v1' | 'v2' | 'v3';
  inputHash: string;
  inputSchemaHash: string;
  outputSchemaHash: string;
  contractMode: ContractMode;
  price?: string;
  freshnessSeconds: number;
  issuedAtIso: string;
  expiresAtIso: string;
  minimumQuality?: number;
  subject: PccSubject;
  claims: PccClaim[];
  evidence: PccEvidenceItem[];
  completeness: PccCompleteness;
  provenance: PccProvenance;
  extensionKey: TExtensionKey;
  extensionPayload: TExtension;
}

const PLACEHOLDER_SIGNATURE = 'A'.repeat(86);
const PLACEHOLDER_HASH = 'sha256:' + '0'.repeat(64);

/**
 * Validates the invariants directive §7 requires the builder to enforce
 * before returning a document: no duplicate evidence IDs, every claim's
 * evidence_ids resolve to a real evidence item.
 */
export function validateClaimEvidenceInvariants(
  claims: PccClaim[],
  evidence: PccEvidenceItem[]
): void {
  const evidenceIds = new Set<string>();
  for (const item of evidence) {
    if (evidenceIds.has(item.evidence_id)) {
      throw new Error(`duplicate evidence_id: ${item.evidence_id}`);
    }
    evidenceIds.add(item.evidence_id);
  }
  for (const claim of claims) {
    for (const evidenceId of claim.evidence_ids) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`claim ${claim.claim_id} references unknown evidence_id ${evidenceId}`);
      }
    }
  }
}

export function buildDraftDocument<TExtensionKey extends string, TExtension>(
  params: BuildDraftDocumentParams<TExtensionKey, TExtension>
): PccDocument<TExtensionKey, TExtension> {
  validateClaimEvidenceInvariants(params.claims, params.evidence);

  const jobId = deterministicId('job', params.seed);
  const quoteId = 'qte_' + deterministicId('req', `quote:${params.seed}`).slice(4);
  const idempotencyKey = 'idk_' + deterministicId('req', `idem:${params.seed}`).slice(4);
  const policyId = deterministicId('pol', `policy:${params.seed}`);
  const keyId = deterministicId('kid', `key:${params.seed}`);

  return {
    pcc_version: params.serviceVersion === 'v3' ? '2.0.0' : '1.0.0',
    job_id: jobId,
    contract: {
      service_id: params.serviceId,
      service_version: params.serviceVersion,
      input_hash: params.inputHash,
      input_schema_hash: params.inputSchemaHash,
      output_schema_hash: params.outputSchemaHash,
      quote_id: quoteId,
      price: params.price,
      mode: params.contractMode,
      currency: 'USD',
      minimum_quality: params.minimumQuality ?? 0.8,
      freshness_seconds: params.freshnessSeconds,
      issued_at: params.issuedAtIso,
      expires_at: params.expiresAtIso,
      idempotency_key: idempotencyKey,
    },
    subject: params.subject,
    claims: params.claims,
    evidence: params.evidence,
    completeness: params.completeness,
    provenance: params.provenance,
    verification: {
      schema_valid: false,
      material_claims_supported: false,
      evidence_accessibility: 0,
      freshness: 0,
      completeness: 0,
      cross_source_agreement: 0,
      provenance_valid: false,
      prompt_injection_result: { checked: false, result: 'clean' },
      deterministic_failures: [],
      verifier_versions: {},
      policy: policyId,
      decision: 'fail',
      score: 0,
      failed_requirements: [],
    },
    receipt: {
      output_hash: PLACEHOLDER_HASH,
      canonicalization_algorithm: 'RFC8785-JCS',
      policy_hash: PLACEHOLDER_HASH,
      schema_hash: PLACEHOLDER_HASH,
      signature_algorithm: 'Ed25519',
      signing_key_id: keyId,
      signature: PLACEHOLDER_SIGNATURE,
      signed_at: params.issuedAtIso,
    },
    extensions: { [params.extensionKey]: params.extensionPayload } as {
      [K in TExtensionKey]: TExtension;
    },
  };
}

export function defaultProvenance(providerName: string, providerVersion: string): PccProvenance {
  return {
    routes: [{ type: 'direct', provider: providerName, version: providerVersion }],
    providers: [{ name: providerName, version: providerVersion, capabilities: [] }],
    tools: {},
    models: [],
    software_versions: { 'service-runtime': '0.1.0' },
    policy_versions: { verification: '1.0.0' },
    transformations: [],
    cache_provenance: { enabled: false, hit: false },
    execution_environment: {
      runtime: 'node',
      version: process.version,
      platform: process.platform,
    },
    verification_routes: [],
  };
}
