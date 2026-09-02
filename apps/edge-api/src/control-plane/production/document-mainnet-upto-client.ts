/**
 * SUN-1222C-R3B — pure, network-independent core for the
 * `document_evidence_json.v2` Base-mainnet `upto` one-shot qualification
 * client. Every function here is a plain, synchronous, side-effect-free
 * check or state transition; none of it opens a socket, reads an env var,
 * or touches a wallet. The live wiring (real HTTP calls, real CDP
 * signer, real Permit2 approval) lives entirely in
 * `apps/edge-api/tests/live/document-paid-e2e-mainnet.test.ts`, which
 * imports these functions rather than re-implementing the same guards —
 * so every guard proven here is proven for the live path too, without
 * requiring network access to prove it.
 *
 * Scope: `document_evidence_json.v2` only. This module does not attempt
 * to be a generic multi-service payment client.
 */

/** The only network this client will ever authorize a payment against.
 * No fallback, no auto-switch — see `assertMainnetLock`. */
export const DOCUMENT_MAINNET_NETWORK = 'eip155:8453' as const;

/** Canonical Base-mainnet USDC (matches `resolvePaymentAsset('eip155:8453')`
 * / `@x402/evm`'s own default-asset table — duplicated here as an
 * explicit, independently-reviewable constant rather than trusting the
 * SDK table silently, per the checkpoint's "no automatic chain switching,
 * no fallback token" requirement). */
export const DOCUMENT_MAINNET_USDC_ASSET = '0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913' as const;

export const DOCUMENT_MAINNET_SELLER_ADDRESS =
  '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1' as const;

export const DOCUMENT_SERVICE_ID = 'document_evidence_json.v2' as const;
export const DOCUMENT_PAYMENT_SCHEME = 'upto' as const;
export const DOCUMENT_PRICING_KEY = 'document_evidence_json_max_job' as const;

/** governance/RISK_LIMITS.yaml's `document_evidence_json_max_job` (0.19
 * USD) expressed in atomic USDC units (6 decimals). This is the
 * authorization *ceiling*, never an instruction to charge the full
 * amount — see `packages/protocol-x402/src/requirements/upto.ts`. */
export const DOCUMENT_MAX_AUTHORIZED_ATOMIC = '190000';

export type DocumentRequirementsRejectionReason =
  | 'wrong_service'
  | 'wrong_scheme'
  | 'wrong_network'
  | 'wrong_asset'
  | 'wrong_payTo'
  | 'wrong_pricing_key'
  | 'amount_exceeds_expected_ceiling'
  | 'amount_not_canonical_atomic';

export interface CandidateDocumentPaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  extra?: Record<string, unknown> | null;
}

/** Validates a candidate `PaymentRequirements` object (as echoed back by
 * a real 402 response) against every field this client is willing to
 * sign against. Every failure is returned (not just the first) so an
 * operator sees the complete picture of a bad quote in one shot. Never
 * throws — the caller decides what a non-empty `reasons` array means. */
export function validateDocumentMainnetRequirements(
  requirements: CandidateDocumentPaymentRequirements,
  opts: { serviceId?: string } = {}
): { valid: boolean; reasons: DocumentRequirementsRejectionReason[] } {
  const reasons: DocumentRequirementsRejectionReason[] = [];

  if (opts.serviceId !== undefined && opts.serviceId !== DOCUMENT_SERVICE_ID) {
    reasons.push('wrong_service');
  }
  if (requirements.scheme !== DOCUMENT_PAYMENT_SCHEME) reasons.push('wrong_scheme');
  if (requirements.network !== DOCUMENT_MAINNET_NETWORK) reasons.push('wrong_network');
  if (requirements.asset.toLowerCase() !== DOCUMENT_MAINNET_USDC_ASSET.toLowerCase()) {
    reasons.push('wrong_asset');
  }
  if (requirements.payTo.toLowerCase() !== DOCUMENT_MAINNET_SELLER_ADDRESS.toLowerCase()) {
    reasons.push('wrong_payTo');
  }
  const pricingKeyInExtra = requirements.extra?.['pricing_key'];
  if (pricingKeyInExtra !== undefined && pricingKeyInExtra !== DOCUMENT_PRICING_KEY) {
    reasons.push('wrong_pricing_key');
  }
  if (!isCanonicalAtomicAmount(requirements.amount)) {
    reasons.push('amount_not_canonical_atomic');
  } else if (BigInt(requirements.amount) > BigInt(DOCUMENT_MAX_AUTHORIZED_ATOMIC)) {
    reasons.push('amount_exceeds_expected_ceiling');
  }

  return { valid: reasons.length === 0, reasons };
}

function isCanonicalAtomicAmount(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value === '0') return true;
  return /^[1-9][0-9]*$/.test(value);
}

/** Throws (fails closed) if a resolved network is anything other than
 * the single locked mainnet identifier. No Sepolia fallback path exists
 * — this function has no "else" branch that returns a different network. */
export function assertMainnetLock(
  network: string
): asserts network is typeof DOCUMENT_MAINNET_NETWORK {
  if (network !== DOCUMENT_MAINNET_NETWORK) {
    throw new Error(
      `document-paid-e2e mainnet lock failed: expected network "${DOCUMENT_MAINNET_NETWORK}", got "${network}"`
    );
  }
}

/** Mirrors `validateUptoAuthorization`'s own ceiling check
 * (`requirements/upto.ts`) as an explicit client-side, pre-signing guard
 * — belt-and-suspenders: the operator's own tooling refuses to construct
 * signing material for an amount above the authorized maximum, even
 * before the server would independently reject it. */
export function assertSettledAmountWithinAuthorizedMax(
  actualAtomic: string,
  authorizedMaxAtomic: string
): void {
  if (!isCanonicalAtomicAmount(actualAtomic) || !isCanonicalAtomicAmount(authorizedMaxAtomic)) {
    throw new Error('assertSettledAmountWithinAuthorizedMax: non-canonical atomic amount');
  }
  if (BigInt(actualAtomic) > BigInt(authorizedMaxAtomic)) {
    throw new Error(
      `settled amount ${actualAtomic} exceeds authorized maximum ${authorizedMaxAtomic}`
    );
  }
}

/** Pure decision: does the buyer's current on-chain Permit2 allowance
 * cover the authorized maximum, or is a separate approval transaction
 * required first? Never decides an approval *amount* beyond the caller-
 * supplied ceiling — see `document-paid-e2e-mainnet.test.ts` for why the
 * live path never defaults to an unlimited approval. */
export function decidePermit2Approval(
  currentAllowanceAtomic: bigint,
  authorizedMaximumAtomic: bigint
): { approvalRequired: boolean } {
  return { approvalRequired: currentAllowanceAtomic < authorizedMaximumAtomic };
}

// ---------------------------------------------------------------------
// Exactly-once state machine
// ---------------------------------------------------------------------

export type DocumentPaymentState =
  | 'START'
  | 'UNPAID_REQUEST_SENT'
  | 'PAYMENT_REQUIREMENTS_VALIDATED'
  | 'ALLOWANCE_STATUS_READ'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_SUFFICIENT'
  | 'PAYMENT_PREPARED'
  | 'SIGNED'
  | 'PAID_POST_SUBMITTED'
  | 'RECONCILING'
  | 'COMPLETE'
  | 'FAILED_SAFE';

/** The only edges this state machine will ever accept. Anything not
 * listed here is an invalid transition and `transition()` throws rather
 * than silently allowing it — this is what makes "one 402, one
 * signature, one paid POST, no blind retry" a structural property of the
 * class rather than a convention callers must remember to honor. Every
 * state except the two terminal ones (`COMPLETE`, `FAILED_SAFE`) can
 * additionally transition to `FAILED_SAFE` — enforced separately in
 * `transition()`, not duplicated in this table. */
const ALLOWED_TRANSITIONS: Record<DocumentPaymentState, DocumentPaymentState[]> = {
  START: ['UNPAID_REQUEST_SENT'],
  UNPAID_REQUEST_SENT: ['PAYMENT_REQUIREMENTS_VALIDATED'],
  PAYMENT_REQUIREMENTS_VALIDATED: ['ALLOWANCE_STATUS_READ'],
  ALLOWANCE_STATUS_READ: ['APPROVAL_REQUIRED', 'APPROVAL_SUFFICIENT'],
  APPROVAL_REQUIRED: ['APPROVAL_SUFFICIENT'],
  APPROVAL_SUFFICIENT: ['PAYMENT_PREPARED'],
  PAYMENT_PREPARED: ['SIGNED'],
  SIGNED: ['PAID_POST_SUBMITTED'],
  PAID_POST_SUBMITTED: ['RECONCILING'],
  RECONCILING: ['COMPLETE', 'FAILED_SAFE'],
  COMPLETE: [],
  FAILED_SAFE: [],
};

export class InvalidDocumentPaymentTransitionError extends Error {
  constructor(from: DocumentPaymentState, to: DocumentPaymentState) {
    super(`invalid document-payment state transition: "${from}" -> "${to}"`);
    this.name = 'InvalidDocumentPaymentTransitionError';
  }
}

/** A deterministic, single-use state machine for one qualification
 * attempt. One instance = at most one 402 request, at most one signing
 * action, at most one paid POST — enforced by `ALLOWED_TRANSITIONS`
 * above, not by caller discipline. A terminal state (`COMPLETE` or
 * `FAILED_SAFE`) can never transition again, including back to itself —
 * ambiguous outcomes after a paid POST must go through `RECONCILING`
 * (read-only correlation), never a second `SIGNED`/`PAID_POST_SUBMITTED`. */
export class DocumentPaymentStateMachine {
  #state: DocumentPaymentState = 'START';
  #history: DocumentPaymentState[] = ['START'];

  get state(): DocumentPaymentState {
    return this.#state;
  }

  /** Full transition history, oldest first — useful for evidence
   * reporting and for tests asserting exact call counts per state. */
  get history(): readonly DocumentPaymentState[] {
    return this.#history;
  }

  transition(next: DocumentPaymentState): void {
    if (this.#state === 'COMPLETE' || this.#state === 'FAILED_SAFE') {
      throw new InvalidDocumentPaymentTransitionError(this.#state, next);
    }
    if (next === 'FAILED_SAFE') {
      this.#state = next;
      this.#history.push(next);
      return;
    }
    const allowed = ALLOWED_TRANSITIONS[this.#state];
    if (!allowed.includes(next)) {
      throw new InvalidDocumentPaymentTransitionError(this.#state, next);
    }
    this.#state = next;
    this.#history.push(next);
  }
}
