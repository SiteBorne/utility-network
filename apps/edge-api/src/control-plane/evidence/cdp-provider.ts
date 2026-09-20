/**
 * SUN-0700B checkpoint 1 — the real, credential-dependent
 * `PaymentEvidenceProvider` implementation, built against the seam
 * `packages/protocol-x402/src/evidence/provider.ts` widened for in
 * `af195f6` (ADR 0052). This file is the one place in the whole
 * repository that talks to a real CDP facilitator — never
 * `@siteborne/protocol-x402` (which stays credential-independent per ADR
 * 0041), and never mounted anywhere by default (see paid-services.ts /
 * index.ts's `evidenceMode` gate, still hardcoded `'fixture'`
 * everywhere outside this checkpoint's own live test).
 *
 * `providerKind: 'external'` — eligible for `production` mode selection
 * per `resolvePaymentEvidenceProvider`, but selection alone proves
 * nothing: the evidence this class returns must still separately pass
 * `canAdvanceToVerified`/`canAdvanceToSettled`'s trust-class gate, same
 * as any other provider.
 */
import type { HTTPFacilitatorClient } from '@x402/core/server';
import type { SettleResponse, SupportedResponse, VerifyResponse } from '@x402/core/types';
import {
  hashPaymentObject,
  isCdpPaymentAuthorizationContext,
  type ExternalSettlementEvidence,
  type ExternalVerificationEvidence,
  type Network,
  type PaymentEvidenceProvider,
  type PaymentSettlementContext,
  type PaymentVerificationContext,
} from '@siteborne/protocol-x402';

import {
  classifyFacilitatorVerifyFailure,
  FACILITATOR_ANSWERED_INVALID,
  FacilitatorAuthStageError,
} from './cdp-facilitator-failure';

const CDP_VERIFIER_IDENTITY = 'cdp:facilitator';

function errorRecord(error: unknown): Record<string, unknown> | undefined {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)
    : undefined;
}

/** Accept only compact machine-readable facilitator codes. Never fall
 * back to Error.message/invalidMessage/errorMessage, which are free-form
 * and may contain payment authorization diagnostics. */
function safeReasonCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : undefined;
}

function safePayer(value: unknown): string | undefined {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : undefined;
}

function isFacilitatorHttpFailure(record: Record<string, unknown> | undefined): boolean {
  return (
    typeof record?.statusCode === 'number' &&
    Number.isInteger(record.statusCode) &&
    record.statusCode >= 400 &&
    record.statusCode <= 599
  );
}

/** Behaviour-neutral view of the facilitator client whose only difference is
 * that a failure while building auth headers (JWT minting) is rethrown as a
 * `FacilitatorAuthStageError`, so it can be told apart from a later `fetch`
 * failure. Same headers, same request, same throw; verify-only. */
function tagAuthStage(facilitator: HTTPFacilitatorClient): HTTPFacilitatorClient {
  if (typeof facilitator.createAuthHeaders !== 'function') return facilitator;
  const tagged = Object.create(facilitator) as HTTPFacilitatorClient;
  tagged.createAuthHeaders = async (path: string) => {
    try {
      return await facilitator.createAuthHeaders(path);
    } catch (error) {
      throw new FacilitatorAuthStageError(error);
    }
  };
  return tagged;
}

export class CdpPaymentEvidenceProvider implements PaymentEvidenceProvider {
  readonly providerKind = 'external' as const;
  private readonly verifyFacilitator: HTTPFacilitatorClient;

  constructor(private readonly facilitator: HTTPFacilitatorClient) {
    this.verifyFacilitator = tagAuthStage(facilitator);
  }

  /**
   * Calls the real facilitator's `/verify` with the exact
   * `paymentPayload`/`paymentRequirements` the HTTP boundary already
   * structurally validated (never re-derived). Always returns
   * `trust_class: 'external_verified'` — that describes the evidence's
   * *provenance* (a real facilitator answered), not its outcome; a
   * rejection is represented by `verified: false` + `reason`, exactly
   * like `FixturePaymentEvidenceProvider`'s pattern, and is still
   * evaluated by the unchanged `canAdvanceToVerified` gate.
   */
  async verify(context: PaymentVerificationContext): Promise<ExternalVerificationEvidence> {
    if (!isCdpPaymentAuthorizationContext(context)) {
      throw new Error('cdp provider received a non-CDP authorization context');
    }
    let response: VerifyResponse;
    try {
      response = await this.verifyFacilitator.verify(
        context.paymentPayload,
        context.paymentRequirements
      );
    } catch (error) {
      const classification = classifyFacilitatorVerifyFailure(error);
      const record = errorRecord(error);
      const invalidReason = safeReasonCode(record?.invalidReason);
      const payer = safePayer(record?.payer);
      const facilitatorAnswered = isFacilitatorHttpFailure(record) && invalidReason !== undefined;
      const reason = invalidReason ?? 'facilitator_verify_unavailable';
      const raw_evidence_hash = await hashPaymentObject({
        kind: 'cdp_verify_response',
        quote_id: context.quote_id,
        requirement_id: context.requirement_id,
        payment_identifier: context.payment_identifier,
        isValid: false,
        invalidReason: reason,
        payer: payer ?? null,
      });
      return {
        x402_version: 2,
        scheme: context.scheme,
        network: context.network,
        quote_id: context.quote_id,
        requirement_id: context.requirement_id,
        payment_identifier: context.payment_identifier,
        verified: false,
        payer,
        reason,
        verifier_identity: CDP_VERIFIER_IDENTITY,
        evidence_timestamp: context.nowIso,
        raw_evidence_hash,
        trust_class: facilitatorAnswered ? 'external_verified' : 'external_unverified',
        subreason: classification.subreason,
        ...(classification.transport_status !== undefined
          ? { transport_status: classification.transport_status }
          : {}),
        retryability: classification.retryability,
        ...(classification.jwt_subreason !== undefined
          ? { jwt_subreason: classification.jwt_subreason }
          : {}),
      };
    }
    const raw_evidence_hash = await hashPaymentObject({
      kind: 'cdp_verify_response',
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      isValid: response.isValid,
      invalidReason: response.invalidReason ?? null,
      payer: response.payer ?? null,
    });
    return {
      x402_version: 2,
      scheme: context.scheme,
      network: context.network,
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      verified: response.isValid,
      payer: response.payer,
      reason: response.isValid ? undefined : (response.invalidReason ?? 'facilitator_rejected'),
      verifier_identity: CDP_VERIFIER_IDENTITY,
      evidence_timestamp: context.nowIso,
      raw_evidence_hash,
      trust_class: 'external_verified',
      ...(response.isValid
        ? {}
        : {
            subreason: FACILITATOR_ANSWERED_INVALID.subreason,
            retryability: FACILITATOR_ANSWERED_INVALID.retryability,
          }),
    };
  }

  /**
   * Calls the real facilitator's `/settle` with the same signed
   * `paymentPayload` that `/verify` received. For `exact`, the selected
   * requirements object is forwarded unchanged. For `upto`, the signed
   * payload continues to authorize its original maximum while a shallow
   * settlement-only requirements copy carries the measured actual amount,
   * as required by the official x402 upto facilitator contract.
   */
  async settle(
    context: PaymentSettlementContext,
    verificationEvidence: ExternalVerificationEvidence,
    actualAmount: string
  ): Promise<ExternalSettlementEvidence> {
    if (!isCdpPaymentAuthorizationContext(context)) {
      throw new Error('cdp provider received a non-CDP authorization context');
    }
    const verification_evidence_hash = await hashPaymentObject(verificationEvidence);
    const facilitatorRequirements =
      context.scheme === 'upto'
        ? { ...context.paymentRequirements, amount: actualAmount }
        : context.paymentRequirements;
    let response: SettleResponse;
    try {
      response = await this.facilitator.settle(context.paymentPayload, facilitatorRequirements);
    } catch (error) {
      const record = errorRecord(error);
      const errorReason = safeReasonCode(record?.errorReason);
      const payer = safePayer(record?.payer);
      const facilitatorAnswered = isFacilitatorHttpFailure(record) && errorReason !== undefined;
      const reason = errorReason ?? 'facilitator_settlement_unavailable';
      const raw_evidence_hash = await hashPaymentObject({
        kind: 'cdp_settle_response',
        quote_id: context.quote_id,
        requirement_id: context.requirement_id,
        payment_identifier: context.payment_identifier,
        success: false,
        transaction: null,
        network: context.network,
        amount: null,
        payer: payer ?? null,
        errorReason: reason,
      });
      return {
        x402_version: 2,
        scheme: context.scheme,
        network: context.network,
        asset: context.asset,
        payer,
        payee: context.payee,
        actual_amount: actualAmount,
        quote_id: context.quote_id,
        requirement_id: context.requirement_id,
        payment_identifier: context.payment_identifier,
        success: false,
        reason,
        settled_at: context.nowIso,
        facilitator_identity: CDP_VERIFIER_IDENTITY,
        raw_evidence_hash,
        verification_evidence_hash,
        trust_class: facilitatorAnswered ? 'external_verified' : 'external_unverified',
        ...(context.usageResult
          ? {
              authorized_maximum: context.paymentRequirements.amount,
              usage_result_hash: context.usageResult.usage_result_hash,
            }
          : {}),
      };
    }
    const settlementFailure = !response.success
      ? (response.errorReason ?? 'settlement_failed')
      : response.network !== context.network
        ? 'settlement_network_mismatch'
        : response.amount !== undefined && response.amount !== actualAmount
          ? 'settlement_amount_mismatch'
          : response.transaction.trim().length === 0
            ? 'settlement_transaction_missing'
            : undefined;
    const raw_evidence_hash = await hashPaymentObject({
      kind: 'cdp_settle_response',
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      success: response.success,
      transaction: response.transaction ?? null,
      network: response.network,
      amount: response.amount ?? null,
      payer: response.payer ?? null,
      errorReason: response.errorReason ?? null,
    });
    return {
      x402_version: 2,
      scheme: context.scheme,
      network: context.network,
      asset: context.asset,
      payer: response.payer,
      payee: context.payee,
      actual_amount: actualAmount,
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      transaction_reference: response.transaction,
      success: response.success && settlementFailure === undefined,
      reason: settlementFailure,
      settled_at: context.nowIso,
      facilitator_identity: CDP_VERIFIER_IDENTITY,
      raw_evidence_hash,
      verification_evidence_hash,
      trust_class: 'external_verified',
      ...(context.usageResult
        ? {
            authorized_maximum: context.paymentRequirements.amount,
            usage_result_hash: context.usageResult.usage_result_hash,
          }
        : {}),
    };
  }
}

export interface CdpSupportedCheckResult {
  ok: boolean;
  reason?: string;
  /** Sanitized (network/scheme pairs only, no credentials, no raw
   * facilitator response) — safe to log or include in a report. */
  kinds: { scheme: string; network: string }[];
  /** Public EVM address required in an upto Permit2 witness. Present only
   * after strict address validation. */
  uptoFacilitatorAddress?: string;
}

/**
 * The first, and only gating, live call this checkpoint makes before any
 * activation decision or payment attempt (directive §4). Queries the
 * real facilitator's `/supported` and checks that every scheme in
 * `requiredSchemes` is advertised for `network`. Never throws for an
 * ordinary "not supported" outcome — that's `ok: false` with a `reason`,
 * for the caller to report and stop on, per directive §6.
 */
export async function checkCdpSupportsNetwork(
  facilitator: HTTPFacilitatorClient,
  network: Network,
  requiredSchemes: string[]
): Promise<CdpSupportedCheckResult> {
  const supported: SupportedResponse = await facilitator.getSupported();
  const kinds = supported.kinds.map((k) => ({ scheme: k.scheme, network: k.network }));
  const missing = requiredSchemes.filter(
    (scheme) => !kinds.some((k) => k.network === network && k.scheme === scheme)
  );
  const uptoKind = supported.kinds.find(
    (kind) => kind.x402Version === 2 && kind.network === network && kind.scheme === 'upto'
  );
  const uptoFacilitatorAddress = safePayer(uptoKind?.extra?.facilitatorAddress);
  const missingUptoAddress =
    requiredSchemes.includes('upto') &&
    missing.length === 0 &&
    uptoFacilitatorAddress === undefined;
  return {
    ok: missing.length === 0 && !missingUptoAddress,
    reason:
      missing.length > 0
        ? `facilitator does not advertise scheme(s) [${missing.join(', ')}] for network "${network}"`
        : missingUptoAddress
          ? `facilitator upto capability is missing a valid facilitatorAddress for network "${network}"`
          : undefined,
    kinds,
    ...(uptoFacilitatorAddress ? { uptoFacilitatorAddress } : {}),
  };
}
