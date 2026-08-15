/** Nevermined request-time payment evidence boundary.
 *
 * The public constructor is deliberately closed. Deterministic callers may
 * create only a fixture provider; the external provider can be created only
 * through the official SDK path after the explicit sandbox live guard passes.
 * Neither access tokens nor API keys enter evidence, persistence, or errors.
 */
import {
  Payments,
  type SettlePermissionsParams,
  type SettlePermissionsResult,
  type VerifyPermissionsParams,
  type VerifyPermissionsResult,
  type X402PaymentRequired,
} from '@nevermined-io/payments';
import {
  NEVERMINED_PAYMENT_PROVIDER,
  evaluateNeverminedLiveGuard,
  sanitizeNeverminedSettlement,
  sanitizeNeverminedVerification,
  validateNeverminedAccessToken,
  validateNeverminedPaymentRequired,
  validateNeverminedSettlementResult,
  validateNeverminedVerificationResult,
  type NeverminedFacilitatorClient,
  type NeverminedSettlePermissionsInput,
  type NeverminedSettlementResult,
  type NeverminedSettlementEvidenceCarrier,
  type NeverminedVerificationResult,
  type NeverminedVerifyPermissionsInput,
} from '@siteborne/protocol-nevermined';
import {
  hashPaymentObject,
  isNeverminedPaymentAuthorizationContext,
  type ExternalSettlementEvidence,
  type ExternalVerificationEvidence,
  type PaymentEvidenceProvider,
  type PaymentSettlementContext,
  type PaymentVerificationContext,
} from '@siteborne/protocol-x402';

type TrustSource = 'authenticated_sdk' | 'fixture';

export interface AuthenticatedNeverminedProviderOptions {
  apiKey: string;
  environment: 'sandbox';
  liveGuard: {
    runLiveNevermined: string | undefined;
    apiKeyEnvironment: 'sandbox' | 'live' | 'unknown';
  };
}

class OfficialNeverminedSdkAdapter implements NeverminedFacilitatorClient {
  constructor(
    private readonly facilitator: {
      verifyPermissions(input: VerifyPermissionsParams): Promise<VerifyPermissionsResult>;
      settlePermissions(input: SettlePermissionsParams): Promise<SettlePermissionsResult>;
    }
  ) {}

  async verifyPermissions(
    input: NeverminedVerifyPermissionsInput
  ): Promise<NeverminedVerificationResult> {
    const result = await this.facilitator.verifyPermissions({
      paymentRequired: input.paymentRequired as X402PaymentRequired,
      x402AccessToken: input.accessToken,
      maxAmount: BigInt(input.authorizedMaximum),
    });
    return {
      isValid: result.isValid,
      invalidReason: result.invalidReason,
      payer: result.payer,
      network: result.network,
      agentRequestId: result.agentRequestId,
    };
  }

  async settlePermissions(
    input: NeverminedSettlePermissionsInput
  ): Promise<NeverminedSettlementResult> {
    const result = await this.facilitator.settlePermissions({
      paymentRequired: input.paymentRequired as X402PaymentRequired,
      x402AccessToken: input.accessToken,
      maxAmount: BigInt(input.actualAmount),
      ...(input.agentRequestId ? { agentRequestId: input.agentRequestId } : {}),
    });
    return {
      success: result.success,
      errorReason: result.errorReason,
      payer: result.payer,
      transaction: result.transaction,
      network: result.network,
      creditsRedeemed: result.creditsRedeemed,
      remainingBalance: result.remainingBalance,
    };
  }
}

function trustClass(source: TrustSource, providerAnswered: boolean) {
  if (source === 'fixture') return 'synthetic_fixture' as const;
  return providerAnswered ? ('external_verified' as const) : ('external_unverified' as const);
}

function safeReason(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : fallback;
}

function paymentRequiredResource(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const resource = (value as { resource?: unknown }).resource;
  if (!resource || typeof resource !== 'object') return undefined;
  const url = (resource as { url?: unknown }).url;
  return typeof url === 'string' ? url : undefined;
}

export class NeverminedPaymentEvidenceProvider implements PaymentEvidenceProvider {
  readonly providerKind: 'fixture' | 'external';
  private readonly requestIds = new Map<string, string>();

  private constructor(
    private readonly client: NeverminedFacilitatorClient,
    private readonly source: TrustSource
  ) {
    this.providerKind = source === 'authenticated_sdk' ? 'external' : 'fixture';
  }

  /** The only injectable client path. Its evidence can never be external. */
  static fixture(client: NeverminedFacilitatorClient): NeverminedPaymentEvidenceProvider {
    return new NeverminedPaymentEvidenceProvider(client, 'fixture');
  }

  /** The only external-trust path. SDK construction happens here, never at import. */
  static authenticated(
    options: AuthenticatedNeverminedProviderOptions
  ): NeverminedPaymentEvidenceProvider {
    const guard = evaluateNeverminedLiveGuard({
      runLiveNevermined: options.liveGuard.runLiveNevermined,
      environment: options.environment,
      apiKeyEnvironment: options.liveGuard.apiKeyEnvironment,
    });
    if (!guard.allowed) throw new Error('nevermined_live_guard_denied');
    const payments = Payments.getInstance({
      nvmApiKey: options.apiKey,
      environment: options.environment,
    });
    return new NeverminedPaymentEvidenceProvider(
      new OfficialNeverminedSdkAdapter(payments.facilitator),
      'authenticated_sdk'
    );
  }

  async verify(context: PaymentVerificationContext): Promise<ExternalVerificationEvidence> {
    if (!isNeverminedPaymentAuthorizationContext(context)) {
      throw new Error('nevermined provider received a non-Nevermined authorization context');
    }
    const auth = context.authorizationContext;
    const resource = paymentRequiredResource(auth.paymentRequired);
    const token = validateNeverminedAccessToken(auth.accessToken);
    const required = resource
      ? validateNeverminedPaymentRequired(auth.paymentRequired, {
          resource,
          network: context.network,
          agentId: auth.agentId,
          planId: auth.planId,
          serviceId: context.service_id,
          quoteId: context.quote_id,
          requirementId: context.requirement_id,
          amount: context.amount,
          semantics: context.scheme,
          expiresAt: context.expiresAt,
        })
      : { valid: false as const, reason: 'invalid_payment_required' as const };
    if (token.status !== 'valid' || !required.valid) {
      return this.verificationFailure(context, 'authorization_invalid', false);
    }

    let result: NeverminedVerificationResult;
    try {
      result = await this.client.verifyPermissions({
        paymentRequired: required.paymentRequired,
        accessToken: auth.accessToken,
        authorizedMaximum: context.amount,
      });
    } catch {
      return this.verificationFailure(context, 'provider_exception', false);
    }

    const validation = validateNeverminedVerificationResult(result, { network: context.network });
    const sanitized = await sanitizeNeverminedVerification(
      {
        paymentIdentifier: context.payment_identifier,
        agentId: auth.agentId,
        planId: auth.planId,
        observedAt: context.nowIso,
      },
      result
    );
    const verified = validation.valid;
    if (verified && result.agentRequestId) {
      this.requestIds.set(context.payment_identifier, result.agentRequestId);
    }
    return {
      x402_version: 2,
      scheme: context.scheme,
      network: context.network,
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      verified,
      payer: verified ? result.payer : undefined,
      reason: verified ? undefined : safeReason(validation.reason, 'provider_rejected'),
      verifier_identity: NEVERMINED_PAYMENT_PROVIDER,
      evidence_timestamp: context.nowIso,
      raw_evidence_hash: sanitized.evidence_hash,
      trust_class: trustClass(this.source, true),
    };
  }

  async settle(
    context: PaymentSettlementContext,
    verificationEvidence: ExternalVerificationEvidence,
    actualAmount: string
  ): Promise<ExternalSettlementEvidence> {
    if (!isNeverminedPaymentAuthorizationContext(context)) {
      throw new Error('nevermined provider received a non-Nevermined authorization context');
    }
    const verification_evidence_hash = await hashPaymentObject(verificationEvidence);
    if (
      !/^\d+$/.test(actualAmount) ||
      !/^\d+$/.test(context.amount) ||
      BigInt(actualAmount) > BigInt(context.amount)
    ) {
      return this.settlementFailure(
        context,
        verification_evidence_hash,
        actualAmount,
        'authorization_exceeded',
        false
      );
    }
    const auth = context.authorizationContext;
    const resource = paymentRequiredResource(auth.paymentRequired);
    const token = validateNeverminedAccessToken(auth.accessToken);
    const required = resource
      ? validateNeverminedPaymentRequired(auth.paymentRequired, {
          resource,
          network: context.network,
          agentId: auth.agentId,
          planId: auth.planId,
          serviceId: context.service_id,
          quoteId: context.quote_id,
          requirementId: context.requirement_id,
          amount: context.amount,
          semantics: context.scheme,
          expiresAt: context.expiresAt,
        })
      : { valid: false as const, reason: 'invalid_payment_required' as const };
    if (token.status !== 'valid' || !required.valid) {
      return this.settlementFailure(
        context,
        verification_evidence_hash,
        actualAmount,
        'authorization_invalid',
        false
      );
    }

    let result: NeverminedSettlementResult;
    try {
      result = await this.client.settlePermissions({
        paymentRequired: required.paymentRequired,
        accessToken: auth.accessToken,
        authorizedMaximum: context.amount,
        actualAmount,
        agentRequestId: this.requestIds.get(context.payment_identifier),
      });
    } catch {
      return this.settlementFailure(
        context,
        verification_evidence_hash,
        actualAmount,
        'provider_exception',
        false
      );
    }
    const validation = validateNeverminedSettlementResult(result, {
      payer: verificationEvidence.payer ?? '',
      network: context.network,
      actualAmount,
    });
    const transactionValid =
      this.source === 'authenticated_sdk'
        ? /^0x[0-9a-fA-F]{64}$/.test(result.transaction)
        : /^fixture:[A-Za-z0-9_.:-]{1,220}$/.test(result.transaction);
    const sanitized = await sanitizeNeverminedSettlement(
      {
        paymentIdentifier: context.payment_identifier,
        agentId: auth.agentId,
        planId: auth.planId,
        observedAt: context.nowIso,
      },
      result
    );
    this.requestIds.delete(context.payment_identifier);
    const evidence: ExternalSettlementEvidence & NeverminedSettlementEvidenceCarrier = {
      x402_version: 2,
      scheme: context.scheme,
      network: context.network,
      asset: context.asset,
      payer: result.payer,
      payee: context.payee,
      actual_amount: actualAmount,
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      transaction_reference: result.transaction || undefined,
      success: validation.valid && transactionValid,
      reason:
        validation.valid && !transactionValid
          ? 'transaction_reference_invalid'
          : validation.valid
            ? undefined
            : safeReason(validation.reason, 'provider_rejected'),
      settled_at: context.nowIso,
      facilitator_identity: NEVERMINED_PAYMENT_PROVIDER,
      raw_evidence_hash: sanitized.evidence_hash,
      verification_evidence_hash,
      trust_class: trustClass(this.source, true),
      nevermined_settlement_observation: {
        credits_redeemed: result.creditsRedeemed ?? null,
        remaining_balance: result.remainingBalance ?? null,
        transaction: result.transaction,
      },
      ...(context.usageResult
        ? {
            authorized_maximum: context.amount,
            usage_result_hash: context.usageResult.usage_result_hash,
          }
        : {}),
    };
    return evidence;
  }

  private async verificationFailure(
    context: PaymentVerificationContext,
    reason: string,
    providerAnswered: boolean
  ): Promise<ExternalVerificationEvidence> {
    return {
      x402_version: 2,
      scheme: context.scheme,
      network: context.network,
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      verified: false,
      reason,
      verifier_identity: NEVERMINED_PAYMENT_PROVIDER,
      evidence_timestamp: context.nowIso,
      raw_evidence_hash: await hashPaymentObject({
        kind: 'nevermined_verify_failure',
        quote_id: context.quote_id,
        requirement_id: context.requirement_id,
        payment_identifier: context.payment_identifier,
        reason,
      }),
      trust_class: trustClass(this.source, providerAnswered),
    };
  }

  private async settlementFailure(
    context: PaymentSettlementContext,
    verificationEvidenceHash: string,
    actualAmount: string,
    reason: string,
    providerAnswered: boolean
  ): Promise<ExternalSettlementEvidence> {
    return {
      x402_version: 2,
      scheme: context.scheme,
      network: context.network,
      asset: context.asset,
      payee: context.payee,
      actual_amount: actualAmount,
      quote_id: context.quote_id,
      requirement_id: context.requirement_id,
      payment_identifier: context.payment_identifier,
      success: false,
      reason,
      settled_at: context.nowIso,
      facilitator_identity: NEVERMINED_PAYMENT_PROVIDER,
      raw_evidence_hash: await hashPaymentObject({
        kind: 'nevermined_settle_failure',
        quote_id: context.quote_id,
        requirement_id: context.requirement_id,
        payment_identifier: context.payment_identifier,
        actual_amount: actualAmount,
        reason,
      }),
      verification_evidence_hash: verificationEvidenceHash,
      trust_class: trustClass(this.source, providerAnswered),
      ...(context.usageResult
        ? {
            authorized_maximum: context.amount,
            usage_result_hash: context.usageResult.usage_result_hash,
          }
        : {}),
    };
  }
}
