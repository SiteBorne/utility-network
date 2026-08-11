import {
  NEVERMINED_PAYMENT_PROVIDER,
  deterministicId,
  hashPaymentObject,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';
import type { NeverminedPaymentRequired } from './client';

export { NEVERMINED_PAYMENT_PROVIDER } from '@siteborne/protocol-x402';

export const SITEBORNE_NEVERMINED_EXTENSION = 'net.siteborne.payment';

export interface NeverminedRequirementBindingInput {
  serviceId: SiteborneServiceId;
  route: string;
  quoteId: string;
  amount: string;
  semantics: 'exact' | 'upto';
  expiresAt: string;
  paymentIdentifierRequired: boolean;
}

export interface NeverminedRequirementExtension {
  version: 1;
  payment_rail: 'nevermined';
  payment_provider: typeof NEVERMINED_PAYMENT_PROVIDER;
  service_id: SiteborneServiceId;
  route: string;
  quote_id: string;
  requirement_id: string;
  amount: string;
  semantics: 'exact' | 'upto';
  expires_at: string;
  payment_identifier_required: boolean;
  production_enabled: false;
}

export async function bindNeverminedPaymentRequired(
  paymentRequired: NeverminedPaymentRequired,
  input: NeverminedRequirementBindingInput
): Promise<{ paymentRequired: NeverminedPaymentRequired; requirementId: string }> {
  if (!/^\d+$/.test(input.amount) || BigInt(input.amount) <= 0n) {
    throw new Error('Nevermined requirement amount must be a positive atomic integer');
  }
  const digest = await hashPaymentObject({
    payment_required: paymentRequired,
    version: 1,
    payment_rail: 'nevermined',
    payment_provider: NEVERMINED_PAYMENT_PROVIDER,
    service_id: input.serviceId,
    route: input.route,
    quote_id: input.quoteId,
    amount: input.amount,
    semantics: input.semantics,
    expires_at: input.expiresAt,
    payment_identifier_required: input.paymentIdentifierRequired,
    production_enabled: false,
  });
  const requirementId = deterministicId('req', digest);
  const extension: NeverminedRequirementExtension = {
    version: 1,
    payment_rail: 'nevermined',
    payment_provider: NEVERMINED_PAYMENT_PROVIDER,
    service_id: input.serviceId,
    route: input.route,
    quote_id: input.quoteId,
    requirement_id: requirementId,
    amount: input.amount,
    semantics: input.semantics,
    expires_at: input.expiresAt,
    payment_identifier_required: input.paymentIdentifierRequired,
    production_enabled: false,
  };
  return {
    requirementId,
    paymentRequired: {
      ...paymentRequired,
      extensions: { ...paymentRequired.extensions, [SITEBORNE_NEVERMINED_EXTENSION]: extension },
    },
  };
}
