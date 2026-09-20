/**
 * PRODUCTION-SECURITY-DECLARATIONS-01 -- canonical security-declaration
 * vocabulary.
 *
 * Two independent axes exist and are deliberately NOT merged:
 *
 *  - `SecurityTruthLevel` (types.ts, IMPLEMENTED/CONFIGURED/ACTIVE/VERIFIED):
 *    how strongly a mechanism's *activation* is evidenced. Static
 *    construction is capped at CONFIGURED (Authority Map §I.13).
 *  - `ImplementationStatus` (this file): whether the behavior is a current
 *    security *guarantee*, an observation, a direction, or absent.
 *
 * A declaration therefore states an implementation status per claim AND
 * carries a bundle-level truth-level ceiling; it never asserts ACTIVE.
 */

export const SECURITY_DECLARATION_SCHEMA_VERSION = 'security_declaration.v1' as const;
export type SecurityDeclarationSchemaVersion = typeof SECURITY_DECLARATION_SCHEMA_VERSION;

/** Schema versions this build understands. Anything else is denied. */
export const SUPPORTED_SECURITY_DECLARATION_SCHEMA_VERSIONS: readonly string[] = [
  SECURITY_DECLARATION_SCHEMA_VERSION,
];

/**
 * IMPLEMENTED_ENFORCED     production behavior exists and is a current guarantee.
 * IMPLEMENTED_OBSERVATIONAL implemented, not relied upon as authoritative enforcement.
 * DECLARED_FUTURE          architectural direction only; never a current guarantee.
 * UNSUPPORTED              not currently available.
 */
export const IMPLEMENTATION_STATUSES = [
  'IMPLEMENTED_ENFORCED',
  'IMPLEMENTED_OBSERVATIONAL',
  'DECLARED_FUTURE',
  'UNSUPPORTED',
] as const;
export type ImplementationStatus = (typeof IMPLEMENTATION_STATUSES)[number];

const RANK: Readonly<Record<ImplementationStatus, number>> = {
  UNSUPPORTED: 0,
  DECLARED_FUTURE: 1,
  IMPLEMENTED_OBSERVATIONAL: 2,
  IMPLEMENTED_ENFORCED: 3,
};

export function isImplementationStatus(value: unknown): value is ImplementationStatus {
  return (
    typeof value === 'string' && (IMPLEMENTATION_STATUSES as readonly string[]).includes(value)
  );
}

/** Total order: UNSUPPORTED < DECLARED_FUTURE < OBSERVATIONAL < ENFORCED. */
export function statusRank(status: ImplementationStatus): number {
  return RANK[status];
}

/** True when `candidate` claims no more than `ceiling` does. */
export function isNoStrongerThan(
  candidate: ImplementationStatus,
  ceiling: ImplementationStatus
): boolean {
  return RANK[candidate] <= RANK[ceiling];
}

/** The weaker of two statuses (projection may narrow, never broaden). */
export function narrowest(a: ImplementationStatus, b: ImplementationStatus): ImplementationStatus {
  return RANK[a] <= RANK[b] ? a : b;
}

/** Fail-closed coercion for public projection: an unrecognised status value
 * is treated as UNSUPPORTED, never as anything stronger. */
export function failClosedStatus(value: unknown): ImplementationStatus {
  return isImplementationStatus(value) ? value : 'UNSUPPORTED';
}

/** True only for statuses that may be described as a current guarantee. */
export function isCurrentGuarantee(status: ImplementationStatus): boolean {
  return status === 'IMPLEMENTED_ENFORCED';
}

/** Typed external-evidence semantic classes (declaration vocabulary). */
export const EVIDENCE_CLASSES = [
  'IDENTITY_PROOF',
  'POSSESSION_PROOF',
  'DELEGATION_MANDATE',
  'PLATFORM_AUTHZ_DECISION',
  'RISK_SIGNAL',
  'COMPLIANCE_ATTESTATION',
  'QUALIFICATION_SIGNAL',
  'PAYMENT_AUTHORIZATION',
  'PAYMENT_RECEIPT',
  'DELIVERY_EVIDENCE',
  'SETTLEMENT_EVIDENCE',
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export type ExecutionEffect = 'read_only' | 'reversible' | 'compensatable' | 'irreversible';
export type EconomicEffect =
  | 'none'
  | 'authorize'
  | 'reserve'
  | 'charge'
  | 'settle'
  | 'refund'
  | 'reverse';

/** Future domain-separated authority objects. Names only -- Release 1 does
 * not implement, encode, or depend on any of them. */
export const RESERVED_FUTURE_OBJECT_NAMES = [
  'OperationID',
  'AuthorityContextID',
  'PolicyEvaluationID',
  'AuthorityGrantID',
  'ExecutionLeaseID',
  'CommitGrantID',
  'ResultBindingID',
  'SettlementGrantID',
] as const;
