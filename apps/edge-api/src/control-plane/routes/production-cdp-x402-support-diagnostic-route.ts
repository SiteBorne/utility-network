/**
 * SUN-1219B — TEMPORARY_VALIDATION_INSTRUMENTATION.
 *
 * A single-purpose, single-gated, read-only diagnostic that answers
 * exactly one question the SUN-1219A/B checkpoint chain could not answer
 * from source inspection alone: does the already-Cloudflare-bound
 * `siteborne-x402-facilitator` CDP credential (`CDP_API_KEY_ID` /
 * `CDP_API_KEY_SECRET`) authenticate at all, and does it advertise
 * support for Base mainnet (`eip155:8453`)?
 *
 * This is NOT a second CDP authentication implementation. It reuses,
 * unmodified:
 *   - `createCdpFacilitatorClient` from `@coinbase/cdp-sdk/x402` — the
 *     exact same official SDK factory `verify-agent-output-v2-cdp-
 *     composition.ts` already uses for the real production route;
 *   - `checkCdpSupportsNetwork` from `../evidence/cdp-provider` — an
 *     existing, already-unit-tested function that was previously wired
 *     to nothing in production runtime code. This checkpoint is its
 *     first production call site.
 *
 * Gated by `CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED` alone (the exact literal
 * `'true'`) -- deliberately NOT combined with, and NOT satisfied by,
 * `PAID_ROUTES_ENABLED` or `VERIFY_V2_CDP_ROUTE_ENABLED`. Absent/unset
 * (the default everywhere, including current production) -> `c.notFound()`,
 * zero dependency construction, byte-identical to every other disabled
 * gate in this repository.
 *
 * Structurally cannot reach payment, settlement, service execution, or
 * signing: this module imports nothing from `x402-service.ts`,
 * `production-paid-services.ts`, `verify-agent-output-v2-cdp-
 * composition.ts`, `buildProductionSigner`, or any receipt/signer/
 * executor module. Its only external call is
 * `facilitator.getSupported()` (via `checkCdpSupportsNetwork`) -- the
 * same read-only capability-discovery call `getSupported` names it as.
 * It never constructs a payment payload, never calls `verify`/`settle`,
 * never calls `CdpClient.evm.getAccount`, and holds no seller-address or
 * signer dependency at all.
 *
 * The response is deliberately minimal and redacted: two booleans and,
 * only on failure, a fixed, non-parameterized diagnostic string. It
 * never includes the advertised `kinds` list, any `uptoFacilitatorAddress`,
 * request/response headers, JWTs, credential identifiers, or the
 * underlying error's own message (which could otherwise echo request
 * URLs, header names, or other CDP-API-internal detail) -- on any
 * provider/authentication failure this handler reports a single fixed
 * string, never `err.message` or `err.stack`.
 */
import type { Context } from 'hono';
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402';
import { PRODUCTION_NETWORK } from '@siteborne/protocol-x402';
import type { Env } from '../config/env';
import { checkCdpSupportsNetwork } from '../evidence/cdp-provider';

const SANITIZED_FAILURE_MESSAGE = 'diagnostic provider call failed';

interface CdpX402SupportDiagnosticResult {
  ok: boolean;
  authentication_succeeded: boolean;
  base_mainnet_supported: boolean;
  error?: string;
}

export async function cdpX402SupportDiagnosticRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  // Single dedicated gate. No fallback to, and no interaction with,
  // either paid-route flag -- see this module's own doc comment.
  if (c.env?.CDP_X402_SUPPORT_DIAGNOSTIC_ENABLED !== 'true') {
    return c.notFound();
  }

  const apiKeyId = c.env.CDP_API_KEY_ID;
  const apiKeySecret = c.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) {
    const body: CdpX402SupportDiagnosticResult = {
      ok: false,
      authentication_succeeded: false,
      base_mainnet_supported: false,
      error: 'cdp credentials not configured',
    };
    return c.json(body, 503);
  }

  try {
    // The one external operation: an official-SDK-constructed facilitator
    // client's own read-only capability-discovery call. No verify, no
    // settle, no account lookup, no signing.
    const facilitator = createCdpFacilitatorClient({ apiKeyId, apiKeySecret });
    const result = await checkCdpSupportsNetwork(facilitator, PRODUCTION_NETWORK, ['upto']);
    const body: CdpX402SupportDiagnosticResult = {
      ok: true,
      authentication_succeeded: true,
      base_mainnet_supported: result.ok,
    };
    return c.json(body);
  } catch {
    // Fail closed. Never propagate the raw error (message/stack may
    // embed request/response detail) -- a single fixed string only.
    const body: CdpX402SupportDiagnosticResult = {
      ok: false,
      authentication_succeeded: false,
      base_mainnet_supported: false,
      error: SANITIZED_FAILURE_MESSAGE,
    };
    return c.json(body, 502);
  }
}
