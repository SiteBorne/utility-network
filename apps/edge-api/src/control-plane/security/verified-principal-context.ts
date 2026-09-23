import type { VerifiedPrincipalEvidence } from './result-authorization';

const principalsByRequest = new WeakMap<Request, VerifiedPrincipalEvidence>();

/** Server-owned, process-local handoff used by protocol adapters. It is not
 * serializable and has no header/wire representation, so a client cannot
 * manufacture it. */
export function attachVerifiedPrincipal(
  request: Request,
  principal: VerifiedPrincipalEvidence
): void {
  principalsByRequest.set(request, principal);
}

export function consumeVerifiedPrincipal(request: Request): VerifiedPrincipalEvidence | null {
  const principal = principalsByRequest.get(request) ?? null;
  principalsByRequest.delete(request);
  return principal;
}
