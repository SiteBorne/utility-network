/**
 * Deterministic payment quote identity (directive §16). A quote binds
 * everything a payment payload must match to be honored: service, pricing,
 * scheme, network, asset, payee, amount, and a validity window. Mutating
 * any bound field changes the quote's digest and therefore its ID — a
 * payment payload built against quote A structurally cannot satisfy quote
 * B (proven in quote.test.ts).
 */
import { hashPaymentObject } from '../canonical';
import { deterministicId } from '../ids';
import { SUPPORTED_X402_VERSION } from '../version';
import type { SiteborneServiceId } from '../types';
import type { Network } from '@x402/core/types';

export interface QuoteInput {
  /** Defaults to SUPPORTED_X402_VERSION when omitted — bound into the
   * quote identity either way, so a future protocol major-version bump
   * (which changes SUPPORTED_X402_VERSION) automatically changes every
   * new quote's identity rather than silently reusing the old binding. */
  x402_version?: number;
  service_id: SiteborneServiceId;
  service_version: 'v1' | 'v2';
  contract_release: string;
  /** The frozen PCC-style `sha256:<hex>` input hash of the request this
   * quote prices — binds the quote to a specific request, not just a
   * service. */
  input_hash: string;
  pricing_key: string;
  /** governance/RISK_LIMITS.yaml's own `version` field (see
   * @siteborne/pricing's resolvePricingSourceVersion) — binds the
   * *pricing rule version*, not just a resolved price value, so a
   * governance repricing revision is itself a bound, detectable change.
   * Optional for callers that construct a quote from a price obtained
   * another way (e.g. a synthetic test fixture); when omitted it is not
   * part of the binding. */
  pricing_source_version?: string;
  scheme: 'exact' | 'upto';
  network: Network;
  asset: string;
  /** Atomic-unit integer string. For `exact`, the exact amount required.
   * For `upto`, the authorized maximum. */
  amount: string;
  payee: string;
  issued_at: string;
  expires_at: string;
}

export interface Quote extends QuoteInput {
  quote_id: string;
  /** Canonical digest of every bound field except quote_id itself — the
   * value quote_id is deterministically derived from. Exposed so callers
   * (and tests) can verify a quote's ID without recomputing the exact
   * seed string this module uses internally. */
  binding_hash: string;
}

/** The exact canonical, order-independent representation a quote's
 * identity is derived from. Field *values* matter, key order does not
 * (canonicalize() is key-order independent) — but every field listed here
 * is part of the binding: changing any one of them changes binding_hash
 * and therefore quote_id. */
function bindingPayload(input: QuoteInput): Record<string, unknown> {
  return {
    x402_version: input.x402_version ?? SUPPORTED_X402_VERSION,
    service_id: input.service_id,
    service_version: input.service_version,
    contract_release: input.contract_release,
    input_hash: input.input_hash,
    pricing_key: input.pricing_key,
    pricing_source_version: input.pricing_source_version ?? null,
    scheme: input.scheme,
    network: input.network,
    asset: input.asset,
    amount: input.amount,
    payee: input.payee,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
  };
}

export async function buildQuote(input: QuoteInput): Promise<Quote> {
  const binding_hash = await hashPaymentObject(bindingPayload(input));
  const quote_id = deterministicId('qte', binding_hash);
  return { ...input, quote_id, binding_hash };
}

/** True only when every bound field matches exactly — used by the payload
 * parser (directive §13) to detect `quote_mismatch` deterministically
 * rather than by re-deriving and string-comparing IDs at every call site. */
export function quoteBindingMatches(quote: Quote, candidate: QuoteInput): boolean {
  return shallowEqual(bindingPayload(quote), bindingPayload(candidate));
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

/** Whether `nowIso` is at or after the quote's expiry — quotes are
 * inclusive-of-expiry-instant-invalid (expires_at itself is already
 * expired), matching the frozen PCC convention used elsewhere in this
 * repo. */
export function isQuoteExpired(quote: Pick<Quote, 'expires_at'>, nowIso: string): boolean {
  return new Date(nowIso).getTime() >= new Date(quote.expires_at).getTime();
}
