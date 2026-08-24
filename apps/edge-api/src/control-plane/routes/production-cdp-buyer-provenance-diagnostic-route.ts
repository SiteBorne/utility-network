/**
 * SUN-1220C — TEMPORARY_VALIDATION_INSTRUMENTATION.
 *
 * A single-purpose, single-gated, read-only diagnostic that answers the
 * one question SUN-1220C's source-only investigation could not answer
 * from static inspection alone: is the fixed, source-embedded controlled
 * buyer address (`0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`) a
 * CDP-managed account reachable through the already-Cloudflare-bound
 * `siteborne-x402-facilitator` credential (`CDP_API_KEY_ID` /
 * `CDP_API_KEY_SECRET`), and, if so, what kind of account the official
 * SDK returns for it?
 *
 * This is NOT a second CDP authentication implementation. It reuses,
 * unmodified, `buildProductionCdpAccountLookupClientFactory` from
 * `../config/production-payment` — the exact same construction the real
 * `verify_agent_output.v2` production route already uses (via
 * `buildCdpSellerAddressLookup`) to resolve the *seller* identity. This
 * checkpoint is only a second *call site* of that same factory, pointed
 * at a fixed buyer address instead of `env.SELLER_WALLET_ADDRESS`.
 *
 * Gated by `CDP_BUYER_PROVENANCE_DIAGNOSTIC_ENABLED` alone (the exact
 * literal `'true'`) — deliberately NOT combined with, and NOT satisfied
 * by, `PAID_ROUTES_ENABLED` or `VERIFY_V2_CDP_ROUTE_ENABLED`.
 * Absent/unset (the default everywhere, including current production) ->
 * `c.notFound()`, zero dependency construction, byte-identical to every
 * other disabled gate in this repository (matches the removed SUN-1219B
 * `CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED` precedent).
 *
 * The buyer address is fixed in source (`CONTROLLED_BUYER_ADDRESS`
 * below) and cannot be overridden by any query parameter, path
 * parameter, or request body — this diagnostic exists for exactly one
 * controlled lookup, not an arbitrary-address account-lookup oracle.
 *
 * Structurally cannot sign or mutate: this module calls exactly one CDP
 * SDK operation, `client.evm.getAccount({ address })` — a documented
 * read-only GET (see `buildProductionCdpAccountLookupClientFactory`'s
 * own doc comment: "read-only GET; the SDK only requires the Wallet
 * Secret for POST/DELETE Account-API writes, which this repository never
 * performs"). It imports nothing from `x402-service.ts`,
 * `production-paid-services.ts`, `verify-agent-output-v2-cdp-
 * composition.ts`, `@x402/evm`'s `fromCdpEvmAccount`/
 * `fromCdpSmartWallet`, or any receipt/signer/executor/settlement
 * module. No signer object is ever constructed; `official_signer_adapter`
 * in the response is a static string literal chosen by a plain
 * conditional, never a call to the adapter itself.
 *
 * Account-kind classification is grounded in the installed
 * `@coinbase/cdp-sdk@1.55.0` type declarations, not guessed from field
 * names: `EvmClient.getAccount(options: GetServerAccountOptions):
 * Promise<ServerAccount>` — its return type is `ServerAccount`
 * unconditionally. Smart Accounts are retrievable only through the
 * separate `getSmartAccount(...)` method, which this module never calls
 * and never imports. Consequently a successful resolution through this
 * diagnostic's one call path is *by construction* always a
 * `ServerAccount` — `"smart_account"` is a structurally unreachable
 * branch here (retained in the response type only for the vocabulary
 * this checkpoint's directive requires, and documented as unreachable
 * rather than fabricated).
 *
 * Not-found vs. generic provider/authentication failure: the SDK exposes
 * an internal `APIError` class (`statusCode` + `errorType`, including an
 * `ErrorType.NotFound = "not_found"` literal) that *could* in principle
 * distinguish a 404 from other failures — but `APIError` is not part of
 * `@coinbase/cdp-sdk`'s public package-export surface (its `package.json`
 * `exports` map declares only `.`, `./auth`, and `./x402`; the errors
 * module is reachable only via an unsupported deep import). Relying on
 * that unexported shape would not be a "reliable discriminator" in the
 * sense this checkpoint's directive requires — it could change without
 * a public contract violation. This module therefore does NOT attempt
 * to distinguish not-found from any other failure: every thrown error,
 * whatever its cause, fails closed to the same fixed, sanitized 503
 * response. `buyer_found: false` in this diagnostic's design is
 * consequently reachable only via that generic failure path, never via
 * a distinguished not-found path — matching the directive's own
 * fallback instruction ("if not-found cannot be safely distinguished...
 * fail closed with the generic sanitized error").
 */
import type { Context } from 'hono';
import type { Env } from '../config/env';
import { buildProductionCdpAccountLookupClientFactory } from '../config/production-payment';
import type { CdpAccountLookupClient } from '../config/production-payment';

const SANITIZED_FAILURE_MESSAGE = 'diagnostic provider call failed';

/**
 * Fixed in source per this checkpoint's directive — no request input of
 * any kind (query, path, or body) may substitute a different address.
 */
const CONTROLLED_BUYER_ADDRESS = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99' as const;

type AccountKind = 'server_account' | 'smart_account' | 'unknown';
type OfficialSignerAdapter = 'fromCdpEvmAccount' | 'fromCdpSmartWallet' | 'none';

export interface CdpBuyerProvenanceDiagnosticResult {
  ok: boolean;
  buyer_found: boolean;
  account_kind: AccountKind;
  official_signer_adapter: OfficialSignerAdapter;
  credential_lookup_authorized: boolean;
  error?: string;
}

/**
 * The testable core, deliberately factored out of the Hono handler
 * itself: Hono infers `Handler` vs. `MiddlewareHandler` from a
 * function's declared parameter count, so the exported route below must
 * keep strict arity 1 to register correctly with `app.get(path, ...)`.
 * This function is the "explicitly named test seam" this checkpoint's
 * directive requires — tests call it directly with a mock
 * `createClient`, never through Hono's request dispatch, so it carries
 * no production HTTP reachability of its own; only the route handler
 * below (which supplies the real factory, never an override) is
 * actually mounted.
 */
export async function resolveCdpBuyerProvenance(
  createClient: () => CdpAccountLookupClient
): Promise<CdpBuyerProvenanceDiagnosticResult> {
  try {
    // The one external operation: the same official-SDK-constructed
    // client's own read-only account-lookup call already proven safe
    // for the seller identity. No getOrCreateAccount, no listAccounts,
    // no signTypedData, no signer construction.
    const client = createClient();
    await client.evm.getAccount({ address: CONTROLLED_BUYER_ADDRESS });

    // `client.evm.getAccount` resolves only ever to a `ServerAccount` at
    // the SDK's own type level (see this module's doc comment) -- so a
    // successful resolution is unconditionally `server_account`.
    return {
      ok: true,
      buyer_found: true,
      account_kind: 'server_account',
      official_signer_adapter: 'fromCdpEvmAccount',
      credential_lookup_authorized: true,
    };
  } catch {
    // Fail closed. Never propagate the raw error (message/stack may
    // embed request/response detail, account IDs, or credential
    // identifiers) -- a single fixed string only. See this module's doc
    // comment for why not-found is not distinguished from any other
    // failure here.
    return {
      ok: false,
      buyer_found: false,
      account_kind: 'unknown',
      official_signer_adapter: 'none',
      credential_lookup_authorized: false,
      error: SANITIZED_FAILURE_MESSAGE,
    };
  }
}

/**
 * The real, single-argument Hono handler — the only thing `index.ts`
 * mounts. Always supplies the real
 * `buildProductionCdpAccountLookupClientFactory(...)`; never accepts an
 * override, so there is no reachable path from any HTTP request to a
 * substituted client.
 */
export async function cdpBuyerProvenanceDiagnosticRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  // Single dedicated gate. No fallback to, and no interaction with,
  // either paid-route flag -- see this module's own doc comment.
  if (c.env?.CDP_BUYER_PROVENANCE_DIAGNOSTIC_ENABLED !== 'true') {
    return c.notFound();
  }

  const apiKeyId = c.env.CDP_API_KEY_ID;
  const apiKeySecret = c.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) {
    const body: CdpBuyerProvenanceDiagnosticResult = {
      ok: false,
      buyer_found: false,
      account_kind: 'unknown',
      official_signer_adapter: 'none',
      credential_lookup_authorized: false,
      error: 'cdp credentials not configured',
    };
    return c.json(body, 503);
  }

  const result = await resolveCdpBuyerProvenance(
    buildProductionCdpAccountLookupClientFactory({
      CDP_API_KEY_ID: apiKeyId,
      CDP_API_KEY_SECRET: apiKeySecret,
    })
  );
  return c.json(result, result.ok ? 200 : 503);
}
