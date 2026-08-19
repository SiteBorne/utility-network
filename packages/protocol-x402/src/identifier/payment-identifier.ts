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

/**
 * SUN-1202 checkpoint H — SITEBORNE compatibility adapter (Preferred A).
 *
 * The official `@x402/extensions` declaration
 * (`declarePaymentIdentifierExtension`, upstream, unconditionally
 * attaches `schema: paymentIdentifierSchema` to every declared
 * extension — SITEBORNE cannot omit it via that official API, confirmed
 * by reading the installed package source directly (2.21.0, the pinned
 * version, and 2.23.0, the latest published version at the time of this
 * fix — identical in this regard). Upstream's own
 * `validatePaymentIdentifier` (`@x402/extensions/payment-identifier`)
 * does a real, request-time `new Ajv2020().compile(ext.schema)`
 * whenever a buyer echoes that `schema` field back — exactly what a
 * spec-compliant buyer echoing the full server-declared extension
 * object does, including SITEBORNE's own official buyer helper
 * (`buildBuyerPaymentIdentifierExtensions`, below). Under real
 * Cloudflare `workerd`, that compile throws (`EvalError: Code
 * generation from strings disallowed for this context` —
 * request-time dynamic code generation is disallowed), and
 * `validatePaymentIdentifier`'s own internal `try/catch` converts that
 * exception into `{valid: false}` — silently rejecting an otherwise
 * perfectly valid Payment Identifier as "malformed".
 *
 * `ext.schema` is OPTIONAL from `validatePaymentIdentifier`'s own
 * perspective (`if (ext.schema) { ...validate... }` runs only when the
 * field is present) and carries no payment-identity, signature, or
 * settlement meaning — it is pure self-descriptive JSON Schema metadata
 * a buyer MAY use to locally validate `info` before sending, never wire
 * content `info.id`/`info.required` depend on. This function drops it
 * (and ONLY it) from an already-decoded, already-structurally-validated
 * `PaymentPayload` before that payload reaches
 * `validatePaymentIdentifier` — a presentation-only normalization.
 * `info.id`/`info.required` (the actual payment-identity fields this
 * package's idempotency binding, `src/replay/binding.ts`, depends on)
 * pass through completely unchanged; no cryptographic, signature-bound,
 * or settlement-bound value is touched. See ADR 0057 for the durable
 * governing rule this fix establishes.
 */
export function sanitizePaymentIdentifierExtensionForValidation(
  payload: PaymentPayload
): PaymentPayload {
  const extensions = payload.extensions as Record<string, unknown> | undefined;
  const extension = extensions?.[PAYMENT_IDENTIFIER] as
    | { info?: unknown; schema?: unknown }
    | undefined;
  if (!extension || typeof extension !== 'object' || !('schema' in extension)) {
    return payload;
  }
  const extensionWithoutSchema: { info?: unknown } = { info: extension.info };
  return {
    ...payload,
    extensions: {
      ...extensions,
      [PAYMENT_IDENTIFIER]: extensionWithoutSchema,
    },
  };
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
 * closed outcome.
 *
 * SUN-1202 checkpoint H: applies
 * `sanitizePaymentIdentifierExtensionForValidation` first, unconditionally,
 * for every caller — not just `apps/edge-api`'s HTTP route. See that
 * function's own doc comment for the full compatibility-adapter rationale;
 * this is the one, single entry point every payload must pass through
 * before reaching upstream's `extractAndValidatePaymentIdentifier`, so no
 * future caller can forget to apply it. */
export function parsePaymentIdentifier(
  payload: PaymentPayload,
  serverRequired: boolean
): PaymentIdentifierParseOutcome {
  const sanitized = sanitizePaymentIdentifierExtensionForValidation(payload);
  const { id, validation } = extractAndValidatePaymentIdentifier(sanitized);

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
