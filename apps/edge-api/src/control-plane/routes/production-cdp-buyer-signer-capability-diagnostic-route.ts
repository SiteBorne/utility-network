/**
 * SUN-1220D — TEMPORARY_VALIDATION_INSTRUMENTATION.
 *
 * SUN-1220C proved the fixed, source-embedded controlled buyer address
 * (`0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99`) is a CDP-managed
 * `ServerAccount` reachable through the already-Cloudflare-bound
 * `siteborne-x402-facilitator` credential. It left one question
 * unanswered: `CURRENT_CDP_CREDENTIAL_CAN_SIGN_FOR_BUYER=UNPROVEN`. This
 * diagnostic answers that question, and only that question, by invoking
 * the official `fromCdpEvmAccount` / `ClientEvmSigner.signTypedData`
 * path against one fixed, non-economic EIP-712 message that cannot be
 * reused as a payment authorization.
 *
 * This is NOT a second CDP authentication implementation. It reuses,
 * unmodified, `buildProductionCdpAccountLookupClientFactory` from
 * `../config/production-payment` — the exact same construction the real
 * `verify_agent_output.v2` production route and SUN-1220C's provenance
 * diagnostic already use to resolve an identity via
 * `client.evm.getAccount(...)`. This module only adds a locally-scoped,
 * structurally richer client interface (`CdpSignerCapabilityClient`)
 * that additionally types the resolved account's own `signTypedData`
 * method — the exact same runtime object, a wider TypeScript view of it,
 * never a second construction path.
 *
 * Gated by `CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED` alone (the
 * exact literal `'true'`) — a dedicated gate, deliberately independent
 * of `CDP_BUYER_PROVENANCE_DIAGNOSTIC_ENABLED`, `PAID_ROUTES_ENABLED`,
 * and `VERIFY_V2_CDP_ROUTE_ENABLED`. Absent/unset (the default
 * everywhere, including current production) -> `c.notFound()`, zero
 * dependency construction.
 *
 * The buyer address, EIP-712 domain, primary type, types, message, and
 * nonce are ALL fixed in source. This handler takes no request input of
 * any kind (no query, path, or body parsing occurs at all) — it cannot
 * become an arbitrary signing oracle.
 *
 * Absolute payment-separation: the diagnostic domain omits
 * `verifyingContract` entirely (optional per the SDK's own
 * `EIP712Domain` type) and never mentions "USD Coin", the Base
 * mainnet USDC contract, `TransferWithAuthorization`, or any of
 * `from`/`to`/`value`/`validAfter`/`validBefore`/`payTo`/a service
 * price/a quote or requirement ID/an x402 payment nonce. This module
 * imports nothing from `x402-service.ts`, `production-paid-services.ts`,
 * `verify-agent-output-v2-cdp-composition.ts`, `ExactEvmScheme`,
 * `createPaymentPayload`, `encodePaymentSignatureHeaderSafe`, `settle`,
 * or any verify/receipt/executor module.
 *
 * Why the resulting signature can never satisfy USDC's EIP-3009
 * `transferWithAuthorization`, or SITEBORNE's own `PaymentPayload`
 * schema, even if someone tried to replay it:
 *   1. EIP-712 signatures cryptographically commit to the full
 *      `(domainSeparator, hashStruct(message))` pair. This diagnostic's
 *      domain (`name: "SITEBORNE Signer Capability Diagnostic"`,
 *      `version: "1"`, `chainId: 8453`, no `verifyingContract`) hashes
 *      to a completely different `domainSeparator` than Base mainnet
 *      USDC's real one (`name: "USD Coin"`, `version: "2"`,
 *      `verifyingContract: 0x8335...02913`) — any verifier checking
 *      against USDC's real domain separator rejects this signature
 *      outright.
 *   2. `primaryType` is `"SignerCapabilityDiagnostic"`, not
 *      `"TransferWithAuthorization"` — the EIP-712 type hash embedded in
 *      the signed struct differs entirely from EIP-3009's.
 *   3. The message fields (`checkpoint`, `purpose`, `nonce`) contain no
 *      `from`/`to`/`value`/`validAfter`/`validBefore` — there is no way
 *      to even construct a `transferWithAuthorization(...)` call from
 *      this signature; the required calldata parameters don't exist.
 *   4. This module never assembles an x402 `PaymentPayload` object (the
 *      shape SITEBORNE's `PAYMENT-SIGNATURE` header requires) around the
 *      signature at all — the signature is discarded before any such
 *      structure could be built.
 *
 * Signature handling: the raw signature returned by
 * `signer.signTypedData(...)` is held only in a local variable long
 * enough to pass to `recoverTypedDataAddress` (an official `viem`
 * export — no custom cryptography). It is never logged, never included
 * in the response, never persisted, and never stringified explicitly.
 * Recovery success/failure and the recovered-vs-expected comparison are
 * reduced to booleans before the signature variable goes out of scope.
 */
import { recoverTypedDataAddress } from 'viem';
import type { Context } from 'hono';
import type { Env } from '../config/env';
import { buildProductionCdpAccountLookupClientFactory } from '../config/production-payment';

const SANITIZED_SIGNING_FAILURE_MESSAGE = 'diagnostic signing capability check failed';
const SANITIZED_RECOVERY_MISMATCH_MESSAGE = 'diagnostic signer recovery mismatch';

/**
 * Fixed in source per this checkpoint's directive — no request input of
 * any kind (query, path, or body) may substitute a different address.
 */
const CONTROLLED_BUYER_ADDRESS = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99' as const;

/**
 * Fixed, non-economic EIP-712 payload. See this module's doc comment
 * for why this can never satisfy USDC EIP-3009 or SITEBORNE's
 * `PaymentPayload` schema. `chainId` is included only as an EIP-712
 * domain-separation field (standard replay-protection practice), not as
 * an assertion that this diagnostic performs any on-chain or payment
 * action — it performs neither.
 */
const DIAGNOSTIC_DOMAIN = {
  name: 'SITEBORNE Signer Capability Diagnostic',
  version: '1',
  chainId: 8453,
} as const;

const DIAGNOSTIC_TYPES = {
  SignerCapabilityDiagnostic: [
    { name: 'checkpoint', type: 'string' },
    { name: 'purpose', type: 'string' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const DIAGNOSTIC_PRIMARY_TYPE = 'SignerCapabilityDiagnostic' as const;

/**
 * `keccak256(toHex('SUN-1220D-SIGNER-CAPABILITY-DIAGNOSTIC-v1'))`,
 * computed once and frozen as a literal so the signed input can never
 * drift at runtime. Recomputation is covered by this module's test file
 * so any future edit to the source string is caught, not silently
 * accepted.
 */
const DIAGNOSTIC_NONCE = '0xf542d25a1f9eb8af01e7b6f9032603893bd135895126cc74309fc1b6955ec355' as const;

const DIAGNOSTIC_MESSAGE = {
  checkpoint: 'SUN-1220D',
  purpose: 'non-economic signer capability proof',
  nonce: DIAGNOSTIC_NONCE,
} as const;

type AccountKind = 'server_account' | 'unknown';

export interface CdpBuyerSignerCapabilityDiagnosticResult {
  ok: boolean;
  buyer_found: boolean;
  account_kind: AccountKind;
  typed_data_signing_succeeded: boolean;
  signature_recovered_to_buyer: boolean;
  credential_signing_authorized: boolean;
  error?: string;
}

/**
 * The subset of a CDP EVM server account (EOA) this diagnostic needs:
 * the address, and the account's own `signTypedData` method. Structural
 * subset of the SDK's `EvmAccount` type and of `fromCdpEvmAccount`'s own
 * `CdpEvmAccount` parameter type — any real `ServerAccount` returned by
 * `client.evm.getAccount(...)` satisfies this without a cast.
 */
export interface CdpSignerCapabilityAccount {
  readonly address: `0x${string}`;
  signTypedData(options: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

/**
 * A structurally-richer view of the same real CDP client
 * `buildProductionCdpAccountLookupClientFactory` already constructs —
 * not a second client, not a second auth path. See this module's doc
 * comment.
 */
export interface CdpSignerCapabilityClient {
  evm: {
    getAccount(options: { address: string }): Promise<CdpSignerCapabilityAccount>;
  };
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
export async function resolveCdpBuyerSignerCapability(
  createClient: () => CdpSignerCapabilityClient
): Promise<CdpBuyerSignerCapabilityDiagnosticResult> {
  let account: CdpSignerCapabilityAccount;
  try {
    // Call 1 of 1: the same official, already-proven-safe read-only
    // account lookup SUN-1220C used for the seller and buyer identity.
    const client = createClient();
    account = await client.evm.getAccount({ address: CONTROLLED_BUYER_ADDRESS });
  } catch {
    return {
      ok: false,
      buyer_found: false,
      account_kind: 'unknown',
      typed_data_signing_succeeded: false,
      signature_recovered_to_buyer: false,
      credential_signing_authorized: false,
      error: SANITIZED_SIGNING_FAILURE_MESSAGE,
    };
  }

  let signature: `0x${string}`;
  try {
    // Call 1 of 1: the official CDP-account-to-x402-signer adapter,
    // signing the one fixed non-economic message. No retry on failure.
    signature = await account.signTypedData({
      domain: DIAGNOSTIC_DOMAIN,
      types: DIAGNOSTIC_TYPES,
      primaryType: DIAGNOSTIC_PRIMARY_TYPE,
      message: DIAGNOSTIC_MESSAGE,
    });
  } catch {
    return {
      ok: false,
      buyer_found: true,
      account_kind: 'server_account',
      typed_data_signing_succeeded: false,
      signature_recovered_to_buyer: false,
      credential_signing_authorized: false,
      error: SANITIZED_SIGNING_FAILURE_MESSAGE,
    };
  }

  let recovered: `0x${string}`;
  try {
    recovered = await recoverTypedDataAddress({
      domain: DIAGNOSTIC_DOMAIN,
      types: DIAGNOSTIC_TYPES,
      primaryType: DIAGNOSTIC_PRIMARY_TYPE,
      message: DIAGNOSTIC_MESSAGE,
      signature,
    });
  } catch {
    // Recovery itself failed (malformed signature bytes). The
    // signature variable goes out of scope with this function's return
    // and is never referenced again.
    return {
      ok: false,
      buyer_found: true,
      account_kind: 'server_account',
      typed_data_signing_succeeded: true,
      signature_recovered_to_buyer: false,
      credential_signing_authorized: false,
      error: SANITIZED_RECOVERY_MISMATCH_MESSAGE,
    };
  }

  if (recovered.toLowerCase() !== CONTROLLED_BUYER_ADDRESS.toLowerCase()) {
    // Fails closed. Neither address is exposed in the response.
    return {
      ok: false,
      buyer_found: true,
      account_kind: 'server_account',
      typed_data_signing_succeeded: true,
      signature_recovered_to_buyer: false,
      credential_signing_authorized: false,
      error: SANITIZED_RECOVERY_MISMATCH_MESSAGE,
    };
  }

  return {
    ok: true,
    buyer_found: true,
    account_kind: 'server_account',
    typed_data_signing_succeeded: true,
    signature_recovered_to_buyer: true,
    credential_signing_authorized: true,
  };
}

/**
 * The real, single-argument Hono handler — the only thing `index.ts`
 * mounts. Always supplies the real
 * `buildProductionCdpAccountLookupClientFactory(...)`; never accepts an
 * override, so there is no reachable path from any HTTP request to a
 * substituted client. Takes no query, path, or body input of any kind.
 */
export async function cdpBuyerSignerCapabilityDiagnosticRoute(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  // Single dedicated gate. Independent of every other diagnostic and
  // paid-route flag — see this module's own doc comment.
  if (c.env?.CDP_BUYER_SIGNER_CAPABILITY_DIAGNOSTIC_ENABLED !== 'true') {
    return c.notFound();
  }

  const apiKeyId = c.env.CDP_API_KEY_ID;
  const apiKeySecret = c.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) {
    const body: CdpBuyerSignerCapabilityDiagnosticResult = {
      ok: false,
      buyer_found: false,
      account_kind: 'unknown',
      typed_data_signing_succeeded: false,
      signature_recovered_to_buyer: false,
      credential_signing_authorized: false,
      error: 'cdp credentials not configured',
    };
    return c.json(body, 503);
  }

  const result = await resolveCdpBuyerSignerCapability(
    buildProductionCdpAccountLookupClientFactory({
      CDP_API_KEY_ID: apiKeyId,
      CDP_API_KEY_SECRET: apiKeySecret,
    }) as unknown as () => CdpSignerCapabilityClient
  );
  return c.json(result, result.ok ? 200 : 503);
}
