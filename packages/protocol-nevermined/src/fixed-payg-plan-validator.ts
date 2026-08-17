/**
 * Authoritative Nevermined GET read-back validator for SITEBORNE's fixed
 * `nvm:erc4337` PAYG registrations.
 *
 * This module is credential-independent. It accepts already-fetched public
 * agent/plan structures and never imports or calls the Nevermined SDK. The
 * request-side identity and gross price come from `NEVERMINED_DECLARATIONS`;
 * the persisted two-component economics follow the fixed-plan model proven by
 * the frozen web registration and re-characterized immediately before
 * SUN-0900B checkpoint 2J: 99% seller / 1% Nevermined platform fee.
 */

import type { SiteborneServiceId } from '@siteborne/protocol-x402';
import { NEVERMINED_DECLARATIONS, deriveNeverminedPlanDisplayName } from './declarations';
import type {
  NeverminedAgentReadback,
  NeverminedPlanReadback,
} from './document-dynamic-plan-validator';
import type { NeverminedRegistrationReconciliation } from './registry-reconciliation';

export type NeverminedFixedPaygServiceId = Exclude<SiteborneServiceId, 'document_evidence_json.v1'>;

export const NEVERMINED_FIXED_PAYG_PERSISTENCE_MODEL = {
  seller_receiver: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
  platform_fee_receiver: '0x2020949c1B565421AC21b76e70340266c4CA9A90',
  token_address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  platform_fee_basis_points: 100n,
  basis_points_denominator: 10_000n,
  access_limit: 'credits',
  credits_amount: 1n,
  credits_min: 1n,
  credits_max: 1n,
  is_redemption_amount_fixed: false,
  redemption_type: 4,
  onchain_mirror: false,
  duration_secs: 0n,
} as const;

export interface NeverminedFixedPaygPlanRequirements {
  service_id: NeverminedFixedPaygServiceId;
  agent_name: string;
  plan_name: string;
  endpoint: string;
  gross_price_atomic: bigint;
  seller_net_atomic: bigint;
  platform_fee_atomic: bigint;
}

export type NeverminedFixedPaygPlanValidation = { valid: true } | { valid: false; reason: string };

export type NeverminedFixedPaygRegistrationReconciliation =
  | { state: 'EXACT_EXISTING'; agentId: string; planId: string }
  | { state: 'NO_MATCH' }
  | { state: 'CONFLICT'; reason: string };

function assertFixedServiceId(serviceId: SiteborneServiceId): NeverminedFixedPaygServiceId {
  if (serviceId === 'document_evidence_json.v1') {
    throw new Error('document_evidence_json.v1 is not a fixed PAYG service');
  }
  return serviceId;
}

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

export function resolveNeverminedFixedPaygPlanRequirements(
  serviceId: SiteborneServiceId
): NeverminedFixedPaygPlanRequirements {
  const fixedServiceId = assertFixedServiceId(serviceId);
  const declaration = NEVERMINED_DECLARATIONS[fixedServiceId];
  const grossPriceAtomic = BigInt(declaration.plan.gross_buyer_amount_atomic);
  const model = NEVERMINED_FIXED_PAYG_PERSISTENCE_MODEL;
  const feeNumerator = grossPriceAtomic * model.platform_fee_basis_points;
  if (feeNumerator % model.basis_points_denominator !== 0n) {
    throw new Error(`fixed PAYG gross price for ${fixedServiceId} cannot be represented exactly`);
  }
  const platformFeeAtomic = feeNumerator / model.basis_points_denominator;
  // SUN-1000 checkpoint 1O-B: agent_name/plan_name now use the
  // registration-specific display name (unique per service-major),
  // never the plain, major-agnostic `title` -- see
  // deriveNeverminedAgentDisplayName's own module doc for why.
  const agentName = declaration.agent.nevermined_display_name;
  return {
    service_id: fixedServiceId,
    agent_name: agentName,
    plan_name: deriveNeverminedPlanDisplayName(fixedServiceId, agentName),
    endpoint: `https://utility.siteborne.net${declaration.agent.endpoint}`,
    gross_price_atomic: grossPriceAtomic,
    seller_net_atomic: grossPriceAtomic - platformFeeAtomic,
    platform_fee_atomic: platformFeeAtomic,
  };
}

export function validateNeverminedFixedPaygPlan(
  serviceId: SiteborneServiceId,
  agent: NeverminedAgentReadback,
  plan: NeverminedPlanReadback
): NeverminedFixedPaygPlanValidation {
  const req = resolveNeverminedFixedPaygPlanRequirements(serviceId);
  const model = NEVERMINED_FIXED_PAYG_PERSISTENCE_MODEL;

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
  if (amounts.some((amount) => amount === null)) {
    return { valid: false, reason: 'MALFORMED_PRICE_AMOUNTS' };
  }
  const [sellerAmount, platformAmount] = amounts as [bigint, bigint];
  const total = sellerAmount + platformAmount;
  if (total === 0n) return { valid: false, reason: 'FREE_PLAN_REJECTED' };
  if (total !== req.gross_price_atomic) return { valid: false, reason: 'WRONG_PRICE' };
  if (sellerAmount !== req.seller_net_atomic || platformAmount !== req.platform_fee_atomic) {
    return { valid: false, reason: 'PRICE_COMPONENT_AMOUNT_MISMATCH' };
  }
  if (receivers[0]?.toLowerCase() !== model.seller_receiver.toLowerCase()) {
    return { valid: false, reason: 'WRONG_RECEIVER' };
  }
  if (receivers[1]?.toLowerCase() !== model.platform_fee_receiver.toLowerCase()) {
    return { valid: false, reason: 'UNEXPECTED_PLATFORM_FEE_RECEIVER' };
  }
  if (price.tokenAddress?.toLowerCase() !== model.token_address.toLowerCase()) {
    return { valid: false, reason: 'WRONG_TOKEN' };
  }
  if (price.isCrypto !== true) return { valid: false, reason: 'NON_CRYPTO_PRICE_REJECTED' };

  const credits = plan.registry?.credits;
  if (!credits) return { valid: false, reason: 'MISSING_CREDITS_CONFIG' };
  const amount = toBigIntOrNull(credits.amount);
  const min = toBigIntOrNull(credits.minAmount);
  const max = toBigIntOrNull(credits.maxAmount);
  const duration = toBigIntOrNull(credits.durationSecs);
  if (amount === null || min === null || max === null || duration === null) {
    return { valid: false, reason: 'MALFORMED_CREDITS_CONFIG' };
  }
  if (amount !== model.credits_amount || min !== model.credits_min || max !== model.credits_max) {
    return { valid: false, reason: 'WRONG_PAYG_CREDITS_CONFIG' };
  }
  if (credits.isRedemptionAmountFixed !== model.is_redemption_amount_fixed) {
    return { valid: false, reason: 'WRONG_REDEMPTION_FIXEDNESS' };
  }
  if (credits.redemptionType !== model.redemption_type) {
    return { valid: false, reason: 'WRONG_REDEMPTION_TYPE' };
  }
  if (credits.onchainMirror !== model.onchain_mirror) {
    return { valid: false, reason: 'WRONG_ONCHAIN_MIRROR' };
  }
  if (duration !== model.duration_secs) {
    return { valid: false, reason: 'TIME_BASED_PLAN_REJECTED' };
  }

  if (plan.metadata.plan.accessLimit !== model.access_limit) {
    return { valid: false, reason: 'WRONG_ACCESS_MODEL' };
  }
  if (plan.metadata.plan.isTrialPlan !== false) {
    return { valid: false, reason: 'TRIAL_PLAN_REJECTED' };
  }
  if (plan.metadata.plan.recurringSubscription !== false) {
    return { valid: false, reason: 'RECURRING_PLAN_REJECTED' };
  }
  return { valid: true };
}

export function reconcileNeverminedFixedPaygRegistration(
  serviceId: SiteborneServiceId,
  reconciliation: NeverminedRegistrationReconciliation,
  agent?: NeverminedAgentReadback,
  plan?: NeverminedPlanReadback
): NeverminedFixedPaygRegistrationReconciliation {
  assertFixedServiceId(serviceId);
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
  const validation = validateNeverminedFixedPaygPlan(serviceId, agent, plan);
  if (!validation.valid) return { state: 'CONFLICT', reason: validation.reason };
  return {
    state: 'EXACT_EXISTING',
    agentId: reconciliation.agentId,
    planId: reconciliation.planId,
  };
}
