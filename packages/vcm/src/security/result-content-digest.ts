/**
 * SECURITY-AUTHORITY-SA1-RESULT-CONTENT-DIGEST-DESIGN-01 -- ResultContentDigest v1.
 *
 * SHADOW / LOCAL PRIMITIVE ONLY. Nothing outside the SA-1 files imports this
 * module. Its output is never consumed by response release, replay, payment
 * admission, execution, settlement, PCC, or persistence. It answers exactly
 * one question: "is this the same released content?" -- never "may it be
 * released?".
 *
 * Represented content: the STORED FORM of `CachedResult.body` -- the value
 * `X402ServiceResultRepository.create` serializes with `JSON.stringify` into
 * `x402_service_results.result_json` and that replay reads back with
 * `JSON.parse` and releases via `c.json(cached.body, ...)`. The digest binds
 * content, not a reference, and deliberately excludes: the status, the
 * PAYMENT-RESPONSE `settleResponse`, `durableEvidence`, `receipt_persisted`
 * markers, job/service/payment identifiers that are not part of the body, and
 * any timestamp added by the storage wrapper. Contextual binding (job, result
 * ref, payment binding) belongs to the envelope, not to this digest.
 *
 * Canonicalization is NOT reimplemented: it reuses the repository's single
 * governed canonicalizer and SHA-256 (`../canonical` -> `@siteborne/pcc-schema`).
 * That canonicalizer is JCS-style but not byte-identical to RFC 8785: integer-like
 * object keys are emitted in numeric order ("2" before "10"). It is deterministic
 * and injective, so digests are stable, but a third-party RFC 8785 implementation
 * would compute a different digest. Domain separation follows repo convention (a
 * version tag inside the canonical object, cf. `binding_version`): the hashed
 * object is `{ content, domain }`, so this digest can never equal a payment
 * binding digest, a `hashPaymentObject` value, or a PCC `output_hash` computed
 * over the same JSON.
 *
 * Absent vs null: "no digest" (envelope value `null`) means the content was
 * never bound. A JSON `null` body is real content and has a real digest.
 *
 * Design constraint: the digest is computed over the signed body AFTER signing and
 * must never be embedded inside that body (or the PCC): it would digest itself and
 * alter the PCC wire form. Its carrier lives beside the body, never in it.
 *
 * Failure is a typed error carrying only a code -- never the content. Callers
 * on a live path MUST isolate it (see the design report, section "failure").
 */
import { canonicalize, hashCanonical } from '../canonical';

export const RESULT_CONTENT_DIGEST_VERSION = 'result_content_digest.v1' as const;
export const RESULT_CONTENT_DIGEST_DOMAIN = 'siteborne.result_content_digest.v1' as const;

/**
 * Design ceiling on the canonical size of one digested body. Not derived from
 * repository evidence: chosen to stay at or below a single D1 row, which the
 * result is persisted into. Larger content is UNDIGESTABLE (shadow evidence
 * absent), never truncated or partially hashed.
 */
export const RESULT_CONTENT_MAX_CANONICAL_BYTES = 2_000_000;
/** Maximum number of nested containers (objects/arrays) in one digested body. */
export const RESULT_CONTENT_MAX_DEPTH = 64;

export const RESULT_CONTENT_DIGEST_ERROR_CODES = [
  'RESULT_CONTENT_NOT_SERIALIZABLE',
  'RESULT_CONTENT_UNSUPPORTED_STRUCTURE',
  'RESULT_CONTENT_NOT_CANONICALIZABLE',
  'RESULT_CONTENT_TOO_LARGE',
] as const;
export type ResultContentDigestErrorCode = (typeof RESULT_CONTENT_DIGEST_ERROR_CODES)[number];

export class ResultContentDigestError extends Error {
  readonly code: ResultContentDigestErrorCode;
  constructor(code: ResultContentDigestErrorCode) {
    // The message is the code only: content is never echoed.
    super(code);
    this.name = 'ResultContentDigestError';
    this.code = code;
  }
}

/** `result_content_digest.v<N>:sha256:<64 lowercase hex>`. Self-describing so a
 * future algorithm/version change cannot be confused with v1. */
export type ResultContentDigest = string;

const DIGEST_RE = /^result_content_digest\.v([1-9][0-9]{0,2}):sha256:([0-9a-f]{64})$/;

export interface ParsedResultContentDigest {
  readonly version: number;
  readonly hex: string;
}

/** Total: returns null for anything that is not a well-formed digest string. */
export function parseResultContentDigest(value: unknown): ParsedResultContentDigest | null {
  if (typeof value !== 'string') return null;
  const m = DIGEST_RE.exec(value);
  return m ? { version: Number(m[1]), hex: m[2] as string } : null;
}

export function isResultContentDigest(value: unknown): value is ResultContentDigest {
  return parseResultContentDigest(value) !== null;
}

/**
 * The exact representation storage persists: JSON.stringify -> JSON.parse.
 * Digesting this (not the in-memory value) makes digest(in-memory at persist
 * time) equal digest(row read back at release time) by construction.
 */
function toStoredForm(content: unknown): unknown {
  let text: string | undefined;
  try {
    text = JSON.stringify(content);
  } catch {
    throw new ResultContentDigestError('RESULT_CONTENT_NOT_SERIALIZABLE');
  }
  if (text === undefined) throw new ResultContentDigestError('RESULT_CONTENT_NOT_SERIALIZABLE');
  return JSON.parse(text) as unknown;
}

/**
 * Rejects structures the governed canonicalizer would silently collapse. The
 * probe in the design report shows an OWN `__proto__` key is dropped by JCS, so
 * `{"__proto__":{..},"a":1}` and `{"a":1}` would otherwise share one digest.
 * Iterative, so hostile nesting cannot overflow the stack.
 */
function assertSupportedStructure(root: unknown): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: unknown; depth: number };
    if (typeof node !== 'object' || node === null) continue;
    // The root container has depth 0, so this admits exactly MAX_DEPTH nested
    // containers and refuses the next one.
    if (depth >= RESULT_CONTENT_MAX_DEPTH) {
      throw new ResultContentDigestError('RESULT_CONTENT_UNSUPPORTED_STRUCTURE');
    }
    if (Array.isArray(node)) {
      for (const item of node) stack.push({ node: item, depth: depth + 1 });
      continue;
    }
    for (const key of Object.keys(node)) {
      if (key === '__proto__') {
        throw new ResultContentDigestError('RESULT_CONTENT_UNSUPPORTED_STRUCTURE');
      }
      stack.push({ node: (node as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
}

/**
 * Deterministic: no clock, randomness, environment, or I/O. Same stored-form
 * content -> same digest; any change to a value, nesting, or array order ->
 * a different digest; object key order is irrelevant (JCS).
 */
export async function computeResultContentDigest(content: unknown): Promise<ResultContentDigest> {
  const stored = toStoredForm(content);
  assertSupportedStructure(stored);

  let canonicalContent: string;
  try {
    canonicalContent = canonicalize(stored);
  } catch {
    // e.g. an integer outside the JCS safe range: lossy, so refused.
    throw new ResultContentDigestError('RESULT_CONTENT_NOT_CANONICALIZABLE');
  }
  if (new TextEncoder().encode(canonicalContent).length > RESULT_CONTENT_MAX_CANONICAL_BYTES) {
    throw new ResultContentDigestError('RESULT_CONTENT_TOO_LARGE');
  }

  let hashed: string;
  try {
    hashed = await hashCanonical({ content: stored, domain: RESULT_CONTENT_DIGEST_DOMAIN });
  } catch {
    throw new ResultContentDigestError('RESULT_CONTENT_NOT_CANONICALIZABLE');
  }
  const m = /^sha256:([0-9a-f]{64})$/.exec(hashed);
  if (!m) throw new ResultContentDigestError('RESULT_CONTENT_NOT_CANONICALIZABLE');
  return `${RESULT_CONTENT_DIGEST_VERSION}:sha256:${m[1] as string}`;
}

/** Descriptive read-side outcomes. Not an authority verdict. */
export type ResultContentDigestComparison =
  | 'MATCH'
  | 'MISMATCH'
  | 'MALFORMED_DIGEST'
  | 'UNSUPPORTED_VERSION'
  | 'CONTENT_UNDIGESTABLE';

/**
 * Recomputes the digest of `content` and compares it with a previously bound
 * digest. Total: never throws. This is the access-time check the P2 concerns
 * ("is the content being accessed the content originally bound?").
 */
export async function compareResultContentDigest(
  content: unknown,
  expected: unknown
): Promise<ResultContentDigestComparison> {
  const parsed = parseResultContentDigest(expected);
  if (!parsed) return 'MALFORMED_DIGEST';
  if (parsed.version !== 1) return 'UNSUPPORTED_VERSION';
  let actual: ResultContentDigest;
  try {
    actual = await computeResultContentDigest(content);
  } catch {
    return 'CONTENT_UNDIGESTABLE';
  }
  return actual === expected ? 'MATCH' : 'MISMATCH';
}
