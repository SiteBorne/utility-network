/**
 * SUN-1000 checkpoint 1P — SITEBORNE-owned direct HTTP replacement for
 * `@nevermined-io/payments`'s `Payments.getInstance().facilitator`
 * (verify/settle) and its two pure helper functions (`buildPaymentRequired`,
 * `getEnvironmentFromApiKey`), removing the runtime dependency on the SDK
 * and its vulnerable `@traceloop/node-server-sdk` → OpenTelemetry
 * transitive chain (the three Trivy HIGH findings this checkpoint targets).
 *
 * This file is the one place in the whole repository that talks to the
 * real Nevermined facilitator directly over HTTP — mirroring the existing
 * `cdp-provider.ts` precedent (the real CDP facilitator adapter also lives
 * here, never in the credential-independent `@siteborne/protocol-x402`
 * package). `@siteborne/protocol-nevermined` stays network-free by design
 * (`no-network.test.ts`), so this transport layer belongs in `edge-api`,
 * not the shared package, matching that same architectural boundary.
 *
 * Fidelity to the installed SDK (`@nevermined-io/payments@1.10.0`) is
 * deliberate and exact — verified against its own source
 * (`dist/x402/facilitator-api.js`, `dist/api/base-payments.js`,
 * `dist/environments.js`, `dist/common/api-version.js`) and cross-checked
 * against Nevermined's current official documentation
 * (docs.nevermined.app: "x402 Facilitator Overview", "How the x402
 * Facilitator Works", "API Versioning") during this checkpoint:
 *
 *  - Request/response shapes for `POST /api/v1/x402/verify` and
 *    `POST /api/v1/x402/settle` match the SDK's own
 *    `VerifyPermissionsParams`/`SettlePermissionsParams` construction
 *    exactly (`paymentRequired`, `x402AccessToken`,
 *    `maxAmount: maxAmount.toString()`, optional `agentRequestId`).
 *  - Headers match `getBackendHTTPOptions` exactly: `Accept`,
 *    `Content-Type`, `Authorization: Bearer <key>`, and the
 *    `Nevermined-Version` header pinned to `NEVERMINED_LOCKED_API_VERSION`
 *    unless explicitly overridden per call -- the same mechanism the
 *    SDK's own `options.version` provides, confirmed by the official
 *    "API Versioning" doc page.
 *  - `buildNeverminedPaymentRequiredLocal` reproduces `buildPaymentRequired`
 *    field-for-field (`x402Version: 2`, `resource.url`, `accepts[0]` with
 *    `scheme`/`network`/`planId`/`extra.version`/`extra.agentId`/
 *    `extra.httpVerb`, `extensions: {}`) -- a pure, non-network function
 *    in the SDK too, so no behavior can differ.
 *  - `resolveNeverminedEnvironmentFromApiKey` reproduces
 *    `getEnvironmentFromApiKey` field-for-field (a pure string-prefix
 *    switch on the part of the key before its first `:`).
 *
 * KNOWN DISCREPANCY, deliberately NOT acted on this checkpoint: current
 * Nevermined docs list the facilitator's own base URL as
 * `https://facilitator.sandbox.nevermined.app`, while the installed SDK's
 * `environments.js` hardcodes `https://api.sandbox.nevermined.app/` (the
 * host this codebase has empirically proven correct via multiple real
 * settlements, most recently `2cee37c`). This checkpoint makes NO live
 * provider call (per its own directive), so the discrepancy cannot be
 * resolved by testing here -- this client intentionally keeps the SDK's
 * own proven host rather than guessing the docs' alternate one.
 */
import type {
  NeverminedFacilitatorClient,
  NeverminedPaymentRequired,
  NeverminedSettlePermissionsInput,
  NeverminedSettlementResult,
  NeverminedVerificationResult,
  NeverminedVerifyPermissionsInput,
} from '@siteborne/protocol-nevermined';

/** Same value as the installed SDK's `LOCKED_API_VERSION`
 * (`common/api-version.js`) -- the backend API generation every real
 * settlement in this repository's history (including the two confirmed
 * real ERC-4337 settlements) was actually proven against. Overridable per
 * call via `NeverminedHttpClientOptions.apiVersion`, mirroring the SDK's
 * own per-instance `options.version`. */
export const NEVERMINED_LOCKED_API_VERSION = '1.1';

const API_VERSION_PATTERN = /^\d+\.\d+$/;

/** Same values as the installed SDK's `environments.js` -- the hosts this
 * codebase has empirically proven correct via real settlements. See this
 * file's own module doc comment for the known docs/SDK host discrepancy. */
const NEVERMINED_BACKEND_URL: Record<'sandbox' | 'live', string> = {
  sandbox: 'https://api.sandbox.nevermined.app/',
  live: 'https://api.live.nevermined.app/',
};

const API_URL_VERIFY_PERMISSIONS = '/api/v1/x402/verify';
const API_URL_SETTLE_PERMISSIONS = '/api/v1/x402/settle';

/** Pure replication of the SDK's `getEnvironmentFromApiKey`
 * (`environments.js`) -- a string-prefix switch on the part of the key
 * before its first `:`. No network call, no key material logged. */
export function resolveNeverminedEnvironmentFromApiKey(
  apiKey: string
): 'sandbox' | 'live' | 'staging_sandbox' | 'staging_live' | undefined {
  if (!apiKey || !apiKey.includes(':')) return undefined;
  const prefix = apiKey.slice(0, apiKey.indexOf(':')).toLowerCase();
  switch (prefix) {
    case 'sandbox-staging':
      return 'staging_sandbox';
    case 'live-staging':
      return 'staging_live';
    case 'sandbox':
      return 'sandbox';
    case 'live':
      return 'live';
    default:
      return undefined;
  }
}

/** Pure replication of the SDK's `buildPaymentRequired` (`x402/
 * facilitator-api.js`) -- constructs the same `x402Version: 2` /
 * `resource` / `accepts[0]` / `extensions: {}` shape, directly as
 * SITEBORNE's own `NeverminedPaymentRequired` type (no SDK type import
 * needed at all -- the shapes were already structurally identical). */
export function buildNeverminedPaymentRequiredLocal(
  planId: string,
  options: {
    endpoint: string;
    agentId?: string;
    httpVerb?: string;
    network: string;
    description?: string;
    mimeType?: string;
  }
): NeverminedPaymentRequired {
  const extra: { version: string; agentId?: string; httpVerb?: string } = {
    version: '1',
    ...(options.agentId && { agentId: options.agentId }),
    ...(options.httpVerb && { httpVerb: options.httpVerb }),
  };
  return {
    x402Version: 2,
    resource: {
      url: options.endpoint,
      ...(options.description && { description: options.description }),
      ...(options.mimeType && { mimeType: options.mimeType }),
    },
    accepts: [
      {
        scheme: 'nvm:erc4337',
        network: options.network,
        planId,
        extra,
      },
    ],
    extensions: {},
  };
}

/** Machine-readable error envelope, matching the shape observed on every
 * real Nevermined error response this codebase has captured (checkpoint
 * 1O-B2A's raw-fetch probes): `{message, code, category, hint,
 * correlationId}`. Never includes Authorization or any credential. */
export class NeverminedHttpError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly category?: string,
    public readonly hint?: string,
    public readonly correlationId?: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'NeverminedHttpError';
  }
}

export interface NeverminedHttpClientOptions {
  apiKey: string;
  environment: 'sandbox' | 'live';
  /** MAJOR.MINOR backend API version pin. Defaults to
   * `NEVERMINED_LOCKED_API_VERSION`. Fails closed (throws) on a malformed
   * value rather than silently sending an invalid header -- same
   * discipline as the SDK's own `options.version` validation. */
  apiVersion?: string;
  /** Request timeout in milliseconds. Default 30s. */
  timeoutMs?: number;
}

/** Direct HTTP replacement for `Payments.getInstance().facilitator` --
 * implements the same narrow `NeverminedFacilitatorClient` interface
 * `nevermined-provider.ts` already programs against, so swapping the
 * adapter requires no change to any caller's contract. */
export class NeverminedHttpFacilitatorClient implements NeverminedFacilitatorClient {
  private readonly apiKey: string;
  private readonly backendUrl: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;

  constructor(options: NeverminedHttpClientOptions) {
    const apiVersion = options.apiVersion ?? NEVERMINED_LOCKED_API_VERSION;
    if (!API_VERSION_PATTERN.test(apiVersion)) {
      throw new Error(
        `invalid Nevermined API version '${apiVersion}': expected MAJOR.MINOR (e.g. '1.1')`
      );
    }
    this.apiKey = options.apiKey;
    this.backendUrl = NEVERMINED_BACKEND_URL[options.environment];
    this.apiVersion = apiVersion;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private headers(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // Never logged: this class's own error path (below) never includes
      // header contents in any thrown error or return value.
      Authorization: `Bearer ${this.apiKey}`,
      'Nevermined-Version': this.apiVersion,
    };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const url = new URL(path, this.backendUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        ),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NeverminedHttpError('Nevermined facilitator request timed out', 'timeout');
      }
      throw new NeverminedHttpError(
        'Network error during Nevermined facilitator request',
        'network_error'
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let message = `Nevermined facilitator request failed (HTTP ${response.status})`;
      let code: string | undefined;
      let category: string | undefined;
      let hint: string | undefined;
      let correlationId: string | undefined;
      try {
        const errorBody = (await response.json()) as Record<string, unknown>;
        if (typeof errorBody.message === 'string') message = errorBody.message;
        if (typeof errorBody.code === 'string') code = errorBody.code;
        if (typeof errorBody.category === 'string') category = errorBody.category;
        if (typeof errorBody.hint === 'string') message = `${message} — ${errorBody.hint}`;
        if (typeof errorBody.hint === 'string') hint = errorBody.hint;
        if (typeof errorBody.correlationId === 'string') correlationId = errorBody.correlationId;
      } catch {
        // Non-JSON error body -- use the default message.
      }
      throw new NeverminedHttpError(message, code, category, hint, correlationId, response.status);
    }

    // Response validation: must be valid JSON; malformed bodies fail
    // closed rather than being trusted as a partial/undefined shape.
    try {
      return await response.json();
    } catch {
      throw new NeverminedHttpError(
        'Nevermined facilitator returned a malformed (non-JSON) response body',
        'malformed_response'
      );
    }
  }

  async verifyPermissions(
    input: NeverminedVerifyPermissionsInput
  ): Promise<NeverminedVerificationResult> {
    const body = {
      paymentRequired: input.paymentRequired,
      x402AccessToken: input.accessToken,
      maxAmount: input.authorizedMaximum,
    };
    const result = (await this.post(API_URL_VERIFY_PERMISSIONS, body)) as Record<string, unknown>;
    // Response validation: the field this codebase's own evidence boundary
    // (`validateNeverminedVerificationResult`) treats as authoritative
    // must actually be present and boolean-shaped before being trusted.
    if (typeof result.isValid !== 'boolean') {
      throw new NeverminedHttpError(
        'Nevermined verify response missing a boolean isValid field',
        'malformed_response'
      );
    }
    return {
      isValid: result.isValid,
      invalidReason: typeof result.invalidReason === 'string' ? result.invalidReason : undefined,
      payer: typeof result.payer === 'string' ? result.payer : undefined,
      network: typeof result.network === 'string' ? result.network : undefined,
      agentRequestId: typeof result.agentRequestId === 'string' ? result.agentRequestId : undefined,
    };
  }

  async settlePermissions(
    input: NeverminedSettlePermissionsInput
  ): Promise<NeverminedSettlementResult> {
    const body = {
      paymentRequired: input.paymentRequired,
      x402AccessToken: input.accessToken,
      maxAmount: input.actualAmount,
      ...(input.agentRequestId ? { agentRequestId: input.agentRequestId } : {}),
    };
    const result = (await this.post(API_URL_SETTLE_PERMISSIONS, body)) as Record<string, unknown>;
    const transaction = result.transaction;
    if (typeof transaction !== 'string' || transaction.length === 0) {
      throw new NeverminedHttpError(
        'Nevermined settle response missing a transaction reference',
        'malformed_response'
      );
    }
    return {
      // Deliberately optional at this boundary, matching the installed
      // SDK's own observed real-world behavior: `success` has been
      // observed absent on two independently-confirmed real ERC-4337
      // settlements (SUN-0900B checkpoint 1B) that later verified
      // `status: "succeeded"` via `GET /delegation/{id}/transactions`.
      // See `validateNeverminedSettlementResult`'s normalizer, which
      // already handles this absence correctly for either adapter.
      success: typeof result.success === 'boolean' ? result.success : undefined,
      errorReason: typeof result.errorReason === 'string' ? result.errorReason : undefined,
      payer: typeof result.payer === 'string' ? result.payer : undefined,
      transaction,
      network: typeof result.network === 'string' ? result.network : undefined,
      creditsRedeemed:
        typeof result.creditsRedeemed === 'string' ? result.creditsRedeemed : undefined,
      remainingBalance:
        typeof result.remainingBalance === 'string' ? result.remainingBalance : undefined,
    };
  }
}
