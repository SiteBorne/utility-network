/**
 * The external payment-evidence boundary as an explicit seam (SUN-0700A
 * checkpoint 5, directive §16-17; SUN-0700B checkpoint 1 preflight
 * closure, directive §4-10). `PaymentEvidenceProvider` is the one
 * interface a paid HTTP route calls through for verification/settlement
 * evidence — it never calls a facilitator, evidence fixture generator, or
 * anything else directly.
 *
 * A real facilitator's `/verify` and `/settle` operations need the actual
 * signed `PaymentPayload` and the exact `PaymentRequirements` the buyer's
 * payload was checked against — `PaymentEvidenceContext` alone (bare
 * identity/binding metadata) cannot express a real `VerifyRequest`/
 * `SettleRequest`. `PaymentVerificationContext`/`PaymentSettlementContext`
 * below extend it additively with those ephemeral protocol artifacts, so
 * a real provider can construct the official facilitator request directly
 * from what it's given — never by re-parsing hidden HTTP state, and never
 * by reconstructing a subtly different requirement object than the one
 * that was already structurally validated at the HTTP boundary.
 *
 * `paymentPayload` carries signed payment authorization material. A
 * provider may hold it in memory for the duration of a single verify/
 * settle call; nothing in this package persists it to D1, folds it into
 * `PaymentServiceLink`, writes it to an audit event, a fixture, a report,
 * or an error — only the already-existing hash/id fields those artifacts
 * bind to (see linkage/payment-service-link.ts, evidence/types.ts's
 * `raw_evidence_hash`). A caller wiring a real provider must preserve
 * that boundary itself; this module cannot enforce what a caller does
 * with the reference once handed to it, only refrain from doing anything
 * with it beyond passing it through.
 *
 * `FixturePaymentEvidenceProvider` is the only *implementation* in this
 * package: it produces exclusively `synthetic_fixture`-trust-class
 * evidence (`evidence/fixtures.ts`) and is intentionally named to make
 * clear it is not a live verifier — never `LiveFacilitatorProvider` or
 * similar. A production evidence provider (one that could produce
 * `external_verified` evidence from a real facilitator) is **not
 * implemented** anywhere in this package. The accepted CDP implementation
 * lives in the edge integration layer; the Nevermined implementation remains
 * SUN-0900A Checkpoint 2. `resolvePaymentEvidenceProvider` still fails closed in
 * `production` mode whenever no provider, or only a fixture provider, is
 * supplied — see `providerKind` below for how that's now decided without
 * an `instanceof` check.
 */
import { hashPaymentObject } from '../canonical';
import type { PaymentEvidenceMode } from './policy';
import type {
  ExternalSettlementEvidence,
  ExternalVerificationEvidence,
  PaymentEvidenceContext,
} from './types';
import type { PaymentPayload, PaymentRequirements } from '../types';
import type { UsageResult } from '../linkage/usage-result';
import {
  syntheticSettlementEvidenceSuccess,
  syntheticVerificationEvidenceSuccess,
} from './fixtures';

/**
 * Everything `verify()` needs to construct a real facilitator
 * `VerifyRequest` (`{ x402Version, paymentPayload, paymentRequirements }`)
 * directly, with no re-parsing of hidden HTTP state. `paymentPayload` and
 * `paymentRequirements` must be the exact objects the HTTP boundary
 * already structurally validated (`payload/parser.ts`'s
 * `validatePaymentPayloadStructure`) — never re-decoded or re-derived
 * copies (directive §7).
 */
export interface CdpPaymentAuthorizationContext {
  authorizationContext: { rail: 'cdp' };
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

/** Nevermined authorization remains opaque at this shared boundary. The
 * protocol-nevermined adapter supplies the installed SDK's exact requirement
 * type when it implements its narrower client interface; x402 never coerces
 * `nvm:erc4337` into Coinbase `exact | upto` wire types. */
export interface NeverminedPaymentAuthorizationContext {
  authorizationContext: {
    rail: 'nevermined';
    accessToken: string;
    paymentRequired: unknown;
    agentId: string;
    planId: string;
  };
}

export type PaymentAuthorizationContext =
  | CdpPaymentAuthorizationContext
  | NeverminedPaymentAuthorizationContext;

export type PaymentVerificationContext = PaymentEvidenceContext & PaymentAuthorizationContext;

/**
 * Everything `settle()` needs to construct a real facilitator
 * `SettleRequest`. `usageResult` is present only for `upto`-scheme
 * settlements — the post-execution usage binding
 * (`linkage/usage-result.ts`) already computed by the caller before
 * settlement is requested, distinct from the pre-execution authorized
 * maximum carried in `paymentRequirements`/`amount`.
 */
export type PaymentSettlementContext = PaymentEvidenceContext &
  PaymentAuthorizationContext & {
    usageResult?: UsageResult;
  };

export function isCdpPaymentAuthorizationContext(
  context: PaymentVerificationContext | PaymentSettlementContext
): context is PaymentEvidenceContext &
  CdpPaymentAuthorizationContext & { usageResult?: UsageResult } {
  return context.authorizationContext.rail === 'cdp';
}

/** How a `PaymentEvidenceProvider` was implemented — never inferred via
 * `instanceof` (directive §9). `resolvePaymentEvidenceProvider` uses this
 * field alone to decide whether a supplied provider may ever be selected
 * in `production` mode. Selection is not itself proof of payment: the
 * evidence a provider returns must still separately pass the trust-class
 * gate (`policy.ts`'s `isTrustClassAllowed`, via `canAdvanceToVerified`/
 * `canAdvanceToSettled`) — an `external` provider that (mis)produces
 * `synthetic_fixture` or `external_unverified` evidence is still
 * rejected there, same as always. */
export type PaymentEvidenceProviderKind = 'fixture' | 'external';

export interface PaymentEvidenceProvider {
  /** Declares how this provider was implemented — see
   * `PaymentEvidenceProviderKind`. */
  readonly providerKind: PaymentEvidenceProviderKind;
  /** Produces verification evidence for a payment attempt. Never throws
   * for an ordinary "not verified" outcome — that is represented in the
   * returned evidence's own `verified: false` field, evaluated by
   * `evidence/verification.ts`'s `canAdvanceToVerified`. */
  verify(context: PaymentVerificationContext): Promise<ExternalVerificationEvidence>;
  /** Produces settlement evidence for the given actual amount, bound to
   * an already-produced verification evidence's hash. */
  settle(
    context: PaymentSettlementContext,
    verificationEvidence: ExternalVerificationEvidence,
    actualAmount: string
  ): Promise<ExternalSettlementEvidence>;
}

/**
 * The only `PaymentEvidenceProvider` implementation in this package.
 * Always returns `trust_class: 'synthetic_fixture'` evidence — never
 * `external_verified`, regardless of caller input, including the real
 * `paymentPayload`/`paymentRequirements` it's now handed alongside the
 * rest of the context (it reads neither). No network call, no
 * facilitator, no credential.
 */
export class FixturePaymentEvidenceProvider implements PaymentEvidenceProvider {
  readonly providerKind = 'fixture' as const;

  async verify(context: PaymentVerificationContext): Promise<ExternalVerificationEvidence> {
    return syntheticVerificationEvidenceSuccess(context);
  }

  async settle(
    context: PaymentSettlementContext,
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
      'payment_evidence_mode is "production" but no PaymentEvidenceProvider with ' +
        'providerKind "external" was supplied — refusing to fall back to a fixture ' +
        'provider (providerKind "fixture"), which can only ever produce ' +
        'synthetic_fixture-trust-class evidence. As of SUN-0700B checkpoint 1 this ' +
        "package still implements no such 'external' provider itself; supplying one " +
        "is the caller's responsibility (see apps/edge-api)."
    );
    this.name = 'ProductionEvidenceProviderNotConfiguredError';
  }
}

/**
 * The single place a caller resolves which `PaymentEvidenceProvider` to
 * use. `mode: 'production'` throws unless the supplied provider declares
 * `providerKind: 'external'` — decided on that field alone, never
 * `instanceof` (directive §9), so a caller cannot satisfy a production
 * gate by supplying a `FixturePaymentEvidenceProvider` instance no matter
 * how it's wrapped. Selecting an external provider here is necessary but
 * not sufficient for a payment to actually advance state: the evidence it
 * returns must still separately pass `canAdvanceToVerified`/
 * `canAdvanceToSettled`'s trust-class gate (directive §10) — this
 * function only ever decides which provider is *asked*, never whether its
 * answer is trusted.
 */
export function resolvePaymentEvidenceProvider(
  mode: PaymentEvidenceMode,
  provider?: PaymentEvidenceProvider
): PaymentEvidenceProvider {
  if (mode === 'production') {
    if (!provider || provider.providerKind !== 'external') {
      throw new ProductionEvidenceProviderNotConfiguredError();
    }
    return provider;
  }
  return provider ?? new FixturePaymentEvidenceProvider();
}
