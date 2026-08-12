/**
 * Real, seller-credentialed, read-only Nevermined settlement-reconciliation
 * client (SUN-0900B checkpoint 1B — final live-harness recovery wiring).
 *
 * Authenticates with the SELLER's own facilitator credential (`NVM_API_KEY`)
 * — never the buyer's `NVM_SUBSCRIBER_API_KEY` — confirmed live, read-only,
 * in the prior route-recovery-wiring turn: the seller's key can read
 * `GET /delegation/{id}` and `GET /delegation/{id}/transactions` for a
 * delegation it does not own. Implements exactly
 * `NeverminedDelegationLookupClient` (`packages/protocol-nevermined/src/
 * settlement-recovery.ts`) — two GET operations, nothing else. There is no
 * mutating method on this class, at all: the type itself, not merely
 * convention, keeps this client from ever creating, updating, deleting,
 * verifying, or settling anything. It never sends, receives, or persists an
 * x402 access token.
 *
 * Mirrors `NeverminedPaymentEvidenceProvider.authenticated`'s exact
 * credential-gated construction pattern: the live guard is evaluated at
 * construction time, sandbox-only, `RUN_LIVE_NEVERMINED==='1'` required —
 * so with the flag absent, no caller can ever reach a real HTTP call through
 * this class, structurally, not just by convention.
 */
import {
  evaluateNeverminedLiveGuard,
  type NeverminedDelegationLookupClient,
  type NeverminedDelegationRecoveryRecord,
  type NeverminedSettlementTransaction,
} from '@siteborne/protocol-nevermined';

const SANDBOX_BACKEND = 'https://api.sandbox.nevermined.app/';
const API_VERSION_HEADER = 'Nevermined-Version';
const API_VERSION = '1.1';

export interface AuthenticatedNeverminedReconciliationClientOptions {
  apiKey: string;
  liveGuard: {
    runLiveNevermined: string | undefined;
    apiKeyEnvironment: 'sandbox' | 'live' | 'unknown';
  };
}

export class NeverminedLiveGuardDeniedError extends Error {
  constructor(code: string) {
    super(`nevermined_live_guard_denied:${code}`);
    this.name = 'NeverminedLiveGuardDeniedError';
  }
}

function isDelegationTransactionsShape(
  value: unknown
): value is { transactions: NeverminedSettlementTransaction[] } {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { transactions?: unknown }).transactions)
  );
}

function isDelegationShape(value: unknown): value is NeverminedDelegationRecoveryRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.delegationId === 'string' &&
    typeof v.provider === 'string' &&
    typeof v.status === 'string' &&
    typeof v.currency === 'string' &&
    (v.planId === null || typeof v.planId === 'string') &&
    (v.providerPaymentMethodId === null || typeof v.providerPaymentMethodId === 'string')
  );
}

/**
 * The only *implementation* of `NeverminedDelegationLookupClient` that ever
 * makes a real HTTP call — always `GET`, always against the sandbox, always
 * the seller's own credential. Injectable purely via its narrow interface,
 * so a route/test never depends on this concrete class.
 */
export class NeverminedSandboxReconciliationClient implements NeverminedDelegationLookupClient {
  private constructor(private readonly apiKey: string) {}

  /** The only construction path. Throws immediately (never lazily, never
   * per-call) if the live guard denies — a misconfigured or accidental
   * construction attempt fails before it could ever make a request. */
  static authenticated(
    options: AuthenticatedNeverminedReconciliationClientOptions
  ): NeverminedSandboxReconciliationClient {
    const guard = evaluateNeverminedLiveGuard({
      runLiveNevermined: options.liveGuard.runLiveNevermined,
      environment: 'sandbox',
      apiKeyEnvironment: options.liveGuard.apiKeyEnvironment,
    });
    if (!guard.allowed) throw new NeverminedLiveGuardDeniedError(guard.code);
    return new NeverminedSandboxReconciliationClient(options.apiKey);
  }

  private async getJson(path: string): Promise<unknown> {
    const url = new URL(path, SANDBOX_BACKEND);
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        [API_VERSION_HEADER]: API_VERSION,
      },
    });
    if (!res.ok) {
      throw new Error(`nevermined_reconciliation_http_${res.status}`);
    }
    return res.json();
  }

  async listDelegationTransactions(
    delegationId: string
  ): Promise<{ transactions: NeverminedSettlementTransaction[] }> {
    const body = await this.getJson(
      `/api/v1/delegation/${encodeURIComponent(delegationId)}/transactions`
    );
    if (!isDelegationTransactionsShape(body)) {
      throw new Error('nevermined_reconciliation_malformed_transactions_response');
    }
    return body;
  }

  async getDelegation(delegationId: string): Promise<NeverminedDelegationRecoveryRecord | null> {
    let body: unknown;
    try {
      body = await this.getJson(`/api/v1/delegation/${encodeURIComponent(delegationId)}`);
    } catch (e) {
      // A 404 (not found) and a 403 (not authorized) are both surfaced as a
      // thrown `nevermined_reconciliation_http_*` error by `getJson` — both
      // must be treated identically here: `null`, never distinguished, so
      // no caller can infer anything about a delegation it cannot see.
      if (e instanceof Error && /nevermined_reconciliation_http_(404|403)/.test(e.message)) {
        return null;
      }
      throw e;
    }
    if (!isDelegationShape(body)) {
      throw new Error('nevermined_reconciliation_malformed_delegation_response');
    }
    return body;
  }
}
