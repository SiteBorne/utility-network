/** Canonical payment rails selected by the buyer-facing route before any
 * external verification. This is deliberately distinct from evidence
 * `providerKind` (`fixture | external`), which describes trust provenance. */
export type PaymentRail = 'cdp' | 'nevermined';

/** Versioned provider implementation identities accepted at the persisted
 * protocol boundary. Arbitrary free-form provider strings are not accepted. */
export const CDP_PAYMENT_PROVIDER = 'cdp-facilitator@1.55.0' as const;
export const NEVERMINED_PAYMENT_PROVIDER = 'nevermined-payments@1.10.0' as const;

type SemanticVersion = `${number}.${number}.${number}`;
export type PaymentProviderIdentity =
  | `cdp-facilitator@${SemanticVersion}`
  | `nevermined-payments@${SemanticVersion}`;

export function providerMatchesRail(rail: PaymentRail, provider: PaymentProviderIdentity): boolean {
  return (
    (rail === 'cdp' && /^cdp-facilitator@\d+\.\d+\.\d+$/.test(provider)) ||
    (rail === 'nevermined' && /^nevermined-payments@\d+\.\d+\.\d+$/.test(provider))
  );
}
