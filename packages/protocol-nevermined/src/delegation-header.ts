/**
 * `PAYMENT-DELEGATION-ID` — SUN-0900B checkpoint 1B route-recovery wiring.
 *
 * Nevermined's opaque x402 access token carries no delegation reference
 * the seller can read back (confirmed by inspecting the installed SDK's
 * own `.d.ts` files: `VerifyPermissionsResult`/`SettlePermissionsResult`
 * carry neither a `delegationId` nor any equivalent correlation field,
 * and `DelegationAPI.listDelegations`/`getPurchasingPower` are scoped to
 * "the requesting API key" — the buyer's subscriber key, never the
 * seller's own facilitator key). Without this header the seller's route
 * has no way to discover which delegation a `SETTLEMENT_PENDING` payment
 * used after a crash, so it could never reconcile via
 * `GET /delegation/{id}/transactions` before deciding whether to allow a
 * retry.
 *
 * This header is an additive, Nevermined-only recovery-correlation
 * field. It is deliberately **not** authorization evidence: `verify()`
 * and `settle()` never send it to the facilitator, and a delegation
 * merely existing (or even having a real "succeeded" transaction) is
 * never enough by itself to mark a payment settled — the recovered
 * evidence must still match the persisted payment context (see
 * `settlement-recovery.ts`'s `validateNeverminedDelegationConsistency`).
 *
 * The buyer must supply the *same* delegationId used to obtain the
 * `PAYMENT-SIGNATURE` access token (`payments.x402.getX402AccessToken`'s
 * `delegationConfig.delegationId`) — this module cannot verify that
 * correspondence itself (the token is opaque), only that the header is
 * present and well-formed. The route binds it into the immutable v2
 * payment-attempt binding, so a reused Payment-Identifier presented with
 * a *different* delegationId is `duplicate_conflict`, never silently
 * accepted (directive requirement).
 */

export const PAYMENT_DELEGATION_ID_HEADER = 'PAYMENT-DELEGATION-ID' as const;

/** Nevermined delegation IDs observed in the sandbox are UUIDs, but the
 * format isn't a documented contract — bounded to a generous, still-safe
 * token shape (alphanumeric, hyphen, underscore) rather than pinned to
 * UUID syntax specifically, so a future non-UUID delegation id format
 * isn't rejected as "malformed" by this transport-layer check alone. */
const DELEGATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type NeverminedDelegationIdResult =
  | { status: 'present'; id: string }
  | { status: 'missing' }
  | { status: 'malformed' };

export function parseNeverminedDelegationId(
  headerValue: string | undefined
): NeverminedDelegationIdResult {
  if (headerValue === undefined || headerValue.length === 0) return { status: 'missing' };
  return DELEGATION_ID.test(headerValue)
    ? { status: 'present', id: headerValue }
    : { status: 'malformed' };
}
