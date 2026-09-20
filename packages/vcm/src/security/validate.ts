/**
 * PRODUCTION-SECURITY-DECLARATIONS-01 -- contradiction validation.
 *
 * `validateSecurityDeclaration` returns every violation it finds; it never
 * throws and never repairs. Rules are structural (fields, enums, orderings)
 * plus one independent recomputation: purchasability is recomputed from the
 * governed economic contract, so a hand-edited binding cannot claim more than
 * governance admits.
 *
 * `RELEASE_1_STATUS_CEILINGS` is a deliberate second table. It is not a
 * duplicate of the declaration: it is a one-way ratchet that fails the build
 * if a feature's status is ever raised above what Release 1 can truthfully
 * claim. Raising a ceiling is a reviewed, explicit change.
 */
import { buildEconomicOffer, isEconomicServiceId } from '@siteborne/pricing';
import type {
  CapabilitySecurityBinding,
  SecurityDeclarationBundle,
  Statement,
} from './declaration';
import {
  IMPLEMENTATION_STATUSES,
  SUPPORTED_SECURITY_DECLARATION_SCHEMA_VERSIONS,
  isImplementationStatus,
  isNoStrongerThan,
  type ImplementationStatus,
} from './vocabulary';

export type SecurityViolationCode =
  | 'UNKNOWN_SCHEMA_VERSION'
  | 'UNKNOWN_STATUS'
  | 'UNKNOWN_VERSION_BEHAVIOR_NOT_DENY'
  | 'TRUTH_CEILING_EXCEEDED'
  | 'IDENTITY_FROM_EVIDENCE'
  | 'EVIDENCE_WIDENS_AUTHORITY'
  | 'RECEIPT_OR_PCC_AS_AUTHORITY'
  | 'STATUS_ABOVE_RELEASE_CEILING'
  | 'FUTURE_OR_UNSUPPORTED_EXERCISED'
  | 'CLOSED_CAPABILITY_ENABLED'
  | 'PURCHASABILITY_EXCEEDS_GOVERNANCE'
  | 'MISSING_REQUIRED_STATEMENT'
  | 'RETRIEVAL_CLAIM_UNPROVEN'
  | 'READ_ONLY_CONFLATED_WITH_NO_ECONOMIC_EFFECT'
  | 'RUNTIME_QUALIFICATION_OMITTED'
  | 'PRIVATE_FIELD_PROJECTED'
  | 'PROJECTION_EXCEEDS_CANONICAL'
  | 'SURFACE_PARITY_MISMATCH';

export interface SecurityViolation {
  readonly code: SecurityViolationCode;
  readonly path: string;
  readonly message: string;
}

const U: ImplementationStatus = 'UNSUPPORTED';
const F: ImplementationStatus = 'DECLARED_FUTURE';

/** Highest status Release 1 may claim for each negative-declaration feature. */
export const RELEASE_1_STATUS_CEILINGS: Readonly<Record<string, ImplementationStatus>> = {
  mtls: U,
  oauth: U,
  dpop: F,
  spiffe_svid: U,
  ap2: F,
  machine_payments_protocol: U,
  vcap: U,
  agentcore_policy: U,
  enterprise_workload_federation: U,
  interactive_login: U,
  custodial_wallet_operation: U,
  rendered_web_mode: U,
  independent_reproduction_mode: U,
  nevermined_paid_execution: U,
  company_evidence_graph_paid: U,
  document_evidence_paid: U,
  legacy_v1_paid_routes: U,
  public_result_retrieval: U,
  caller_bound_result_retrieval: U,
  automated_refund_or_reversal: U,
};

/** Statement ids whose absence would silently drop a constitutional claim. */
const REQUIRED_STATEMENT_IDS: readonly string[] = [
  'payment_not_identity',
  'pcc_is_evidence_not_permission',
  'evidence_does_not_grant_authority',
  'settlement_requires_controlled_lifecycle',
  'persisted_result_not_arbitrary_access',
  'malformed_required_state_fails_closed',
  'caller_bound_retrieval',
  'public_result_retrieval',
  'no_buyer_key_custody',
  'signed_authorization_retention',
];

/** Ids whose status can never exceed UNSUPPORTED in Release 1. */
const MUST_BE_UNSUPPORTED_IDS: readonly string[] = [
  'caller_bound_retrieval',
  'public_result_retrieval',
  'refund_reversal_automation',
  'runtime_self_check_absent',
];

const AUTHORITY_WORDS = /authority|permission|execution|commit|grant|authoriz/i;

export function isSupportedSecuritySchemaVersion(version: unknown): boolean {
  return (
    typeof version === 'string' &&
    (SUPPORTED_SECURITY_DECLARATION_SCHEMA_VERSIONS as readonly string[]).includes(version)
  );
}

function allStatements(b: SecurityDeclarationBundle): { section: string; item: Statement }[] {
  const out: { section: string; item: Statement }[] = [];
  const add = (section: string, list: readonly Statement[]) =>
    list.forEach((item) => out.push({ section, item }));
  add('authorityModel.invariants', b.authorityModel.invariants);
  add('policySemantics', b.policySemantics);
  add('runtimeQualification', b.runtimeQualification);
  add('resultSecurity', b.resultSecurity);
  add('economicSecurity', b.economicSecurity);
  add('credentialBoundaries', b.credentialBoundaries);
  add('hostileContentBoundaries', b.hostileContentBoundaries);
  return out;
}

function checkBinding(
  binding: CapabilitySecurityBinding,
  index: number,
  violations: SecurityViolation[]
): void {
  const path = `capabilitySecurityBindings[${index}](${binding.id})`;
  const push = (code: SecurityViolationCode, message: string) =>
    violations.push({ code, path, message });

  if (binding.admission === 'closed_not_admitted') {
    if (
      binding.available ||
      binding.purchasable ||
      binding.securityProfile !== null ||
      binding.economicAuthorizationRequired ||
      binding.implementationStatus !== 'UNSUPPORTED'
    ) {
      push(
        'CLOSED_CAPABILITY_ENABLED',
        'a closed capability must be unavailable, not purchasable, carry no security profile and be UNSUPPORTED'
      );
    }
  }

  if (binding.purchasable) {
    if (!binding.available || binding.admission !== 'first_release_candidate') {
      push(
        'CLOSED_CAPABILITY_ENABLED',
        'purchasable requires available and first_release_candidate admission'
      );
    }
    if (
      binding.securityProfile !== 'PUBLIC_ECONOMIC_X402' ||
      !binding.economicAuthorizationRequired
    ) {
      push(
        'CLOSED_CAPABILITY_ENABLED',
        'a purchasable capability must carry the economic profile and require authorization'
      );
    }
    const effects = binding.economicEffects;
    if (effects.length === 0 || effects.every((e) => e === 'none') || !effects.includes('settle')) {
      push(
        'READ_ONLY_CONFLATED_WITH_NO_ECONOMIC_EFFECT',
        'a paid capability has an economic settle effect; read_only execution does not imply economic_effect none'
      );
    }
    if (binding.runtimeQualification !== 'qualified_runtime_required') {
      push(
        'RUNTIME_QUALIFICATION_OMITTED',
        'a purchasable capability must require a qualified runtime'
      );
    }
    if (
      binding.informationEffect.callerBindingRequirement !== 'not_applicable_no_retrieval_route'
    ) {
      push(
        'RETRIEVAL_CLAIM_UNPROVEN',
        'caller-bound retrieval is not exposed or proven and may not be claimed'
      );
    }
  }

  if (
    /caller_bound/.test(binding.resultSemantics) ||
    (/retriev/.test(binding.resultSemantics) && !/no_retrieval_route/.test(binding.resultSemantics))
  ) {
    push('RETRIEVAL_CLAIM_UNPROVEN', 'result semantics claim retrieval that does not exist');
  }

  // Independent recomputation from the governed economic contract.
  if (binding.kind === 'paid_service') {
    if (!isEconomicServiceId(binding.capability)) {
      push('PURCHASABILITY_EXCEEDS_GOVERNANCE', 'capability is not a governed economic service');
      return;
    }
    const offer = buildEconomicOffer(binding.capability);
    const mode = offer.modes.find((m) => m.mode === binding.mode);
    let governedPurchasable = false;
    if (binding.economicMechanism === 'x402') {
      governedPurchasable =
        offer.releasePosture === 'first_release_candidate' && mode?.available === true;
      if (!mode)
        push('PURCHASABILITY_EXCEEDS_GOVERNANCE', `mode "${binding.mode}" is not governed`);
    }
    if (binding.economicMechanism === 'nevermined') governedPurchasable = false;
    if (binding.purchasable && !governedPurchasable) {
      push(
        'PURCHASABILITY_EXCEEDS_GOVERNANCE',
        'binding is purchasable but governance does not admit it'
      );
    }
    if (binding.available && !governedPurchasable) {
      push(
        'PURCHASABILITY_EXCEEDS_GOVERNANCE',
        'binding is available but governance does not admit it'
      );
    }
  }
}

export function validateSecurityDeclaration(
  bundle: SecurityDeclarationBundle
): readonly SecurityViolation[] {
  const v: SecurityViolation[] = [];
  const push = (code: SecurityViolationCode, path: string, message: string) =>
    v.push({ code, path, message });

  if (!isSupportedSecuritySchemaVersion(bundle.schemaVersion)) {
    push(
      'UNKNOWN_SCHEMA_VERSION',
      'schemaVersion',
      `unrecognised schema version "${String(bundle.schemaVersion)}"`
    );
    return v; // nothing else is interpretable
  }
  if (bundle.compatibility.unknownVersionBehavior !== 'denied') {
    push(
      'UNKNOWN_VERSION_BEHAVIOR_NOT_DENY',
      'compatibility.unknownVersionBehavior',
      'unknown versions must be denied'
    );
  }
  if (bundle.truthLevelCeiling !== 'IMPLEMENTED' && bundle.truthLevelCeiling !== 'CONFIGURED') {
    push(
      'TRUTH_CEILING_EXCEEDED',
      'truthLevelCeiling',
      'a static declaration may not assert ACTIVE or VERIFIED'
    );
  }

  // Statuses
  const statuses: { path: string; value: unknown }[] = [];
  allStatements(bundle).forEach(({ section, item }) =>
    statuses.push({ path: `${section}.${item.id}`, value: item.status })
  );
  bundle.supportedSecurityProfiles.forEach((p) =>
    statuses.push({ path: `profile.${p.id}`, value: p.status })
  );
  bundle.capabilitySecurityBindings.forEach((b) =>
    statuses.push({ path: `binding.${b.id}`, value: b.implementationStatus })
  );
  bundle.evidenceSemantics.forEach((e) =>
    statuses.push({ path: `evidence.${e.evidenceClass}`, value: e.status })
  );
  bundle.keyPurposeBoundaries.forEach((k) =>
    statuses.push({ path: `key.${k.purpose}`, value: k.status })
  );
  bundle.unsupportedSecurityFeatures.forEach((n) =>
    statuses.push({ path: `negative.${n.feature}`, value: n.status })
  );
  for (const st of statuses) {
    if (!isImplementationStatus(st.value)) {
      push(
        'UNKNOWN_STATUS',
        st.path,
        `status "${String(st.value)}" is not in ${IMPLEMENTATION_STATUSES.join('|')}`
      );
    }
  }

  // Future/unsupported claims cannot have been exercised.
  for (const { section, item } of allStatements(bundle)) {
    if (
      (item.status === 'DECLARED_FUTURE' || item.status === 'UNSUPPORTED') &&
      item.qualification !== 'not_exercised'
    ) {
      push(
        'FUTURE_OR_UNSUPPORTED_EXERCISED',
        `${section}.${item.id}`,
        'a future or unsupported claim cannot be exercised'
      );
    }
  }

  // Required statements and unsupported-only ids.
  const byId = new Map(allStatements(bundle).map(({ item }) => [item.id, item]));
  for (const id of REQUIRED_STATEMENT_IDS) {
    if (!byId.has(id))
      push('MISSING_REQUIRED_STATEMENT', id, `required statement "${id}" is absent`);
  }
  for (const id of MUST_BE_UNSUPPORTED_IDS) {
    const item = byId.get(id);
    if (item && item.status !== 'UNSUPPORTED') {
      push('RETRIEVAL_CLAIM_UNPROVEN', id, `"${id}" must be UNSUPPORTED in Release 1`);
    }
  }
  const pcc = byId.get('pcc_is_evidence_not_permission');
  if (
    pcc &&
    /permission (?:for|to)|grants? (?:permission|authority)/i.test(pcc.statement) &&
    !/no code path|not/i.test(pcc.statement)
  ) {
    push(
      'RECEIPT_OR_PCC_AS_AUTHORITY',
      'pcc_is_evidence_not_permission',
      'a receipt may not be described as permission'
    );
  }

  // Evidence semantics
  for (const e of bundle.evidenceSemantics) {
    if ((e.mayImplyIdentity as boolean) !== false) {
      push(
        'IDENTITY_FROM_EVIDENCE',
        `evidence.${e.evidenceClass}`,
        'no evidence class may imply identity'
      );
    }
    if ((e.mayWidenAuthority as boolean) !== false) {
      push(
        'EVIDENCE_WIDENS_AUTHORITY',
        `evidence.${e.evidenceClass}`,
        'no evidence class may widen authority'
      );
    }
    if (
      (e.evidenceClass === 'PAYMENT_RECEIPT' ||
        e.evidenceClass === 'DELIVERY_EVIDENCE' ||
        e.evidenceClass === 'SETTLEMENT_EVIDENCE' ||
        e.evidenceClass === 'PAYMENT_AUTHORIZATION') &&
      AUTHORITY_WORDS.test(e.mayOnlySatisfy.replace('economic_authorization', ''))
    ) {
      push(
        'RECEIPT_OR_PCC_AS_AUTHORITY',
        `evidence.${e.evidenceClass}`,
        'receipts and settlement evidence cannot satisfy authority requirements'
      );
    }
    if (e.evidenceClass === 'IDENTITY_PROOF' && e.status !== 'UNSUPPORTED') {
      push(
        'IDENTITY_FROM_EVIDENCE',
        'evidence.IDENTITY_PROOF',
        'no identity mechanism exists in Release 1'
      );
    }
  }
  for (const p of bundle.supportedSecurityProfiles) {
    if (p.economicAuthorization !== 'none' && (p.identity as string) !== 'not_established') {
      push(
        'IDENTITY_FROM_EVIDENCE',
        `profile.${p.id}`,
        'an x402 payment profile may not establish identity'
      );
    }
    if (
      p.id === 'PUBLIC_ECONOMIC_X402' &&
      p.runtimeQualification !== 'qualified_runtime_required'
    ) {
      push(
        'RUNTIME_QUALIFICATION_OMITTED',
        `profile.${p.id}`,
        'the paid profile must require a qualified runtime'
      );
    }
    if (/caller_bound|retrievable/.test(p.resultAccess)) {
      push(
        'RETRIEVAL_CLAIM_UNPROVEN',
        `profile.${p.id}`,
        'a profile may not claim caller-bound retrieval'
      );
    }
  }

  // Negative declarations vs ceilings.
  for (const n of bundle.unsupportedSecurityFeatures) {
    const ceiling = RELEASE_1_STATUS_CEILINGS[n.feature];
    if (ceiling === undefined) {
      push(
        'STATUS_ABOVE_RELEASE_CEILING',
        `negative.${n.feature}`,
        'feature has no recorded Release 1 ceiling'
      );
    } else if (isImplementationStatus(n.status) && !isNoStrongerThan(n.status, ceiling)) {
      push(
        'STATUS_ABOVE_RELEASE_CEILING',
        `negative.${n.feature}`,
        `status ${n.status} exceeds the Release 1 ceiling ${ceiling}`
      );
    }
  }
  for (const feature of Object.keys(RELEASE_1_STATUS_CEILINGS)) {
    if (!bundle.unsupportedSecurityFeatures.some((n) => n.feature === feature)) {
      push('MISSING_REQUIRED_STATEMENT', `negative.${feature}`, 'negative declaration is absent');
    }
  }

  bundle.capabilitySecurityBindings.forEach((b, i) => checkBinding(b, i, v));
  return v;
}

// ---------------------------------------------------------------------------
// Public-projection leak scan
// ---------------------------------------------------------------------------
const FORBIDDEN_KEYS = new Set(['privateEvidenceRef', 'privateNotes', 'internal']);
const LEAK_PATTERNS: readonly { name: string; re: RegExp }[] = [
  {
    name: 'repository_path',
    re: /\b(?:apps|packages|workflows|migrations|governance|registry|scripts)\/[\w./-]+/i,
  },
  { name: 'source_file', re: /\b[\w-]+\.(?:ts|tsx|toml|sql|mts)\b/i },
  // Case-sensitive on purpose: env/binding names are SCREAMING_SNAKE, while
  // legitimate public prose ("wallet secrets") is not.
  {
    name: 'binding_name',
    re: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:SECRET|KEY|KEY_ID|TOKEN|PRIVATE_KEY)\b/,
  },
  { name: 'provider_binding_prefix', re: /\bCDP_[A-Z0-9_]+\b/ },
  { name: 'deployment_tooling', re: /wrangler/i },
  { name: 'long_hex_digest', re: /\b[0-9a-f]{32,}\b/i },
  { name: 'uuid', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { name: 'evm_address', re: /\b0x[0-9a-fA-F]{40}\b/ },
  { name: 'git_sha', re: /\b[0-9a-f]{40}\b/ },
];

/** Deep-scans a public projection for private keys and internal-looking values. */
export function scanForPrivateLeaks(value: unknown, path = '$'): readonly SecurityViolation[] {
  const out: SecurityViolation[] = [];
  const walk = (node: unknown, at: string): void => {
    if (typeof node === 'string') {
      for (const { name, re } of LEAK_PATTERNS) {
        if (re.test(node)) {
          out.push({
            code: 'PRIVATE_FIELD_PROJECTED',
            path: at,
            message: `value matches private pattern ${name}`,
          });
        }
      }
    } else if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (FORBIDDEN_KEYS.has(key)) {
          out.push({
            code: 'PRIVATE_FIELD_PROJECTED',
            path: `${at}.${key}`,
            message: 'private field present',
          });
        }
        walk(child, `${at}.${key}`);
      }
    }
  };
  walk(value, path);
  return out;
}
