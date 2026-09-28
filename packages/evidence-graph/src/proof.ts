/**
 * Proof model. Deliberately NOT one total ordering: evidence has two
 * independent dimensions.
 *
 * 1. `binding` -- who or what vouches that the two ends of a link are the
 *    same thing. This dimension IS ordered (strongest first):
 *
 *      CRYPTOGRAPHICALLY_BOUND  hash equality over bytes we hold ourselves
 *                               (e.g. a clean rebuild of a git commit whose
 *                               sha256 equals the artifact digest)
 *      PLATFORM_ATTESTED        a platform API (Cloudflare) returned the
 *                               fact; trust root is the platform's custody
 *      OPERATOR_ATTESTED        a human/operator wrote it (tag, message,
 *                               release report, annotation)
 *      INFERRED                 derived from other evidence by reasoning
 *      UNVERIFIED               claimed, never checked
 *      UNKNOWN                  no evidence at all
 *
 * 2. `method` -- how the evidence was obtained. UNORDERED set; a link may
 *    carry several methods. OBSERVED_RUNTIME is not "stronger" than
 *    REPRODUCED -- they answer different questions (what is running vs.
 *    what these bytes are).
 *
 * A chain's binding strength is its weakest link. Operator text (release
 * tags, version messages) can never raise a link above OPERATOR_ATTESTED.
 */

export const BINDING_LEVELS = [
  'CRYPTOGRAPHICALLY_BOUND',
  'PLATFORM_ATTESTED',
  'OPERATOR_ATTESTED',
  'INFERRED',
  'UNVERIFIED',
  'UNKNOWN',
] as const;
export type BindingLevel = (typeof BINDING_LEVELS)[number];

export const PROOF_METHODS = [
  'OBSERVED_RUNTIME',
  'CONTROLLED_TEST',
  'REPRODUCED',
  'PLATFORM_API_READ',
  'ASSERTED',
] as const;
export type ProofMethod = (typeof PROOF_METHODS)[number];

export interface ProofLevel {
  readonly binding: BindingLevel;
  readonly methods: readonly ProofMethod[];
}

/** Lower rank = stronger. Only meaningful within the binding dimension. */
export function bindingRank(level: BindingLevel): number {
  return BINDING_LEVELS.indexOf(level);
}

export function weakestBinding(levels: readonly BindingLevel[]): BindingLevel {
  if (levels.length === 0) return 'UNKNOWN';
  return levels.reduce((weakest, l) => (bindingRank(l) > bindingRank(weakest) ? l : weakest));
}

export function isAtLeast(level: BindingLevel, floor: BindingLevel): boolean {
  return bindingRank(level) <= bindingRank(floor);
}
