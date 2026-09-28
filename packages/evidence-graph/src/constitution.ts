/**
 * Evidence Graph constitution (R3-A4 Phase 4/6).
 *
 * The graph is a PROJECTION of evidence. It is never the authoritative
 * record of anything: provider dispatch authority stays the D1
 * `provider_dispatched_at` compare-and-set, result release stays
 * `result-authorization.ts`, settlement stays the payment-attempt stage
 * machine + `consumed_at` CAS, and deployment state stays Cloudflare.
 * Therefore every edge is `authoritative: false` and grants no execution,
 * result, or settlement authority. Changing any of these flags is a
 * constitutional change, and the firewall tests fail on it.
 */

export const NODE_TYPES = [
  'Contract',
  'Source',
  'Build',
  'Artifact',
  'Version',
  'Deployment',
  'RuntimeObservation',
  'Execution',
  'Provider',
  'ProviderAttempt',
  'Assurance',
  'PCC',
  'ResultAuthorization',
  'Settlement',
  'EconomicOutcome',
  'Failure',
  'Reconciliation',
  'PolicyDecision',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  'BUILT_FROM',
  'PRODUCED',
  'UPLOADED_AS',
  'DEPLOYED_AS',
  'OBSERVED_RUNNING',
  'EXECUTED_UNDER',
  'SATISFIES_CONTRACT',
  'ATTEMPT_OF',
  'PROVIDED_BY',
  'EVIDENCED_BY',
  'AUTHORIZED_BY',
  'RESULT_AUTHORIZED_BY',
  'SETTLED_BY',
  'RECONCILES',
  'SUPERSEDES',
  'FAILED_WITH',
  'DERIVED_FROM',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export interface EdgeRule {
  readonly from: readonly NodeType[];
  readonly to: readonly NodeType[];
  readonly semantics: string;
  /** The graph mirrors a canonical record held elsewhere; never itself authoritative. */
  readonly authoritative: false;
  readonly can_grant_execution_authority: false;
  readonly can_grant_result_authority: false;
  readonly can_grant_settlement_authority: false;
}

const neutral = {
  authoritative: false,
  can_grant_execution_authority: false,
  can_grant_result_authority: false,
  can_grant_settlement_authority: false,
} as const;

function rule(from: NodeType[], to: NodeType[], semantics: string): EdgeRule {
  return Object.freeze({ from: Object.freeze(from), to: Object.freeze(to), semantics, ...neutral });
}

export const EDGE_CONSTITUTION: Readonly<Record<EdgeType, EdgeRule>> = Object.freeze({
  BUILT_FROM: rule(['Build'], ['Source'], 'build was executed on exactly this source commit'),
  PRODUCED: rule(['Build'], ['Artifact'], 'build output bytes hash to this artifact digest'),
  UPLOADED_AS: rule(
    ['Artifact'],
    ['Version'],
    'platform-returned module bytes of this version hash to this artifact'
  ),
  DEPLOYED_AS: rule(
    ['Version'],
    ['Deployment'],
    'deployment routes a traffic share to this version'
  ),
  OBSERVED_RUNNING: rule(
    ['RuntimeObservation'],
    ['Deployment'],
    'deployment was observed active/running at observed_at'
  ),
  EXECUTED_UNDER: rule(
    ['Execution'],
    ['Deployment'],
    'execution ran on code served by this deployment'
  ),
  SATISFIES_CONTRACT: rule(
    ['Execution', 'Assurance'],
    ['Contract'],
    'claims conformance to this contract/service version'
  ),
  ATTEMPT_OF: rule(
    ['ProviderAttempt'],
    ['Execution'],
    'provider attempt was made on behalf of this execution'
  ),
  PROVIDED_BY: rule(['ProviderAttempt'], ['Provider'], 'attempt was served by this provider'),
  EVIDENCED_BY: rule(
    ['Execution', 'ProviderAttempt', 'Settlement'],
    ['PCC', 'Assurance'],
    'claim is supported by this evidence artifact'
  ),
  AUTHORIZED_BY: rule(
    ['Execution'],
    ['PolicyDecision'],
    'mirrors a control-plane decision that already existed; records, never grants'
  ),
  RESULT_AUTHORIZED_BY: rule(
    ['Execution'],
    ['ResultAuthorization'],
    'mirrors the canonical result-authorization row; records, never grants'
  ),
  SETTLED_BY: rule(
    ['Execution'],
    ['Settlement'],
    'mirrors the canonical settlement outcome; records, never grants'
  ),
  RECONCILES: rule(
    ['Reconciliation'],
    ['Execution', 'Settlement', 'Failure'],
    'reconciliation classified or resolved this node'
  ),
  SUPERSEDES: rule(
    [...NODE_TYPES],
    [...NODE_TYPES],
    'newer evidence replaces older evidence of the same type; old node is kept'
  ),
  FAILED_WITH: rule(
    ['Execution', 'ProviderAttempt', 'Settlement', 'Deployment'],
    ['Failure'],
    'node ended in this failure class'
  ),
  DERIVED_FROM: rule(
    ['PCC', 'EconomicOutcome', 'Assurance'],
    ['ProviderAttempt', 'Execution', 'Settlement'],
    'computed from this upstream evidence'
  ),
});

export function edgeAllowed(type: EdgeType, from: NodeType, to: NodeType): boolean {
  const r = EDGE_CONSTITUTION[type];
  if (!r) return false;
  if (type === 'SUPERSEDES' && from !== to) return false;
  return r.from.includes(from) && r.to.includes(to);
}
