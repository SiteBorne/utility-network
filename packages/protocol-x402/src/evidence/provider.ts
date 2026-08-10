/**
 * The external payment-evidence boundary as an explicit seam (SUN-0700A
 * checkpoint 5, directive §16-17). `PaymentEvidenceProvider` is the one
 * interface a paid HTTP route calls through for verification/settlement
 * evidence — it never calls a facilitator, evidence fixture generator, or
 * anything else directly.
 *
 * `FixturePaymentEvidenceProvider` is the only implementation in this
 * package: it produces exclusively `synthetic_fixture`-trust-class
 * evidence (`evidence/fixtures.ts`) and is intentionally named to make
 * clear it is not a live verifier — never `LiveFacilitatorProvider` or
 * similar. A production evidence provider (one that could produce
 * `external_verified` evidence from a real facilitator) is **not
 * implemented** anywhere in this package; `resolvePaymentEvidenceProvider`
 * fails closed in `production` mode rather than silently falling back to
 * the fixture provider.
 */
import { hashPaymentObject } from '../canonical';
import type { PaymentEvidenceMode } from './policy';
import type {
  ExternalSettlementEvidence,
  ExternalVerificationEvidence,
  PaymentEvidenceContext,
} from './types';
import {
  syntheticSettlementEvidenceSuccess,
  syntheticVerificationEvidenceSuccess,
} from './fixtures';

export interface PaymentEvidenceProvider {
  /** Produces verification evidence for a payment attempt. Never throws
   * for an ordinary "not verified" outcome — that is represented in the
   * returned evidence's own `verified: false` field, evaluated by
   * `evidence/verification.ts`'s `canAdvanceToVerified`. */
  verify(context: PaymentEvidenceContext): Promise<ExternalVerificationEvidence>;
  /** Produces settlement evidence for the given actual amount, bound to
   * an already-produced verification evidence's hash. */
  settle(
    context: PaymentEvidenceContext,
    verificationEvidence: ExternalVerificationEvidence,
    actualAmount: string
  ): Promise<ExternalSettlementEvidence>;
}

/**
 * The only `PaymentEvidenceProvider` implementation in this package.
 * Always returns `trust_class: 'synthetic_fixture'` evidence — never
 * `external_verified`, regardless of caller input. No network call, no
 * facilitator, no credential.
 */
export class FixturePaymentEvidenceProvider implements PaymentEvidenceProvider {
  async verify(context: PaymentEvidenceContext): Promise<ExternalVerificationEvidence> {
    return syntheticVerificationEvidenceSuccess(context);
  }

  async settle(
    context: PaymentEvidenceContext,
    verificationEvidence: ExternalVerificationEvidence,
    actualAmount: string
  ): Promise<ExternalSettlementEvidence> {
    const verificationEvidenceHash = await hashPaymentObject(verificationEvidence);
    return syntheticSettlementEvidenceSuccess(context, verificationEvidenceHash, actualAmount);
  }
}

export class ProductionEvidenceProviderNotConfiguredError extends Error {
  constructor() {
    super(
      'payment_evidence_mode is "production" but SUN-0700A defines no production PaymentEvidenceProvider ' +
        "(that is SUN-0700B's exclusive scope) — refusing to fall back to the fixture provider, which can " +
        'only ever produce synthetic_fixture-trust-class evidence.'
    );
    this.name = 'ProductionEvidenceProviderNotConfiguredError';
  }
}

/**
 * The single place a caller resolves which `PaymentEvidenceProvider` to
 * use. `mode: 'production'` **always** throws — there is no production
 * provider to fall back to, and a caller cannot bypass this by supplying
 * its own `FixturePaymentEvidenceProvider` instance: the check is on
 * `mode` alone, not on which provider was passed, so fixture evidence can
 * never satisfy a production gate no matter what a caller wires up
 * (directive §17).
 */
export function resolvePaymentEvidenceProvider(
  mode: PaymentEvidenceMode,
  fixtureProvider: PaymentEvidenceProvider = new FixturePaymentEvidenceProvider()
): PaymentEvidenceProvider {
  if (mode === 'production') {
    throw new ProductionEvidenceProviderNotConfiguredError();
  }
  return fixtureProvider;
}
