/**
 * SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION.
 *
 * The one place in `edge-api` that reads `MTLS_PRODUCTION_ACTIVE` from
 * real deployment configuration — mirroring `agent-card-signing.ts`'s own
 * documented discipline ("the one place ... that reads [config] from real
 * deployment configuration; `@siteborne/protocol-a2a` itself never reads
 * environment variables"). `packages/protocol-a2a/src/card.ts` never
 * reads `env` itself; this resolved boolean is injected into
 * `CreateSiteborneA2aOptions.mtlsProductionActive` by `routes/a2a.ts`,
 * the same dependency direction already used for `signingIdentity` and
 * `effectiveProductionStatusByServiceId`.
 *
 * Presence-only discipline, exact-literal match: only `'true'` (the exact
 * string) activates the capability declaration. Absent, unset, or any
 * other value (including `'1'`, `'True'`, `'yes'`) fails closed to
 * `false` — matching every other production-activation flag in this
 * codebase (`PRODUCTION_ENABLED`, `PAID_ROUTES_ENABLED`, etc.), never a
 * separate, looser convention for this one flag.
 *
 * This resolver governs ONLY the Agent Card's static
 * `securitySchemes.mtls` metadata field. It does not gate, enable, or
 * otherwise affect: Cloudflare edge mTLS enforcement (a live Cloudflare
 * hostname-level configuration entirely outside this repository's
 * control), x402 payment authorization, settlement, any route's request
 * handling, or `mtls-caller-context.ts`'s dormant
 * `evaluateMtlsAuthorization()` helper (still wired into zero routes).
 * Flipping this flag `'true'` before a real mTLS production interface is
 * operator-qualified would make the Agent Card lie about a capability
 * that does not yet exist — this flag exists so that the one, single
 * place responsible for deciding "is it truthful to say this" can be set
 * deliberately, once, after real qualification, instead of the
 * declaration being permanently unconditional.
 */
import type { Env } from './env';

export function resolveMtlsProductionActive(env: Pick<Env, 'MTLS_PRODUCTION_ACTIVE'>): boolean {
  return env.MTLS_PRODUCTION_ACTIVE === 'true';
}
