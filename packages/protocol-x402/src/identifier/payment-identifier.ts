/**
 * Wraps the **official** x402 Payment-Identifier extension
 * (`@x402/extensions/payment-identifier`) for external wire-level
 * interoperability (directive §6) — SITEBORNE never invents a competing
 * idempotency extension. Only this one subpath is imported: it has no
 * wallet/crypto runtime dependency (verified by inspecting its published
 * chunk — it imports only `ajv`), even though the parent `@x402/extensions`
 * package's *other* subpaths (sign-in-with-x, offer-receipt) depend on
 * viem/jose/tweetnacl/siwe. `src/tests/no-network.test.ts` statically
 * proves this package never imports any subpath other than
 * `@x402/extensions/payment-identifier`.
 *
 * The extension's `payment_identifier` string is an **idempotency
 * coordinate, not proof of payment** (directive §7) — it is bound, in
 * `src/replay/binding.ts`, to SITEBORNE's own stronger immutable payment
 * binding (quote/requirement/service/input-hash/scheme/network/asset/
 * amount/payee), never used alone as authorization.
 */
import {
  PAYMENT_IDENTIFIER,
  PAYMENT_ID_MAX_LENGTH,
  PAYMENT_ID_MIN_LENGTH,
  appendPaymentIdentifierToExtensions,
  declarePaymentIdentifierExtension,
  extractAndValidatePaymentIdentifier,
  generatePaymentId,
  isValidPaymentId,
} from '@x402/extensions/payment-identifier';
import type { PaymentPayload, PaymentRequired } from '@x402/core/types';

export { PAYMENT_IDENTIFIER, PAYMENT_ID_MAX_LENGTH, PAYMENT_ID_MIN_LENGTH, isValidPaymentId };

/** Declares support for the extension on a `PaymentRequired` challenge —
 * `required: true` means a buyer that omits an identifier gets a closed
 * `missing_required_identifier` outcome from `parsePaymentIdentifier`
 * below (never a silent skip). */
export function declareSiteborneePaymentIdentifierSupport(
  required: boolean
): Record<string, unknown> {
  return { [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(required) };
}

export type PaymentIdentifierParseOutcome =
  | { status: 'present'; id: string }
  | { status: 'absent' }
  | { status: 'missing_required_identifier' }
  | { status: 'malformed'; detail: string };

/** Parses the buyer's payment identifier from the **official extension
 * location only** (`payload.extensions['payment-identifier']`) — never an
 * arbitrary nested field. Fails closed: a required-but-missing identifier
 * and a present-but-malformed identifier are each their own distinct,
 * closed outcome. */
export function parsePaymentIdentifier(
  payload: PaymentPayload,
  serverRequired: boolean
): PaymentIdentifierParseOutcome {
  const { id, validation } = extractAndValidatePaymentIdentifier(payload);

  // A structurally-present-but-invalid extension also comes back with
  // `id: null` from the official parser — check validity *before*
  // treating a null id as merely "absent", or a malformed identifier
  // would be silently misreported as no identifier at all.
  if (!validation.valid) {
    return { status: 'malformed', detail: (validation.errors ?? []).join('; ') };
  }
  if (id === null) {
    if (serverRequired) return { status: 'missing_required_identifier' };
    return { status: 'absent' };
  }
  return { status: 'present', id };
}

/** Generates a new, valid payment identifier — used only by tests/fixture
 * builders in this package (a real buyer client generates its own; this
 * package never acts as a buyer). */
export function generateSiteborneePaymentId(prefix?: string): string {
  return generatePaymentId(prefix);
}

/** Buyer-side helper (test/fixture use only — see
 * `generateSiteborneePaymentId`'s note above): fills in a payment
 * identifier on a `PaymentPayload.extensions` object that already
 * contains the server's declared `payment-identifier` extension (echoed
 * back from a `PaymentRequired.extensions`, per the official wire flow —
 * `appendPaymentIdentifierToExtensions` mutates in place onto that
 * declaration, it does not construct a fresh one). Re-exported so callers
 * outside this package (e.g. `apps/edge-api`'s HTTP integration tests)
 * never need their own direct `@x402/extensions/payment-identifier`
 * dependency just to build a buyer-side test fixture. */
export function buildBuyerPaymentIdentifierExtensions(
  declaredExtensions: Record<string, unknown>,
  id?: string
): Record<string, unknown> {
  return appendPaymentIdentifierToExtensions({ ...declaredExtensions }, id ?? generatePaymentId());
}

/** Whether a `PaymentRequired` challenge declares the payment-identifier
 * extension at all, and whether it is required — pure structural read,
 * no network. */
export function readDeclaredPaymentIdentifierRequirement(challenge: PaymentRequired): {
  declared: boolean;
  required: boolean;
} {
  const declaration = challenge.extensions?.[PAYMENT_IDENTIFIER] as
    | { info?: { required?: boolean } }
    | undefined;
  if (!declaration) return { declared: false, required: false };
  return { declared: true, required: Boolean(declaration.info?.required) };
}
