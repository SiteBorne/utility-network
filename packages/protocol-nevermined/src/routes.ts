import {
  ALL_BAZAAR_SERVICE_IDS,
  resolveServiceRoute,
  type PaymentRail,
  type SiteborneServiceId,
} from '@siteborne/protocol-x402';

export const NEVERMINED_ROUTES: Readonly<Record<SiteborneServiceId, string>> = {
  'company_evidence_graph.v1': '/v1/nevermined/company/evidence-graph',
  'web_context_verified.v1': '/v1/nevermined/web/context',
  'document_evidence_json.v1': '/v1/nevermined/document/evidence-json',
  'verify_agent_output.v1': '/v1/nevermined/verify/agent-output',
  // SUN-1000 checkpoint 1M: route strings only — no v2 Nevermined route is
  // actually mounted this checkpoint (paid-services.ts wires only v2 CDP
  // routes; nevermined-rail v2 remains unexercised until Phase 2 binds
  // real provider resources, checkpoint 1L section 12).
  'company_evidence_graph.v2': '/v2/nevermined/company/evidence-graph',
  'web_context_verified.v2': '/v2/nevermined/web/context',
  'document_evidence_json.v2': '/v2/nevermined/document/evidence-json',
  'verify_agent_output.v2': '/v2/nevermined/verify/agent-output',
};

const OPEN_ROUTES = new Set(ALL_BAZAAR_SERVICE_IDS.map((id) => resolveServiceRoute(id).path));
const NVM_ROUTES = new Set(Object.values(NEVERMINED_ROUTES));

export function selectPaymentRail(route: string): PaymentRail | null {
  if (OPEN_ROUTES.has(route)) return 'cdp';
  if (NVM_ROUTES.has(route)) return 'nevermined';
  return null;
}

export async function executeOnSelectedRail<T>(
  route: string,
  providers: Readonly<Record<PaymentRail, () => Promise<T>>>
): Promise<T> {
  const rail = selectPaymentRail(route);
  if (!rail) throw new Error('unknown payment route');
  // Exactly one selected call. Rejection propagates; there is intentionally
  // no catch/fallback branch.
  return providers[rail]();
}
