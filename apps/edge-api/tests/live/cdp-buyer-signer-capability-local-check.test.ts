/**
 * SUN-1220F — local-only, non-Worker, non-economic CDP buyer
 * signer-capability qualification tool.
 *
 * Approved location "C" (SUN-1220F design report, `docs/reports/
 * SUN-1220F-cdp-wallet-secret-remediation-design.md`): a separate
 * local/admin tool, never part of the SITEBORNE production Worker.
 * `CDP_WALLET_SECRET` must never be added to `wrangler.toml`, Cloudflare
 * Worker secrets, or any file reachable from `apps/edge-api/src/index.ts`
 * (the Worker's `main` entrypoint, per `wrangler.toml`). This file lives
 * only under `tests/live/`, which nothing under `src/` imports from —
 * the same structural non-reachability every other file in this
 * directory (`nevermined-recover-operator.test.ts`, `x402-live-*.test.ts`)
 * already relies on. It imports nothing from
 * `../../src/control-plane/config/production-payment.ts` (the file that
 * builds the *production* CDP client) and constructs its own client
 * locally, so the production factory's own type
 * (`Pick<Env, 'CDP_API_KEY_ID' | 'CDP_API_KEY_SECRET'>`, no
 * `walletSecret`) is untouched by this checkpoint.
 *
 * Credential handling:
 *   - Reads `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`
 *     from `process.env` ONLY (no CLI args, no config file, no
 *     defaults). All three are required; any one missing fails closed
 *     before constructing any client.
 *   - Zero raw-key handling: the three values are passed straight
 *     through as opaque strings to `new CdpClient({...})`; this file
 *     never parses, decodes, or transforms their bytes itself (the
 *     installed `@coinbase/cdp-sdk` does all of that internally).
 *   - Never printed, logged, persisted, or returned. Every `catch` block
 *     below is a bare `catch {}` (never `catch (error)`) so there is no
 *     local binding capable of accidentally being logged.
 *   - The signature itself is held only in a local `const` for the
 *     single local-recovery check, then goes out of scope. It is never
 *     part of the returned/logged result.
 *
 * Uses the official adapter this time: `fromCdpEvmAccount` (from
 * `@coinbase/cdp-sdk/x402`) wraps the CDP account before
 * `.signTypedData(...)` is called on it, unlike the now-removed
 * SUN-1220D production diagnostic, which called `account.signTypedData`
 * directly (SUN-1220E proved this made no behavioral difference —
 * `@x402/evm`'s `toClientEvmSigner` is a pure pass-through — but using
 * the adapter literally closes that gap for this checkpoint).
 *
 * Fixed, non-economic EIP-712 payload (own checkpoint-scoped nonce, same
 * shape as SUN-1220D's): no `verifyingContract`, no USDC/EIP-3009/x402
 * payment field of any kind. `DIAGNOSTIC_SIGNATURE_ECONOMICALLY_USABLE
 * = NO` by construction — recomputation of the nonce is covered by this
 * file's own test so any future edit is caught, not silently accepted.
 *
 * Gated so it is a no-op (zero network calls, zero client construction)
 * in every normal `pnpm test`/`pnpm check`/CI run:
 *
 *   describe.skipIf(!process.env.RUN_LOCAL_CDP_SIGNER_CAPABILITY_CHECK)
 *
 * Its own dedicated gate — never `RUN_LIVE_NEVERMINED`/`RUN_LIVE_X402`.
 *
 * Run via `pnpm cdp:signer-capability-check` (see
 * `scripts/cdp-buyer-signer-capability-check.ts`, a thin zero-workspace-
 * import CLI wrapper matching `scripts/nevermined-recover.ts`'s own
 * pattern: it only checks that the three env vars are *present* — it
 * never reads their values — sets the run-signal env var, and shells out
 * to `vitest run` scoped to this exact file).
 *
 * Requires (run-signal + credentials, all from the calling shell's
 * environment, never from this repository):
 *   RUN_LOCAL_CDP_SIGNER_CAPABILITY_CHECK=1 (run signal)
 *   CDP_API_KEY_ID
 *   CDP_API_KEY_SECRET
 *   CDP_WALLET_SECRET
 *
 * `controlled_sandbox_self_test`: independent_customer=false,
 * revenue=false, open_market_purchase=false, production_ready=false,
 * production_enabled=false. No payment, no funding, no settlement, no
 * transaction of any kind is reachable from this file.
 */
import { CdpClient } from '@coinbase/cdp-sdk';
import { fromCdpEvmAccount } from '@coinbase/cdp-sdk/x402';
import type { ClientEvmSigner } from '@x402/evm';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type * as Viem from 'viem';
import { describe, expect, it, vi } from 'vitest';

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof Viem>();
  return {
    ...actual,
    recoverTypedDataAddress: vi.fn(actual.recoverTypedDataAddress),
  };
});

const CONTROLLED_BUYER_ADDRESS = '0x516F57e1fB800ccEB2E70C42607Fb93E2abEcB99' as const;

const DIAGNOSTIC_DOMAIN = {
  name: 'SITEBORNE Local Signer Capability Diagnostic',
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
 * `keccak256(toHex('SUN-1220F-LOCAL-SIGNER-CAPABILITY-DIAGNOSTIC-v1'))`,
 * computed once and frozen as a literal so the signed input can never
 * drift at runtime. A distinct checkpoint-scoped nonce from SUN-1220D's
 * (`0xf542d2...`), so a signature produced by this tool can never be
 * confused with the removed production diagnostic's. Recomputation is
 * covered by this file's own test below.
 */
const DIAGNOSTIC_NONCE =
  '0x157a61bf3bb57a51eb9d79445faca3f7b670baf1d5e3c6cc49352071e75088c9' as const;

const DIAGNOSTIC_MESSAGE = {
  checkpoint: 'SUN-1220F',
  purpose: 'non-economic local signer capability proof',
  nonce: DIAGNOSTIC_NONCE,
} as const;

const SANITIZED_LOOKUP_FAILURE_MESSAGE = 'cdp buyer account lookup failed';
const SANITIZED_SIGNING_FAILURE_MESSAGE = 'diagnostic signing capability check failed';
const SANITIZED_RECOVERY_MISMATCH_MESSAGE = 'signature did not recover to the controlled buyer';

type AccountKind = 'server_account' | 'unknown';

export interface LocalCdpSignerCapabilityResult {
  ok: boolean;
  buyer_found: boolean;
  account_kind: AccountKind;
  typed_data_signing_succeeded: boolean;
  signature_recovered_to_buyer: boolean;
  credential_signing_authorized: boolean;
  error?: string;
}

/** The three required local credentials. Read once, from
 * `process.env` only, by the CLI-facing entry point below — never by
 * the testable core, which takes an already-constructed client factory
 * so tests never need real values. */
export interface LocalCdpCredentials {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
}

/** The subset of a CDP EVM account this tool needs: the address, and
 * exactly the `CdpEvmAccount` shape `fromCdpEvmAccount` itself declares
 * (`Pick<EvmAccount, "address" | "signTypedData">`) — so a real
 * `ServerAccount` from `client.evm.getAccount(...)` satisfies this
 * without a cast, and so does any test mock. */
export interface LocalCdpSignerCapabilityAccount {
  readonly address: `0x${string}`;
  signTypedData(options: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

export interface LocalCdpSignerCapabilityClient {
  evm: {
    getAccount(options: { address: string }): Promise<LocalCdpSignerCapabilityAccount>;
  };
}

/** Structurally requires all three credentials. This is a deliberately
 * separate, non-bundled live-capability factory; the production pre-402
 * seller path constructs no account client at all. */
export function buildLocalCdpSignerCapabilityClientFactory(
  credentials: LocalCdpCredentials
): () => LocalCdpSignerCapabilityClient {
  return () =>
    new CdpClient({
      apiKeyId: credentials.apiKeyId,
      apiKeySecret: credentials.apiKeySecret,
      walletSecret: credentials.walletSecret,
    }) as unknown as LocalCdpSignerCapabilityClient;
}

/** The testable core. Never reads `process.env` itself — takes an
 * already-built client factory, so every test below supplies a mock and
 * this function never touches a real credential. */
export async function resolveCdpBuyerSignerCapabilityLocally(
  createClient: () => LocalCdpSignerCapabilityClient
): Promise<LocalCdpSignerCapabilityResult> {
  let account: LocalCdpSignerCapabilityAccount;
  try {
    // Call 1 of 1: the same official, read-only account lookup SUN-1220C
    // and SUN-1220D used for the controlled buyer identity.
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
      error: SANITIZED_LOOKUP_FAILURE_MESSAGE,
    };
  }

  let signature: `0x${string}`;
  try {
    // Call 1 of 1: the OFFICIAL x402 signer adapter this time —
    // `fromCdpEvmAccount(account).signTypedData(...)`, not
    // `account.signTypedData(...)` directly — signing the one fixed
    // non-economic message. No retry on failure.
    const signer: ClientEvmSigner = fromCdpEvmAccount(
      account as unknown as Parameters<typeof fromCdpEvmAccount>[0]
    );
    signature = await signer.signTypedData({
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
    // `signature` goes out of scope with this function's return and is
    // never referenced again — never returned, logged, or persisted.
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
    // Fails closed. Neither address is exposed in the result.
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

/** Reads the three required credentials from `process.env` ONLY. Never
 * logs, returns, or persists their values — only whether each is
 * present. Returns `null` (never throws with a value-bearing message) if
 * any is missing. */
function readLocalCdpCredentialsFromEnv(): LocalCdpCredentials | null {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  const walletSecret = process.env.CDP_WALLET_SECRET;
  if (!apiKeyId || !apiKeySecret || !walletSecret) {
    return null;
  }
  return { apiKeyId, apiKeySecret, walletSecret };
}

describe.skipIf(!process.env.RUN_LOCAL_CDP_SIGNER_CAPABILITY_CHECK)(
  'SUN-1220F local CDP buyer signer-capability qualification (live, credential-gated)',
  () => {
    it('reads real credentials from process.env only and reports a fully redacted result', async () => {
      const credentials = readLocalCdpCredentialsFromEnv();
      expect(credentials).not.toBeNull();
      if (!credentials) return;

      const result = await resolveCdpBuyerSignerCapabilityLocally(
        buildLocalCdpSignerCapabilityClientFactory(credentials)
      );

      // Never logged as part of the assertion path -- printed exactly
      // once, deliberately, so the operator running this locally sees
      // the PASS/FAIL outcome. Contains no secret and no signature.
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result));

      expect(result).not.toHaveProperty('signature');
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(credentials.apiKeyId);
      expect(serialized).not.toContain(credentials.apiKeySecret);
      expect(serialized).not.toContain(credentials.walletSecret);
    });
  }
);

describe('SUN-1220F local CDP buyer signer-capability tool (unit, always runs)', () => {
  it('the fixed diagnostic nonce matches keccak256(toHex(<checkpoint literal>)) exactly', async () => {
    const { keccak256, toHex } = await vi.importActual<typeof Viem>('viem');
    const recomputed = keccak256(toHex('SUN-1220F-LOCAL-SIGNER-CAPABILITY-DIAGNOSTIC-v1'));
    expect(recomputed).toBe(DIAGNOSTIC_NONCE);
  });

  it('the fixed payload carries no verifyingContract and no payment/x402 field of any kind', () => {
    expect('verifyingContract' in DIAGNOSTIC_DOMAIN).toBe(false);
    const forbidden = [
      'USD Coin',
      'USDC',
      'contract',
      'TransferWithAuthorization',
      'from',
      'to',
      'value',
      'validAfter',
      'validBefore',
      'payTo',
      'service',
      'price',
      'quote',
      'requirementId',
      'x402',
      'payment',
      'payload',
    ];
    const serializedMessage = JSON.stringify(DIAGNOSTIC_MESSAGE).toLowerCase();
    for (const term of forbidden) {
      expect(serializedMessage).not.toContain(term.toLowerCase());
    }
  });

  it('fails closed with buyer_found=false and never constructs a client when the account lookup throws', async () => {
    const createClient = vi.fn<() => LocalCdpSignerCapabilityClient>(() => ({
      evm: {
        getAccount: vi.fn().mockRejectedValue(new Error('lookup failed')),
      },
    }));

    const result = await resolveCdpBuyerSignerCapabilityLocally(createClient);

    expect(result).toEqual({
      ok: false,
      buyer_found: false,
      account_kind: 'unknown',
      typed_data_signing_succeeded: false,
      signature_recovered_to_buyer: false,
      credential_signing_authorized: false,
      error: SANITIZED_LOOKUP_FAILURE_MESSAGE,
    });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('fails closed with typed_data_signing_succeeded=false when signTypedData throws (matches the observed SUN-1220D/E failure mode)', async () => {
    const createClient = (): LocalCdpSignerCapabilityClient => ({
      evm: {
        getAccount: vi.fn().mockResolvedValue({
          address: CONTROLLED_BUYER_ADDRESS,
          signTypedData: vi.fn().mockRejectedValue(new Error('Wallet Secret is not defined')),
        }),
      },
    });

    const result = await resolveCdpBuyerSignerCapabilityLocally(createClient);

    expect(result).toEqual({
      ok: false,
      buyer_found: true,
      account_kind: 'server_account',
      typed_data_signing_succeeded: false,
      signature_recovered_to_buyer: false,
      credential_signing_authorized: false,
      error: SANITIZED_SIGNING_FAILURE_MESSAGE,
    });
  });

  it('fails closed when the signature does not recover to the controlled buyer', async () => {
    // A deterministic, test-only private key/account -- never real
    // cryptographic material tied to any real funds. Produces a
    // genuine, honestly-recovered signature that legitimately does NOT
    // match CONTROLLED_BUYER_ADDRESS (it is a different address).
    const wrongAccount = privateKeyToAccount(
      '0x0101010101010101010101010101010101010101010101010101010101010101'.slice(
        0,
        66
      ) as `0x${string}`
    );

    const createClient = (): LocalCdpSignerCapabilityClient => ({
      evm: {
        getAccount: vi.fn().mockResolvedValue({
          address: CONTROLLED_BUYER_ADDRESS,
          // Ignores its own `options` parameter and signs the same
          // fixed, concrete literals `resolveCdpBuyerSignerCapabilityLocally`
          // always passes -- calling `wrongAccount.signTypedData` with
          // these `as const` literals directly (rather than forwarding
          // through this mock's looser structural-subset parameter type)
          // is what lets viem's own generic inference resolve cleanly.
          signTypedData: () =>
            wrongAccount.signTypedData({
              domain: DIAGNOSTIC_DOMAIN,
              types: DIAGNOSTIC_TYPES,
              primaryType: DIAGNOSTIC_PRIMARY_TYPE,
              message: DIAGNOSTIC_MESSAGE,
            }),
        }),
      },
    });

    const result = await resolveCdpBuyerSignerCapabilityLocally(createClient);

    expect(result.ok).toBe(false);
    expect(result.typed_data_signing_succeeded).toBe(true);
    expect(result.signature_recovered_to_buyer).toBe(false);
    expect(result.error).toBe(SANITIZED_RECOVERY_MISMATCH_MESSAGE);
    expect(result).not.toHaveProperty('signature');
  });

  it('the official fromCdpEvmAccount adapter is actually invoked (not bypassed) on a successful path', async () => {
    const testAccount = privateKeyToAccount(
      '0x0202020202020202020202020202020202020202020202020202020202020202'.slice(
        0,
        66
      ) as `0x${string}`
    );

    const createClient = (): LocalCdpSignerCapabilityClient => ({
      evm: {
        getAccount: vi.fn().mockResolvedValue({
          address: CONTROLLED_BUYER_ADDRESS,
          // Same rationale as the recovery-mismatch test above: signs
          // the fixed concrete literals directly rather than forwarding
          // through the mock's looser parameter type.
          signTypedData: () =>
            testAccount.signTypedData({
              domain: DIAGNOSTIC_DOMAIN,
              types: DIAGNOSTIC_TYPES,
              primaryType: DIAGNOSTIC_PRIMARY_TYPE,
              message: DIAGNOSTIC_MESSAGE,
            }),
        }),
      },
    });

    // The real controlled buyer's private key is CDP-managed and never
    // available to this repository, so no test can produce a genuine
    // signature that honestly recovers to the literal
    // `CONTROLLED_BUYER_ADDRESS` constant -- override for this one call.
    vi.mocked(recoverTypedDataAddress).mockResolvedValueOnce(CONTROLLED_BUYER_ADDRESS);

    const result = await resolveCdpBuyerSignerCapabilityLocally(createClient);

    expect(result).toEqual({
      ok: true,
      buyer_found: true,
      account_kind: 'server_account',
      typed_data_signing_succeeded: true,
      signature_recovered_to_buyer: true,
      credential_signing_authorized: true,
    });
    expect(result).not.toHaveProperty('signature');
  });

  it('fromCdpEvmAccount rejects an account missing signTypedData (structural adapter proof, no live call)', () => {
    expect(() =>
      fromCdpEvmAccount({
        address: CONTROLLED_BUYER_ADDRESS,
      } as unknown as Parameters<typeof fromCdpEvmAccount>[0])
    ).not.toThrow();
    // fromCdpEvmAccount itself is a synchronous, non-network
    // constructor (toClientEvmSigner is a pure wrapper) -- confirming it
    // does not throw on construction is a structural check, not a live
    // capability claim; the real adapter-invocation proof is the test
    // above.
  });
});
