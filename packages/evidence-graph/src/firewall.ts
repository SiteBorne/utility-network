/**
 * Evidence -> authority firewall (R3-A4 Phase 6).
 *
 * Invariants:
 *  F1. Every edge in EDGE_CONSTITUTION is non-authoritative and grants no
 *      execution, result, or settlement authority.
 *  F2. Graph nodes carry `authority: 'NONE'`; any other value is rejected.
 *  F3. Node payloads may not carry grant-shaped or secret-shaped fields
 *      (permits, tokens, keys, passwords), so evidence can never be replayed
 *      as a credential.
 *  F4. Canonical authority modules (provider dispatch, payment/settlement,
 *      result authorization, owner recovery, artifact reclaim, paid routes,
 *      Worker entrypoints) must not import the evidence graph. Evidence may
 *      reach a decision only as an advisory input read by policy code that
 *      is itself reviewed; it is never on the authority path.
 *  F5. The evidence graph must not import control-plane runtime code, so it
 *      has no handle with which to dispatch, release, or settle.
 */
import { EDGE_CONSTITUTION, EDGE_TYPES } from './constitution';

export const AUTHORITY_KINDS = [
  'provider_dispatch',
  'buyer_authorization',
  'result_release',
  'settlement',
  'payment',
  'secret_access',
  'privilege_escalation',
] as const;
export type AuthorityKind = (typeof AUTHORITY_KINDS)[number];

/** Things evidence MAY inform, as advisory inputs to a separate decision. */
export const ADVISORY_USES = [
  'avuf_qualification',
  'routing',
  'risk_scoring',
  'provider_ranking',
  'assurance_requirements',
  'manual_review',
  'policy_input',
] as const;
export type AdvisoryUse = (typeof ADVISORY_USES)[number];

export class AuthorityFirewallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorityFirewallError';
  }
}

/** F1. Throws if any edge rule has acquired authority. */
export function assertConstitutionAuthorityNeutral(constitution = EDGE_CONSTITUTION): void {
  for (const type of EDGE_TYPES) {
    const r = constitution[type] as unknown as Record<string, unknown>;
    for (const flag of [
      'authoritative',
      'can_grant_execution_authority',
      'can_grant_result_authority',
      'can_grant_settlement_authority',
    ]) {
      if (r[flag] !== false)
        throw new AuthorityFirewallError(`edge ${type} has ${flag}=${String(r[flag])}`);
    }
  }
}

/** F3. Field names that would turn evidence into a credential or a grant. */
const FORBIDDEN_PAYLOAD_KEY_RE =
  /(^|_)(permit|grant|token|secret|password|private_?key|api_?key|signature_?key|bearer|credential|authorization_header)s?($|_)/i;

export function findForbiddenPayloadKeys(payload: unknown, path = '$'): string[] {
  if (payload === null || typeof payload !== 'object') return [];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (FORBIDDEN_PAYLOAD_KEY_RE.test(k)) hits.push(`${path}.${k}`);
    hits.push(...findForbiddenPayloadKeys(v, `${path}.${k}`));
  }
  return hits;
}

/** F4. Canonical authority modules, repo-relative. */
export const AUTHORITY_MODULES = [
  'apps/edge-api/src/index.ts',
  'apps/edge-api/src/workflow-host-entrypoint.ts',
  'apps/edge-api/src/control-plane/workflows/paid-continuation-workflow.ts',
  'apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts',
  'apps/edge-api/src/control-plane/repositories/d1/workflow-owner-intents.ts',
  'apps/edge-api/src/control-plane/security/result-authorization.ts',
  'apps/edge-api/src/control-plane/continuation/handoff.ts',
  'apps/edge-api/src/control-plane/continuation/owner-recovery.ts',
  'apps/edge-api/src/control-plane/continuation/settlement-reconciliation.ts',
  'apps/edge-api/src/control-plane/config/production-payment.ts',
  'apps/edge-api/src/control-plane/routes/x402-service.ts',
  'apps/edge-api/src/control-plane/artifacts/artifact-reclamation.ts',
] as const;

const IMPORT_SPEC_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function importSpecifiers(sourceText: string): string[] {
  const out: string[] = [];
  for (const m of sourceText.matchAll(IMPORT_SPEC_RE)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function importsEvidenceGraph(sourceText: string): boolean {
  return importSpecifiers(sourceText).some(
    (s) =>
      s === '@siteborne/evidence-graph' ||
      s.startsWith('@siteborne/evidence-graph/') ||
      /(^|\/)evidence-graph(\/|$)/.test(s)
  );
}

/** F5. The graph may not import runtime/control-plane or payment code. */
export function importsControlPlane(sourceText: string): boolean {
  return importSpecifiers(sourceText).some(
    (s) =>
      /(^|\/)apps\/edge-api(\/|$)/.test(s) ||
      /(^|\/)control-plane(\/|$)/.test(s) ||
      /^@siteborne\/(protocol-x402|protocol-nevermined|service-runtime|provider-adapters)/.test(
        s
      ) ||
      s === 'cloudflare:workers'
  );
}
