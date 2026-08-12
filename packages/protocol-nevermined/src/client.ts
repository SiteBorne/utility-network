/** Credential-independent structural counterpart of the installed SDK's
 * X402PaymentRequired. Runtime values reach this type only through the
 * fail-closed validator. */
export interface NeverminedPaymentRequired {
  x402Version: 2;
  resource: { url: string; description?: string; mimeType?: string };
  accepts: Array<{
    scheme: 'nvm:erc4337';
    network: string;
    planId: string;
    extra?: { version?: string; agentId?: string; httpVerb?: string };
  }>;
  extensions: Record<string, unknown>;
  error?: string;
}

/** Credential-independent, SITEBORNE-domain requests. The edge mapper converts
 * these to the official SDK's VerifyPermissionsParams and
 * SettlePermissionsParams; this package does not import the SDK at runtime. */
export interface NeverminedVerifyPermissionsInput {
  paymentRequired: NeverminedPaymentRequired;
  accessToken: string;
  authorizedMaximum: string;
}

export interface NeverminedSettlePermissionsInput extends NeverminedVerifyPermissionsInput {
  actualAmount: string;
  agentRequestId?: string;
}

export interface NeverminedVerificationResult {
  /** Provider results may contain additional SDK fields. The evidence boundary
   * below deliberately projects only the bounded public fields declared here. */
  readonly [providerField: string]: unknown;
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  network?: string;
  agentRequestId?: string;
}

export interface NeverminedSettlementResult {
  /** Provider results may contain additional SDK fields. The evidence boundary
   * below deliberately projects only the bounded public fields declared here. */
  readonly [providerField: string]: unknown;
  /** Optional at runtime, unlike the official SDK's declared (non-optional)
   * `success: boolean` — observed absent on two independently-confirmed
   * real ERC-4337 settlements (SUN-0900B checkpoint 1B; both later
   * verified `status: "succeeded"` via `GET
   * /delegation/{id}/transactions`). Nevermined's own official
   * TypeScript integration guide never inspects this field either — it
   * treats a resolved `settlePermissions()` call plus a real
   * `settlement.txHash` as sufficient. See
   * `validateNeverminedSettlementResult`'s normalizer. */
  success?: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  /** Optional, matching the official SDK's own SettlePermissionsResult —
   * observed absent on an otherwise-genuine real sandbox settlement
   * (SUN-0900B checkpoint 1B). See validateNeverminedSettlementResult. */
  network?: string;
  creditsRedeemed?: string;
  remainingBalance?: string;
}

/** Bounded public response emitted by SITEBORNE after a validated settlement.
 * Provider-only fields such as orderTx are deliberately not representable. */
export interface NeverminedPaymentResponse {
  success: boolean;
  payer?: string;
  transaction: string;
  network: string;
  creditsRedeemed?: string;
  remainingBalance?: string;
  agentRequestId?: string;
}

/** Narrow request-time interface implemented by the future edge-api SDK
 * adapter. */
export interface NeverminedFacilitatorClient {
  verifyPermissions(input: NeverminedVerifyPermissionsInput): Promise<NeverminedVerificationResult>;
  settlePermissions(input: NeverminedSettlePermissionsInput): Promise<NeverminedSettlementResult>;
}

/** Registration stays separate from request-time verification/settlement. */
export interface NeverminedRegistrationClient {
  registerAgent(input: unknown): Promise<{ agentId: string }>;
  registerPayAsYouGoPlan(input: unknown): Promise<{ planId: string }>;
}
