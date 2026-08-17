/**
 * SUN-0900B checkpoint 2F — authoritative registration validator for the
 * `document_evidence_json.v1` dynamic-credit Nevermined plan.
 *
 * Credential-independent: validates an already-fetched READ-BACK
 * representation (the exact shape `Payments.getInstance().agents.getAgent`/
 * `.plans.getPlan()` return, empirically captured in SUN-0900B checkpoint
 * 2D's real probe registration — `registry.price`/`registry.credits` for
 * the plan, `metadata.agent.endpoints`/`registry.plans` for the agent).
 * Never calls the SDK itself (this package has zero runtime SDK
 * dependency, by design — see `spec-baseline.json`'s
 * `protocol_runtime_sdk_dependency: false`).
 *
 * Frozen economic model (checkpoint 2E, `NEVERMINED_PREPAID_DYNAMIC_ACCEPTED`):
 * a genuine `getDynamicCreditsConfig(190_000n, 12_000n, 190_000n)` plan,
 * priced at 190000 atomic Base Sepolia USDC — the exact 1:1
 * credit-acquisition-value identity (`190000n / 190000n === 1n`) is
 * validated with BigInt integer arithmetic only; the backend's own
 * floating `pricePerCredit` field is never treated as monetary authority
 * (checkpoint 2D's own explicit instruction).
 *
 * Deliberately does NOT validate the still-unproven partial-balance
 * auto-top-up quantity (checkpoint 2E/2F: that is live document
 * *runtime* behavior, not registration *shape*, and belongs in a future
 * live acceptance matrix, never in this structural validator).
 */

import type { NeverminedRegistrationReconciliation } from './registry-reconciliation';
import { deriveNeverminedAgentDisplayName, deriveNeverminedPlanDisplayName } from './declarations';

export interface NeverminedPlanPriceReadback {
  amounts?: readonly (string | number | bigint)[];
  receivers?: readonly string[];
  tokenAddress?: string;
  isCrypto?: boolean;
}

export interface NeverminedPlanCreditsReadback {
  amount?: string | number | bigint;
  minAmount?: string | number | bigint;
  maxAmount?: string | number | bigint;
  isRedemptionAmountFixed?: boolean;
  redemptionType?: number;
  onchainMirror?: boolean;
  durationSecs?: string | number | bigint;
}

export interface NeverminedPlanReadback {
  id?: string;
  metadata?: {
    main?: { name?: string };
    plan?: {
      accessLimit?: string;
      isTrialPlan?: boolean;
      recurringSubscription?: boolean;
    };
  };
  registry?: {
    price?: NeverminedPlanPriceReadback;
    credits?: NeverminedPlanCreditsReadback;
  };
}

export interface NeverminedAgentReadback {
  id?: string;
  metadata?: {
    main?: { name?: string };
    agent?: { endpoints?: readonly { POST?: string; [verb: string]: unknown }[] };
  };
  registry?: { plans?: readonly string[] };
}

/** SUN-1000 checkpoint 1O-B: the widened (non-literal) shape shared by
 * `DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS` and `..._V2` -- used as the
 * parameter type wherever a caller may pass either constant, since the
 * `as const` literal types below are otherwise too narrow for one to
 * substitute for the other. */
export interface DocumentDynamicPlanRequirements {
  agent_name: string;
  plan_name: string;
  endpoint: string;
  gross_price_atomic: bigint;
  credits_granted: bigint;
  min_redemption: bigint;
  max_redemption: bigint;
  is_redemption_amount_fixed: boolean;
  token_address: string;
  receiver: string;
  seller_net_atomic: bigint;
  platform_fee_receiver: string;
  platform_fee_atomic: bigint;
  access_limit: string;
  redemption_type: number;
  onchain_mirror: boolean;
  duration_secs: bigint;
}

/** Frozen requirement constants for the document dynamic-credit plan
 * (checkpoint 2E's accepted candidate). Every value here is either a
 * `bigint` (economic amounts, compared exactly, no rounding) or an
 * exact-match string/boolean (identity fields). */
export const DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS = {
  agent_name: 'Document Evidence JSON',
  plan_name: 'Document Evidence JSON — PAYG plan',
  endpoint: 'https://utility.siteborne.net/v1/nevermined/document/evidence-json',
  gross_price_atomic: 190_000n,
  credits_granted: 190_000n,
  min_redemption: 12_000n,
  max_redemption: 190_000n,
  is_redemption_amount_fixed: false,
  token_address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  receiver: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
  seller_net_atomic: 188_100n,
  platform_fee_receiver: '0x2020949c1B565421AC21b76e70340266c4CA9A90',
  platform_fee_atomic: 1_900n,
  access_limit: 'credits',
  redemption_type: 4,
  onchain_mirror: false,
  duration_secs: 0n,
} as const;

/** SUN-1000 checkpoint 1O-B: the v2 counterpart of
 * `DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS`. Every economic value is byte-
 * identical to v1 (`SAME_ECONOMICS_NEW_SERVICE_MAJOR`, checkpoint 1L
 * section 9) -- only `agent_name`/`plan_name` (via the shared
 * `deriveNeverminedAgentDisplayName`/`deriveNeverminedPlanDisplayName`,
 * the same disambiguation used by the fixed-PAYG services) and
 * `endpoint` (the real `/v2/nevermined/...` route) differ. v1's own
 * constant above is untouched. */
export const DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS_V2 = (() => {
  const agentName = deriveNeverminedAgentDisplayName(
    'document_evidence_json.v2',
    'Document Evidence JSON'
  );
  return {
    ...DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS,
    agent_name: agentName,
    plan_name: deriveNeverminedPlanDisplayName('document_evidence_json.v2', agentName),
    endpoint: 'https://utility.siteborne.net/v2/nevermined/document/evidence-json',
  } as const;
})();

/** Frozen usage-tier valuations (checkpoint 2E: usage-value atomic
 * equivalent, never a claim about fresh per-request USDC movement). */
export const DOCUMENT_USAGE_TIER_VALUES_ATOMIC = {
  native: 12_000n,
  ocr: 19_000n,
  table: 29_000n,
  maximum: 190_000n,
} as const;

export type DocumentDynamicPlanValidation = { valid: true } | { valid: false; reason: string };

export type NeverminedDocumentDynamicRegistrationReconciliation =
  | { state: 'EXACT_EXISTING'; agentId: string; planId: string }
  | { state: 'NO_MATCH' }
  | { state: 'CONFLICT'; reason: string };

function toBigIntOrNull(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

/**
 * Proves the plan's acquisition-value ratio is exactly `1n` atomic USDC
 * per credit — integer division with an exact-remainder check, never
 * floating point, never the backend's own `pricePerCredit: number`.
 */
export function computeCreditAcquisitionValueAtomic(
  grossPriceAtomic: bigint,
  creditsGranted: bigint
): { ratio: bigint; exact: boolean } {
  if (creditsGranted === 0n) return { ratio: 0n, exact: false };
  const exact = grossPriceAtomic % creditsGranted === 0n;
  return { ratio: exact ? grossPriceAtomic / creditsGranted : 0n, exact };
}

/**
 * Authoritative registration validator for the document dynamic-credit
 * plan. Validates a READ-BACK representation (post-registration GET),
 * never the pre-registration local request object — per this
 * checkpoint's own instruction, structural safety must be proven from
 * what Nevermined actually persisted, not merely what SITEBORNE asked
 * for.
 */
export function validateNeverminedDocumentDynamicPlan(
  agent: NeverminedAgentReadback,
  plan: NeverminedPlanReadback,
  // SUN-1000 checkpoint 1O-B: optional, defaults to the original v1
  // requirements -- every existing caller's behavior is unchanged.
  requirements: DocumentDynamicPlanRequirements = DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS
): DocumentDynamicPlanValidation {
  const req = requirements;

  // ---- identity ----
  if (typeof agent.id !== 'string' || agent.id.length === 0) {
    return { valid: false, reason: 'MISSING_AGENT_ID' };
  }
  if (typeof plan.id !== 'string' || plan.id.length === 0) {
    return { valid: false, reason: 'MISSING_PLAN_ID' };
  }
  if (!agent.metadata?.main || !agent.metadata.agent) {
    return { valid: false, reason: 'MISSING_AGENT_METADATA' };
  }
  if (!plan.metadata?.main || !plan.metadata.plan) {
    return { valid: false, reason: 'MISSING_PLAN_METADATA' };
  }
  if (agent.metadata.main.name !== req.agent_name) {
    return { valid: false, reason: 'UNEXPECTED_AGENT_IDENTITY' };
  }
  if (plan.metadata.main.name !== req.plan_name) {
    return { valid: false, reason: 'UNEXPECTED_PLAN_IDENTITY' };
  }
  const endpoints = agent.metadata.agent.endpoints;
  if (
    !Array.isArray(endpoints) ||
    endpoints.length !== 1 ||
    endpoints[0]?.POST !== req.endpoint ||
    Object.keys(endpoints[0] ?? {}).length !== 1
  ) {
    return { valid: false, reason: 'WRONG_SERVICE_ENDPOINT' };
  }
  const linkedPlanIds = agent.registry?.plans;
  if (!Array.isArray(linkedPlanIds)) {
    return { valid: false, reason: 'MISSING_AGENT_PLAN_LINKAGE' };
  }
  if (linkedPlanIds.length !== 1 || linkedPlanIds[0] !== plan.id) {
    return { valid: false, reason: 'AGENT_PLAN_LINKAGE_MISMATCH' };
  }

  // ---- price config ----
  const price = plan.registry?.price;
  if (!price) return { valid: false, reason: 'MISSING_PRICE_CONFIG' };
  const rawAmounts = price.amounts;
  const receivers = price.receivers;
  if (
    !Array.isArray(rawAmounts) ||
    !Array.isArray(receivers) ||
    rawAmounts.length !== 2 ||
    receivers.length !== 2 ||
    rawAmounts.length !== receivers.length
  ) {
    return { valid: false, reason: 'PRICE_COMPONENT_CARDINALITY_MISMATCH' };
  }
  const amounts = rawAmounts.map(toBigIntOrNull);
  if (amounts.some((a) => a === null)) return { valid: false, reason: 'MALFORMED_PRICE_AMOUNTS' };
  const totalPrice = (amounts as bigint[]).reduce((sum, a) => sum + a, 0n);
  if (totalPrice === 0n) {
    return { valid: false, reason: 'FREE_PLAN_REJECTED' };
  }
  if (totalPrice !== req.gross_price_atomic) {
    return { valid: false, reason: 'WRONG_PRICE' };
  }
  if (price.isCrypto !== true) {
    return { valid: false, reason: 'NON_CRYPTO_PRICE_REJECTED' };
  }
  if (price.tokenAddress?.toLowerCase() !== req.token_address.toLowerCase()) {
    return { valid: false, reason: 'WRONG_TOKEN' };
  }
  if (receivers[0]?.toLowerCase() !== req.receiver.toLowerCase()) {
    return { valid: false, reason: 'WRONG_RECEIVER' };
  }
  if (receivers[1]?.toLowerCase() !== req.platform_fee_receiver.toLowerCase()) {
    return { valid: false, reason: 'UNEXPECTED_PLATFORM_FEE_RECEIVER' };
  }
  if (amounts[0] !== req.seller_net_atomic || amounts[1] !== req.platform_fee_atomic) {
    return { valid: false, reason: 'PRICE_COMPONENT_AMOUNT_MISMATCH' };
  }

  // ---- credits config ----
  const credits = plan.registry?.credits;
  if (!credits) return { valid: false, reason: 'MISSING_CREDITS_CONFIG' };
  const creditsAmount = toBigIntOrNull(credits.amount);
  const creditsMin = toBigIntOrNull(credits.minAmount);
  const creditsMax = toBigIntOrNull(credits.maxAmount);
  if (creditsAmount === null || creditsMin === null || creditsMax === null) {
    return { valid: false, reason: 'MALFORMED_CREDITS_CONFIG' };
  }
  if (credits.isRedemptionAmountFixed !== req.is_redemption_amount_fixed) {
    return { valid: false, reason: 'WRONG_REDEMPTION_FIXEDNESS' };
  }
  if (creditsMin > creditsMax) {
    return { valid: false, reason: 'MIN_EXCEEDS_MAX' };
  }
  if (creditsAmount !== req.credits_granted) {
    return { valid: false, reason: 'WRONG_CREDITS_GRANTED' };
  }
  if (creditsMin !== req.min_redemption) {
    return { valid: false, reason: 'WRONG_MINIMUM' };
  }
  if (creditsMax !== req.max_redemption) {
    return { valid: false, reason: 'WRONG_MAXIMUM' };
  }
  if (credits.redemptionType !== req.redemption_type) {
    return { valid: false, reason: 'WRONG_REDEMPTION_TYPE' };
  }
  if (credits.onchainMirror !== req.onchain_mirror) {
    return { valid: false, reason: 'WRONG_ONCHAIN_MIRROR' };
  }
  const durationSecs = toBigIntOrNull(credits.durationSecs);
  if (durationSecs === null) {
    return { valid: false, reason: 'MALFORMED_CREDITS_CONFIG' };
  }
  if (durationSecs !== req.duration_secs) {
    return { valid: false, reason: 'TIME_BASED_PLAN_REJECTED' };
  }

  // ---- access model / trial ----
  const accessLimit = plan.metadata.plan.accessLimit;
  if (accessLimit !== req.access_limit) {
    return { valid: false, reason: 'WRONG_ACCESS_MODEL' };
  }
  if (plan.metadata.plan.isTrialPlan !== false) {
    return { valid: false, reason: 'TRIAL_PLAN_REJECTED' };
  }
  if (plan.metadata.plan.recurringSubscription !== false) {
    return { valid: false, reason: 'RECURRING_PLAN_REJECTED' };
  }

  // ---- exact unit economics (BigInt only, never floating pricePerCredit) ----
  const acquisitionValue = computeCreditAcquisitionValueAtomic(totalPrice, creditsAmount);
  if (!acquisitionValue.exact || acquisitionValue.ratio !== 1n) {
    return { valid: false, reason: 'NON_UNIT_ACQUISITION_VALUE_RATIO' };
  }
  for (const [, value] of Object.entries(DOCUMENT_USAGE_TIER_VALUES_ATOMIC)) {
    if (value * acquisitionValue.ratio !== value) {
      return { valid: false, reason: 'TIER_VALUATION_MISMATCH' };
    }
  }

  return { valid: true };
}

/**
 * Adds the document plan's load-bearing service/economic read-back proof
 * to the generic registry reconciliation result. A name/linkage match is
 * necessary but never sufficient: an existing object is reusable only
 * when the authoritative agent and plan GETs validate exactly.
 *
 * This remains pure and credential-independent. The caller performs the
 * bounded reads, then passes their sanitized structural results here.
 */
export function reconcileNeverminedDocumentDynamicRegistration(
  reconciliation: NeverminedRegistrationReconciliation,
  agent?: NeverminedAgentReadback,
  plan?: NeverminedPlanReadback,
  // SUN-1000 checkpoint 1O-B: optional, defaults to v1 -- unchanged
  // behavior for every existing caller.
  requirements: DocumentDynamicPlanRequirements = DOCUMENT_DYNAMIC_PLAN_REQUIREMENTS
): NeverminedDocumentDynamicRegistrationReconciliation {
  if (reconciliation.state === 'absent') return { state: 'NO_MATCH' };
  if (reconciliation.state === 'partial') {
    return { state: 'CONFLICT', reason: 'REGISTRY_PARTIAL' };
  }
  if (reconciliation.state === 'conflicting') {
    return { state: 'CONFLICT', reason: 'REGISTRY_CONFLICTING' };
  }
  if (reconciliation.state === 'timeout') {
    return { state: 'CONFLICT', reason: 'REGISTRY_TIMEOUT' };
  }
  if (!agent || !plan) {
    return { state: 'CONFLICT', reason: 'MISSING_AUTHORITATIVE_READBACK' };
  }
  if (agent.id !== reconciliation.agentId || plan.id !== reconciliation.planId) {
    return { state: 'CONFLICT', reason: 'RECONCILIATION_READBACK_ID_MISMATCH' };
  }
  const validation = validateNeverminedDocumentDynamicPlan(agent, plan, requirements);
  if (!validation.valid) return { state: 'CONFLICT', reason: validation.reason };
  return {
    state: 'EXACT_EXISTING',
    agentId: reconciliation.agentId,
    planId: reconciliation.planId,
  };
}
