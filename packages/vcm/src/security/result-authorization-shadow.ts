/**
 * SECURITY-AUTHORITY-SA1-RESULT-SHADOW-ENVELOPE-DESIGN-01 -- ResultAuthorizationEnvelopeV1
 * and the pure shadow comparator.
 *
 * SHADOW / LOCAL MODEL ONLY. Nothing imports this module. Its output is never
 * consumed by HTTP/MCP response release, payment admission, execution,
 * provider invocation, commit, PCC, settlement, result persistence, or
 * reconciliation. It grants and denies nothing: the vocabulary deliberately
 * contains no ALLOW/DENY/AUTHORIZED/UNAUTHORIZED term.
 *
 * Constitution: authentication != authorization; identity != trust; payment
 * authorization != identity; payment receipt != result authorization; result
 * existence != result authorization; evidence != authority.
 *
 * Purity: no clock, no randomness, no I/O, no environment, no imports of
 * runtime code. Subjects arrive as pre-computed keyed pseudonymous digests;
 * raw wallets, principals, signatures, and payment identifiers are rejected
 * as malformed rather than stored or compared.
 */

export const RESULT_AUTHORIZATION_ENVELOPE_VERSION = 'result_authorization_envelope.v1' as const;
export const RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION =
  'result_authorization_shadow_policy.v1' as const;

/** Closed shadow vocabulary. Descriptive only; never an authority verdict. */
export const SHADOW_CLASSIFICATIONS = [
  'MATCH',
  'MISMATCH',
  'INSUFFICIENT_EVIDENCE',
  'NOT_APPLICABLE',
  'LEGACY_UNBOUND',
  'ERROR',
] as const;
export type ShadowClassification = (typeof SHADOW_CLASSIFICATIONS)[number];

/** Closed reason-code vocabulary, in canonical emission order. */
export const SHADOW_REASON_CODES = [
  // applicability / structure
  'CURRENT_PREDICATE_NOT_RESULT_RELEASE',
  'MALFORMED_REPLAY_CONTEXT',
  'NO_ENVELOPE',
  'MALFORMED_ENVELOPE',
  'UNSUPPORTED_ENVELOPE_VERSION',
  'UNSUPPORTED_POLICY_VERSION',
  'MALFORMED_SUBJECT_SLOT',
  'ENVELOPE_OPERATION_MISMATCH',
  'ENVELOPE_PAYMENT_BINDING_MISMATCH',
  'ENVELOPE_PAYMENT_IDENTIFIER_MISMATCH',
  'RESULT_IDENTITY_MISMATCH',
  // subject axes
  'STORED_SUBJECTS_ABSENT',
  'PAYER_SUBJECT_MISMATCH',
  'AUTHENTICATED_CALLER_SUBJECT_MISMATCH',
  'REQUEST_SIGNER_SUBJECT_MISMATCH',
  'PAYER_SUBJECT_MATCH',
  'AUTHENTICATED_CALLER_SUBJECT_MATCH',
  'REQUEST_SIGNER_SUBJECT_MATCH',
  'PAYER_MATCH_WITHOUT_AUTHENTICATED_SUBJECT',
  'PAYER_CANDIDATE_ABSENT',
  'AUTHENTICATED_CALLER_CANDIDATE_ABSENT',
  'REQUEST_SIGNER_CANDIDATE_ABSENT',
  'SUBJECT_EVIDENCE_UNVERIFIED',
  'SUBJECT_KEY_VERSION_INCOMPARABLE',
  'NO_AUTHORITY_BEARING_SUBJECT_COMPARED',
] as const;
export type ShadowReasonCode = (typeof SHADOW_REASON_CODES)[number];

export const SHADOW_EVIDENCE_COMPLETENESS = ['NONE', 'PARTIAL', 'COMPLETE'] as const;
export type ShadowEvidenceCompleteness = (typeof SHADOW_EVIDENCE_COMPLETENESS)[number];

/**
 * Distinct subjects. A wallet is a payer_subject, never a SITEBORNE caller.
 * economic_subject and result_subject are reserved names: no Release-1 source
 * produces them, so they are not slots in V1 (see report §4).
 */
export const SUBJECT_AXES = [
  'payer_subject',
  'authenticated_caller_subject',
  'request_signer_subject',
] as const;
export type SubjectAxis = (typeof SUBJECT_AXES)[number];

/** Axes whose match can support a MATCH. Payer alone cannot (payment != identity). */
const AUTHORITY_BEARING_AXES: readonly SubjectAxis[] = [
  'authenticated_caller_subject',
  'request_signer_subject',
];

/** AUTHORITATIVE is intentionally not a slot class: evidence != authority. */
export const SUBJECT_EVIDENCE_CLASSES = ['VERIFIED_EVIDENCE', 'UNVERIFIED_EVIDENCE'] as const;
export type SubjectEvidenceClass = (typeof SUBJECT_EVIDENCE_CLASSES)[number];

export type SubjectSlot =
  | { readonly status: 'ABSENT' }
  | {
      readonly status: 'PRESENT';
      readonly evidence_class: SubjectEvidenceClass;
      /** 64 lowercase hex: keyed pseudonymous digest of the subject. Never raw. */
      readonly subject_digest: string;
      /** Version of the server key used for the digest; digests are only
       * comparable within one key version. */
      readonly digest_key_version: string;
    };

export type SubjectSlots = Readonly<Record<SubjectAxis, SubjectSlot>>;

/** Result release paths of the existing, unchanged predicate. */
export const CURRENT_REPLAY_PREDICATES = [
  'first_seen',
  'duplicate_same',
  'duplicate_conflict',
  'already_consumed',
  'expired',
  'repository_error',
] as const;
export type CurrentReplayPredicate = (typeof CURRENT_REPLAY_PREDICATES)[number];

const RESULT_RELEASE_PREDICATES: readonly CurrentReplayPredicate[] = [
  'duplicate_same',
  'already_consumed',
];

/**
 * Stored, additive, internal-only. Never a substitute for PaymentAttemptBinding
 * and never part of its digest. Every field has one security purpose.
 */
export interface ResultAuthorizationEnvelopeV1 {
  /** Schema gate; unknown versions are ERROR, never guessed. */
  readonly envelope_version: typeof RESULT_AUTHORIZATION_ENVELOPE_VERSION;
  /** Policy the subject evidence was captured under. */
  readonly policy_version: typeof RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION;
  /** Operation identity: the job the result belongs to (jobs.id). */
  readonly job_id: string;
  /** Digest of the Payment Identifier. The identifier itself is a bearer
   * capability under the current tuple-possession model, so it is not stored. */
  readonly payment_identifier_digest: string;
  /** The existing 21-field replay binding digest, referenced unchanged. */
  readonly payment_binding_digest: string;
  /** Result identity, Release 1: the job's x402_service_results row is keyed
   * 1:1 by job_id. */
  readonly result_ref: string;
  /** Optional content digest of the persisted result. Not persisted in
   * Release 1 (ABSENT); when present it must equal the replay-side digest. */
  readonly result_content_digest: string | null;
  readonly subjects: SubjectSlots;
  /** When the envelope evidence was captured (ISO). Carried, never read
   * from a clock by the comparator. */
  readonly evidence_captured_at: string;
  /** Reserved future reference names; opaque, unused by the comparator. */
  readonly authority_refs?: {
    readonly operation_id?: string;
    readonly authority_context_id?: string;
    readonly policy_evaluation_id?: string;
    readonly result_binding_id?: string;
  };
}

/** What the current replay branch already knows, plus candidate subjects.
 * Release 1 supplies all three candidate slots as ABSENT. */
export interface CurrentReplayContext {
  readonly predicate: CurrentReplayPredicate;
  readonly job_id: string;
  readonly payment_identifier_digest: string;
  readonly payment_binding_digest: string;
  readonly result_ref: string;
  readonly result_content_digest: string | null;
  readonly candidate_subjects: SubjectSlots;
}

export type AxisOutcome =
  | 'MATCH'
  | 'MISMATCH'
  | 'STORED_ABSENT'
  | 'CANDIDATE_ABSENT'
  | 'BOTH_ABSENT'
  | 'INCOMPARABLE';

export interface ResultAuthorizationShadowEvaluation {
  readonly classification: ShadowClassification;
  readonly reason_codes: readonly ShadowReasonCode[];
  readonly evidence_completeness: ShadowEvidenceCompleteness;
  readonly axes: Readonly<Record<SubjectAxis, AxisOutcome | 'NOT_EVALUATED'>>;
  readonly policy_version: typeof RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION;
  readonly envelope_version: typeof RESULT_AUTHORIZATION_ENVELOPE_VERSION;
}

const HEX64 = /^[0-9a-f]{64}$/;
const KEY_VERSION = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const NOT_EVALUATED = Object.freeze({
  payer_subject: 'NOT_EVALUATED',
  authenticated_caller_subject: 'NOT_EVALUATED',
  request_signer_subject: 'NOT_EVALUATED',
} as const);

function result(
  classification: ShadowClassification,
  reasons: Iterable<ShadowReasonCode>,
  completeness: ShadowEvidenceCompleteness,
  axes: ResultAuthorizationShadowEvaluation['axes'] = NOT_EVALUATED
): ResultAuthorizationShadowEvaluation {
  const set = new Set(reasons);
  return Object.freeze({
    classification,
    reason_codes: Object.freeze(SHADOW_REASON_CODES.filter((c) => set.has(c))),
    evidence_completeness: completeness,
    axes: Object.freeze({ ...axes }),
    policy_version: RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION,
    envelope_version: RESULT_AUTHORIZATION_ENVELOPE_VERSION,
  });
}

/** Returns the validated slot, or null when malformed. */
function readSlot(v: unknown): SubjectSlot | null {
  if (!isRecord(v)) return null;
  if (v.status === 'ABSENT') return { status: 'ABSENT' };
  if (v.status !== 'PRESENT') return null;
  if (
    typeof v.subject_digest !== 'string' ||
    !HEX64.test(v.subject_digest) ||
    typeof v.digest_key_version !== 'string' ||
    !KEY_VERSION.test(v.digest_key_version) ||
    (v.evidence_class !== 'VERIFIED_EVIDENCE' && v.evidence_class !== 'UNVERIFIED_EVIDENCE')
  ) {
    return null;
  }
  return {
    status: 'PRESENT',
    evidence_class: v.evidence_class,
    subject_digest: v.subject_digest,
    digest_key_version: v.digest_key_version,
  };
}

function readSlots(v: unknown): SubjectSlots | null {
  if (!isRecord(v)) return null;
  const out: Partial<Record<SubjectAxis, SubjectSlot>> = {};
  for (const axis of SUBJECT_AXES) {
    const slot = readSlot(v[axis]);
    if (!slot) return null;
    out[axis] = slot;
  }
  return out as SubjectSlots;
}

const idOk = (v: unknown): v is string => typeof v === 'string' && OPAQUE_ID.test(v);
const digestOk = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v);
const optDigestOk = (v: unknown): v is string | null => v === null || digestOk(v);

interface ParsedContext {
  readonly predicate: CurrentReplayPredicate;
  readonly job_id: string;
  readonly payment_identifier_digest: string;
  readonly payment_binding_digest: string;
  readonly result_ref: string;
  readonly result_content_digest: string | null;
  readonly candidate: SubjectSlots;
}

function parseContext(v: unknown): ParsedContext | null {
  if (!isRecord(v)) return null;
  if (
    typeof v.predicate !== 'string' ||
    !(CURRENT_REPLAY_PREDICATES as readonly string[]).includes(v.predicate) ||
    !idOk(v.job_id) ||
    !digestOk(v.payment_identifier_digest) ||
    !digestOk(v.payment_binding_digest) ||
    !idOk(v.result_ref) ||
    !optDigestOk(v.result_content_digest)
  ) {
    return null;
  }
  const candidate = readSlots(v.candidate_subjects);
  if (!candidate) return null;
  return {
    predicate: v.predicate as CurrentReplayPredicate,
    job_id: v.job_id,
    payment_identifier_digest: v.payment_identifier_digest,
    payment_binding_digest: v.payment_binding_digest,
    result_ref: v.result_ref,
    result_content_digest: v.result_content_digest,
    candidate,
  };
}

type EnvelopeParse =
  | { kind: 'ok'; envelope: ParsedEnvelope }
  | { kind: 'error'; reason: ShadowReasonCode };

interface ParsedEnvelope {
  readonly job_id: string;
  readonly payment_identifier_digest: string;
  readonly payment_binding_digest: string;
  readonly result_ref: string;
  readonly result_content_digest: string | null;
  readonly stored: SubjectSlots;
}

function parseEnvelope(v: unknown): EnvelopeParse {
  if (!isRecord(v)) return { kind: 'error', reason: 'MALFORMED_ENVELOPE' };
  if (v.envelope_version !== RESULT_AUTHORIZATION_ENVELOPE_VERSION) {
    return { kind: 'error', reason: 'UNSUPPORTED_ENVELOPE_VERSION' };
  }
  if (v.policy_version !== RESULT_AUTHORIZATION_SHADOW_POLICY_VERSION) {
    return { kind: 'error', reason: 'UNSUPPORTED_POLICY_VERSION' };
  }
  if (
    !idOk(v.job_id) ||
    !digestOk(v.payment_identifier_digest) ||
    !digestOk(v.payment_binding_digest) ||
    !idOk(v.result_ref) ||
    !optDigestOk(v.result_content_digest) ||
    typeof v.evidence_captured_at !== 'string'
  ) {
    return { kind: 'error', reason: 'MALFORMED_ENVELOPE' };
  }
  const stored = readSlots(v.subjects);
  if (!stored) return { kind: 'error', reason: 'MALFORMED_SUBJECT_SLOT' };
  return {
    kind: 'ok',
    envelope: {
      job_id: v.job_id,
      payment_identifier_digest: v.payment_identifier_digest,
      payment_binding_digest: v.payment_binding_digest,
      result_ref: v.result_ref,
      result_content_digest: v.result_content_digest,
      stored,
    },
  };
}

const MISMATCH_CODE: Record<SubjectAxis, ShadowReasonCode> = {
  payer_subject: 'PAYER_SUBJECT_MISMATCH',
  authenticated_caller_subject: 'AUTHENTICATED_CALLER_SUBJECT_MISMATCH',
  request_signer_subject: 'REQUEST_SIGNER_SUBJECT_MISMATCH',
};
const MATCH_CODE: Record<SubjectAxis, ShadowReasonCode> = {
  payer_subject: 'PAYER_SUBJECT_MATCH',
  authenticated_caller_subject: 'AUTHENTICATED_CALLER_SUBJECT_MATCH',
  request_signer_subject: 'REQUEST_SIGNER_SUBJECT_MATCH',
};
const CANDIDATE_ABSENT_CODE: Record<SubjectAxis, ShadowReasonCode> = {
  payer_subject: 'PAYER_CANDIDATE_ABSENT',
  authenticated_caller_subject: 'AUTHENTICATED_CALLER_CANDIDATE_ABSENT',
  request_signer_subject: 'REQUEST_SIGNER_CANDIDATE_ABSENT',
};

function compareAxis(
  stored: SubjectSlot,
  candidate: SubjectSlot
): { outcome: AxisOutcome; reasons: ShadowReasonCode[] } {
  if (stored.status === 'ABSENT' && candidate.status === 'ABSENT') {
    return { outcome: 'BOTH_ABSENT', reasons: [] };
  }
  if (stored.status === 'ABSENT') return { outcome: 'STORED_ABSENT', reasons: [] };
  if (candidate.status === 'ABSENT') return { outcome: 'CANDIDATE_ABSENT', reasons: [] };
  // Only verified evidence on both sides is comparable (identity != trust).
  if (
    stored.evidence_class !== 'VERIFIED_EVIDENCE' ||
    candidate.evidence_class !== 'VERIFIED_EVIDENCE'
  ) {
    return { outcome: 'INCOMPARABLE', reasons: ['SUBJECT_EVIDENCE_UNVERIFIED'] };
  }
  if (stored.digest_key_version !== candidate.digest_key_version) {
    return { outcome: 'INCOMPARABLE', reasons: ['SUBJECT_KEY_VERSION_INCOMPARABLE'] };
  }
  return stored.subject_digest === candidate.subject_digest
    ? { outcome: 'MATCH', reasons: [] }
    : { outcome: 'MISMATCH', reasons: [] };
}

/**
 * Pure, total, deterministic. Never throws, never reads a clock, never
 * performs I/O. Accepts `unknown` so malformed persisted or derived evidence
 * classifies as ERROR instead of raising into a release path.
 */
export function evaluateResultAuthorizationShadow(
  currentReplayContext: unknown,
  resultAuthorizationEnvelope: unknown
): ResultAuthorizationShadowEvaluation {
  const ctx = parseContext(currentReplayContext);
  if (!ctx) return result('ERROR', ['MALFORMED_REPLAY_CONTEXT'], 'NONE');

  if (!RESULT_RELEASE_PREDICATES.includes(ctx.predicate)) {
    return result('NOT_APPLICABLE', ['CURRENT_PREDICATE_NOT_RESULT_RELEASE'], 'NONE');
  }

  if (resultAuthorizationEnvelope === null || resultAuthorizationEnvelope === undefined) {
    return result('LEGACY_UNBOUND', ['NO_ENVELOPE'], 'NONE');
  }
  const parsed = parseEnvelope(resultAuthorizationEnvelope);
  if (parsed.kind === 'error') return result('ERROR', [parsed.reason], 'NONE');
  const env = parsed.envelope;

  // Structural identity first: an envelope for a different operation/result
  // says nothing about this release, whatever its subjects are.
  const identity: ShadowReasonCode[] = [];
  if (env.job_id !== ctx.job_id) identity.push('ENVELOPE_OPERATION_MISMATCH');
  if (env.payment_binding_digest !== ctx.payment_binding_digest) {
    identity.push('ENVELOPE_PAYMENT_BINDING_MISMATCH');
  }
  if (env.payment_identifier_digest !== ctx.payment_identifier_digest) {
    identity.push('ENVELOPE_PAYMENT_IDENTIFIER_MISMATCH');
  }
  if (
    env.result_ref !== ctx.result_ref ||
    (env.result_content_digest !== null &&
      ctx.result_content_digest !== null &&
      env.result_content_digest !== ctx.result_content_digest)
  ) {
    identity.push('RESULT_IDENTITY_MISMATCH');
  }
  if (identity.length > 0) return result('MISMATCH', identity, 'NONE');

  if (SUBJECT_AXES.every((a) => env.stored[a].status === 'ABSENT')) {
    // Nothing was ever bound: honest legacy baseline, not a failure.
    return result('LEGACY_UNBOUND', ['STORED_SUBJECTS_ABSENT'], 'NONE');
  }

  const axes = {} as Record<SubjectAxis, AxisOutcome>;
  const reasons = new Set<ShadowReasonCode>();
  for (const axis of SUBJECT_AXES) {
    const cmp = compareAxis(env.stored[axis], ctx.candidate[axis]);
    axes[axis] = cmp.outcome;
    cmp.reasons.forEach((r) => reasons.add(r));
    if (cmp.outcome === 'MISMATCH') reasons.add(MISMATCH_CODE[axis]);
    if (cmp.outcome === 'MATCH') reasons.add(MATCH_CODE[axis]);
    if (cmp.outcome === 'CANDIDATE_ABSENT') reasons.add(CANDIDATE_ABSENT_CODE[axis]);
  }

  const compared = SUBJECT_AXES.filter((a) => axes[a] === 'MATCH' || axes[a] === 'MISMATCH');
  const wasCompared = (a: SubjectAxis) => compared.includes(a);
  // COMPLETE: both Release-1-relevant axes (payer and authenticated caller)
  // were compared. PARTIAL: some axis compared. NONE: nothing compared.
  const completeness: ShadowEvidenceCompleteness =
    wasCompared('payer_subject') && wasCompared('authenticated_caller_subject')
      ? 'COMPLETE'
      : compared.length > 0
        ? 'PARTIAL'
        : 'NONE';

  // Any comparable mismatch dominates a match on another axis.
  if (compared.some((a) => axes[a] === 'MISMATCH')) {
    return result('MISMATCH', reasons, completeness, axes);
  }

  const authorityMatched = AUTHORITY_BEARING_AXES.some((a) => axes[a] === 'MATCH');
  if (authorityMatched) return result('MATCH', reasons, completeness, axes);

  if (axes.payer_subject === 'MATCH') {
    reasons.add('PAYER_MATCH_WITHOUT_AUTHENTICATED_SUBJECT');
  } else {
    reasons.add('NO_AUTHORITY_BEARING_SUBJECT_COMPARED');
  }
  return result('INSUFFICIENT_EVIDENCE', reasons, completeness, axes);
}

// ---------------------------------------------------------------------------
// Telemetry projection (in-memory, allowlisted). No emitter exists.
// ---------------------------------------------------------------------------

export const RESULT_SHADOW_TELEMETRY_EVENTS = [
  'result_shadow_match',
  'result_shadow_mismatch',
  'result_shadow_legacy_unbound',
  'result_shadow_insufficient_evidence',
  'result_shadow_not_applicable',
  'result_shadow_error',
] as const;
export type ResultShadowTelemetryEvent = (typeof RESULT_SHADOW_TELEMETRY_EVENTS)[number];

const EVENT_FOR: Record<ShadowClassification, ResultShadowTelemetryEvent> = {
  MATCH: 'result_shadow_match',
  MISMATCH: 'result_shadow_mismatch',
  LEGACY_UNBOUND: 'result_shadow_legacy_unbound',
  INSUFFICIENT_EVIDENCE: 'result_shadow_insufficient_evidence',
  NOT_APPLICABLE: 'result_shadow_not_applicable',
  ERROR: 'result_shadow_error',
};

export interface ResultShadowTelemetryRecord {
  readonly event: ResultShadowTelemetryEvent;
  readonly classification: ShadowClassification;
  readonly reason_codes: readonly ShadowReasonCode[];
  readonly evidence_completeness: ShadowEvidenceCompleteness;
  readonly axes: ResultAuthorizationShadowEvaluation['axes'];
  readonly policy_version: string;
  readonly envelope_version: string;
  /** Internal job id only when it passes the opaque-id shape; else null. */
  readonly job_id: string | null;
}

/**
 * Builds an allowlisted record from an evaluation. It never receives the
 * envelope or context content; only the already-closed evaluation and, for
 * correlation, the job id. Subject digests, payment identifiers, signatures,
 * results, and request metadata cannot enter.
 */
export function projectResultShadowTelemetry(
  evaluation: ResultAuthorizationShadowEvaluation,
  jobId: unknown
): ResultShadowTelemetryRecord {
  return Object.freeze({
    event: EVENT_FOR[evaluation.classification],
    classification: evaluation.classification,
    reason_codes: evaluation.reason_codes,
    evidence_completeness: evaluation.evidence_completeness,
    axes: evaluation.axes,
    policy_version: evaluation.policy_version,
    envelope_version: evaluation.envelope_version,
    job_id: idOk(jobId) ? jobId : null,
  });
}
