/**
 * AVUF / Jev / RAVI-P readiness map (R3-A4 Phase 11). Declares which
 * Evidence Graph fields a future provider-qualification or scoring engine
 * may consume, and from which node type. No scoring is implemented here;
 * any score produced from these fields is advisory (see firewall.ts).
 */
import type { NodeType } from './constitution';

export interface EvidenceFieldSpec {
  readonly field: string;
  readonly node_type: NodeType;
  readonly description: string;
}

export const RAVI_P_REQUIRED_EVIDENCE_FIELDS: readonly EvidenceFieldSpec[] = Object.freeze([
  { field: 'provider_id', node_type: 'Provider', description: 'stable provider identity' },
  {
    field: 'contract_key',
    node_type: 'Contract',
    description: 'service/contract identity incl. version',
  },
  {
    field: 'contract_class',
    node_type: 'Contract',
    description: 'contract class used for grouping',
  },
  { field: 'environment', node_type: 'Execution', description: 'production/staging/local' },
  {
    field: 'platform_version_id',
    node_type: 'Version',
    description: 'code version that executed (via EXECUTED_UNDER)',
  },
  { field: 'latency_ms', node_type: 'ProviderAttempt', description: 'provider call latency' },
  { field: 'quality_outcome', node_type: 'Assurance', description: 'verification/quality result' },
  { field: 'failure_class', node_type: 'Failure', description: 'normalized failure class' },
  {
    field: 'policy_fit',
    node_type: 'PolicyDecision',
    description: 'policy evaluation outcome (mirror)',
  },
  { field: 'assurance_result', node_type: 'Assurance', description: 'assurance verdict' },
  { field: 'pcc_available', node_type: 'PCC', description: 'a PCC exists for the attempt' },
  { field: 'economic_cost_atomic', node_type: 'EconomicOutcome', description: 'price charged' },
  {
    field: 'normalized_cogs',
    node_type: 'EconomicOutcome',
    description: 'normalized cost of goods sold',
  },
  { field: 'cash_cogs', node_type: 'EconomicOutcome', description: 'cash cost of goods sold' },
  {
    field: 'credit_benefit',
    node_type: 'EconomicOutcome',
    description: 'provider credit consumed/benefit',
  },
  {
    field: 'settlement_outcome',
    node_type: 'Settlement',
    description: 'settled/settlement_failed/ambiguous (mirror)',
  },
  {
    field: 'reconciliation_outcome',
    node_type: 'Reconciliation',
    description: 'reconciliation classification',
  },
  {
    field: 'provenance_chain_status',
    node_type: 'Deployment',
    description: 'COMPLETE_*/PARTIAL/UNKNOWN of the executing deployment',
  },
] as const);

/**
 * R3-57A: what the system can supply today, per field. Honest, not aspirational:
 *  CAPTURED  a writer persists it as evidence now
 *  DERIVABLE recoverable from existing control-plane tables/records, not yet written as evidence
 *  PLANNED   a durable place exists or is designed, but no writer populates it
 *  ABSENT    neither captured nor recoverable
 * No routing or scoring consumes these. Any score built on them is advisory.
 */
export type RaviPAvailability = 'CAPTURED' | 'DERIVABLE' | 'PLANNED' | 'ABSENT';

export const RAVI_P_FIELD_AVAILABILITY: Readonly<Record<string, RaviPAvailability>> = Object.freeze({
  provider_id: 'PLANNED',
  contract_key: 'DERIVABLE', // service id/version on job and payment rows
  contract_class: 'PLANNED',
  environment: 'CAPTURED', // every evidence node carries it
  platform_version_id: 'CAPTURED', // runtime observation + deployment records
  latency_ms: 'ABSENT',
  quality_outcome: 'DERIVABLE', // PCC verification result
  failure_class: 'DERIVABLE', // job state-event reason codes
  policy_fit: 'ABSENT',
  assurance_result: 'DERIVABLE',
  pcc_available: 'DERIVABLE',
  economic_cost_atomic: 'DERIVABLE', // price charged: payment_attempts.amount / settlement evidence
  normalized_cogs: 'PLANNED', // migration 0016 ledger (no runtime writer), provider cost not exposed by any executor
  cash_cogs: 'PLANNED',
  credit_benefit: 'PLANNED', // only derivable once both operands are observed
  settlement_outcome: 'DERIVABLE',
  reconciliation_outcome: 'DERIVABLE',
  provenance_chain_status: 'CAPTURED',
});
