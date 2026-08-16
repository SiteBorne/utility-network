import type { SiteborneServiceId } from '@siteborne/protocol-x402';

export interface NeverminedRegistrationAuditEntry {
  service_id: SiteborneServiceId;
  reconciliation: string;
  matching_agent_count: number;
  matching_plan_count: number;
}

export type NeverminedRegistrationCompleteness =
  | { valid: true }
  | {
      valid: false;
      reason: string;
      service_id?: SiteborneServiceId;
    };

const CANONICAL_NEVERMINED_SERVICES = new Set<SiteborneServiceId>([
  'company_evidence_graph.v1',
  'web_context_verified.v1',
  'document_evidence_json.v1',
  'verify_agent_output.v1',
]);

export function validateNeverminedRegistrationCompleteness(
  entries: readonly NeverminedRegistrationAuditEntry[]
): NeverminedRegistrationCompleteness {
  const serviceIds = new Set(entries.map((entry) => entry.service_id));
  if (
    entries.length !== CANONICAL_NEVERMINED_SERVICES.size ||
    serviceIds.size !== CANONICAL_NEVERMINED_SERVICES.size ||
    [...CANONICAL_NEVERMINED_SERVICES].some((serviceId) => !serviceIds.has(serviceId))
  ) {
    return { valid: false, reason: 'CANONICAL_SERVICE_SET_MISMATCH' };
  }

  for (const entry of entries) {
    if (entry.reconciliation !== 'EXACT_EXISTING') {
      return {
        valid: false,
        reason: 'REGISTRATION_NOT_EXACT',
        service_id: entry.service_id,
      };
    }
    if (
      !Number.isSafeInteger(entry.matching_agent_count) ||
      !Number.isSafeInteger(entry.matching_plan_count) ||
      entry.matching_agent_count < 0 ||
      entry.matching_plan_count < 0
    ) {
      return {
        valid: false,
        reason: 'MALFORMED_REGISTRATION_CARDINALITY',
        service_id: entry.service_id,
      };
    }
    if (entry.matching_agent_count > 1 || entry.matching_plan_count > 1) {
      return {
        valid: false,
        reason: 'DUPLICATE_CANONICAL_REGISTRATION',
        service_id: entry.service_id,
      };
    }
    if (entry.matching_agent_count !== 1 || entry.matching_plan_count !== 1) {
      return {
        valid: false,
        reason: 'CANONICAL_REGISTRATION_CARDINALITY_MISMATCH',
        service_id: entry.service_id,
      };
    }
  }

  return { valid: true };
}
