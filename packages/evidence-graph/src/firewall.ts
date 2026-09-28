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

// ---------------------------------------------------------------------------
// R3-A4-55: runtime observation and release capture boundaries.
//
//  F6. The platform version-metadata binding (CF_VERSION_METADATA) is read
//      only by the runtime observation module, the Env type and the health
//      route. No authority module reads it, so a version id can never gate
//      provider dispatch, result release, settlement or payment.
//  F7. Authority modules may reach the observation module only through the
//      void, non-throwing emitter (`emitRuntimeVersionEvent`); never through
//      a function that returns the report.
//  F8. The runtime observation module imports nothing.
//  F9. Release capture tooling issues no mutating HTTP method and imports no
//      control-plane, payment or runtime code, so it cannot mint payment,
//      result or settlement authority.
// ---------------------------------------------------------------------------

export const RUNTIME_OBSERVATION_MODULE = 'apps/edge-api/src/runtime-observation.ts';

export const VERSION_METADATA_READERS = [
  RUNTIME_OBSERVATION_MODULE,
  'apps/edge-api/src/control-plane/config/env.ts',
  'apps/edge-api/src/routes/health.ts',
] as const;

export interface BoundaryViolation {
  readonly rule: 'F6' | 'F7' | 'F8' | 'F9';
  readonly file: string;
  readonly detail: string;
}

/** F6-F8 over a set of runtime source files (path relative to repo root -> text). */
export function checkRuntimeObservationBoundary(
  files: ReadonlyMap<string, string>
): BoundaryViolation[] {
  const out: BoundaryViolation[] = [];
  for (const [file, text] of files) {
    if (
      text.includes('CF_VERSION_METADATA') &&
      !(VERSION_METADATA_READERS as readonly string[]).includes(file)
    ) {
      out.push({
        rule: 'F6',
        file,
        detail: 'reads CF_VERSION_METADATA outside the observation surface',
      });
    }
    if ((AUTHORITY_MODULES as readonly string[]).includes(file)) {
      const observes = importSpecifiers(text).some((s) => /(^|\/)runtime-observation$/.test(s));
      const returningUse = /\b(runtimeVersionReport|RuntimeVersionReport)\b/.test(text);
      if (observes && returningUse) {
        out.push({ rule: 'F7', file, detail: 'authority module uses the returning report API' });
      }
    }
    if (file === RUNTIME_OBSERVATION_MODULE && importSpecifiers(text).length > 0) {
      out.push({ rule: 'F8', file, detail: 'observation module must import nothing' });
    }
  }
  return out;
}

const MUTATING_HTTP_RE = /method\s*:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i;
/** Wrangler subcommands that mutate Cloudflare state when passed as argv tokens. */
const MUTATING_WRANGLER_TOKENS_RE =
  /['"`](versions|secret|triggers|execute|migrations|rollback|delete|put)['"`]/;
/** A `deploy` argv token is allowed only inside an argv array that also says --dry-run. */
function hasNonDryRunDeploy(text: string): boolean {
  for (const m of text.matchAll(/\[[^\]]*['"`]deploy['"`][^\]]*\]/g)) {
    if (!m[0].includes("'--dry-run'") && !m[0].includes('"--dry-run"')) return true;
  }
  return false;
}

/** F9 over release capture tooling source. */
export function checkReleaseCaptureBoundary(file: string, text: string): BoundaryViolation[] {
  const out: BoundaryViolation[] = [];
  if (MUTATING_HTTP_RE.test(text)) {
    out.push({ rule: 'F9', file, detail: 'issues a mutating HTTP method' });
  }
  if (MUTATING_WRANGLER_TOKENS_RE.test(text) || hasNonDryRunDeploy(text)) {
    out.push({ rule: 'F9', file, detail: 'invokes a mutating wrangler command' });
  }
  if (importsControlPlane(text)) {
    out.push({ rule: 'F9', file, detail: 'imports control-plane/payment/runtime code' });
  }
  return out;
}
