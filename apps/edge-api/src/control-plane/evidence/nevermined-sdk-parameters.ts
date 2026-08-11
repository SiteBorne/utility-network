import type {
  SettlePermissionsParams,
  VerifyPermissionsParams,
  X402PaymentRequired,
} from '@nevermined-io/payments';
import type {
  NeverminedSettlePermissionsInput,
  NeverminedVerifyPermissionsInput,
} from '@siteborne/protocol-nevermined';

function atomicAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error('invalid Nevermined atomic amount');
  return BigInt(value);
}

/** Pure SDK boundary mapping. It neither initializes Payments nor invokes a
 * provider method; the injected provider itself belongs to Checkpoint 2. */
export function toNeverminedVerifyPermissionsParams(
  input: NeverminedVerifyPermissionsInput
): VerifyPermissionsParams {
  const paymentRequired: X402PaymentRequired = input.paymentRequired;
  return {
    paymentRequired,
    x402AccessToken: input.accessToken,
    maxAmount: atomicAmount(input.authorizedMaximum),
  };
}

/** Dynamic settlement is deliberately mapped from actualAmount, never the
 * authorization ceiling. */
export function toNeverminedSettlePermissionsParams(
  input: NeverminedSettlePermissionsInput
): SettlePermissionsParams {
  const paymentRequired: X402PaymentRequired = input.paymentRequired;
  return {
    paymentRequired,
    x402AccessToken: input.accessToken,
    maxAmount: atomicAmount(input.actualAmount),
    agentRequestId: input.agentRequestId,
  };
}
