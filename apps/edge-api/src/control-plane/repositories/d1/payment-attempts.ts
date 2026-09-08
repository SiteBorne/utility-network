/**
 * The real, D1-backed `PaymentAttemptRepository` (from
 * `@siteborne/protocol-x402`) — the authoritative closure for SUN-0700A
 * checkpoint 2's replay/idempotency proof. Modeled directly on
 * `D1IdempotencyRepository` (`./idempotency.ts`, SUN-0200, already
 * accepted): an atomic INSERT relying on the database's own unique
 * constraint (`idx_payment_attempts_identifier` on
 * `payment_attempts.payment_identifier`, migration
 * 0002_payment_attempt_replay.sql) for acquisition — never a separate
 * SELECT-then-INSERT.
 *
 * Why a new table rather than reusing `idempotency_records` or
 * `payment_quotes`: both existing tables declare their job-reference
 * column NOT NULL with a foreign key into `jobs(id)` — but a payment
 * attempt is authoritatively acquired *before* a job exists (see the
 * migration file's own header comment and ADR 0043's control-plane
 * sequencing). `payment_attempts.job_id` is nullable instead, matching
 * the existing `security_events.job_id` nullable-FK precedent already in
 * migration 0001.
 *
 * A real-D1 proof (`apps/edge-api/tests/d1-payment-attempts.test.ts`)
 * surfaced that D1/Miniflare's `.run()` **throws** on a UNIQUE constraint
 * violation rather than returning `{ success: false, error }` the way
 * `D1IdempotencyRepository.acquire()`'s own doc comment describes — this
 * adapter therefore checks for a UNIQUE-constraint signature in both the
 * thrown-exception path and the (defensively still-handled)
 * unsuccessful-result path.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type {
  AcquireOutcome,
  PaymentAttemptBinding,
  PaymentAttemptRecord,
  PaymentAttemptRepository,
  PaymentLifecycleStage,
} from '@siteborne/protocol-x402';
import {
  isLegalLifecycleTransition,
  validatePaymentAttemptBinding,
} from '@siteborne/protocol-x402';
import { getD1Failure } from './shared';

function mapRow(row: Record<string, unknown>): PaymentAttemptRecord {
  const bindingVersion =
    row.binding_version === null || row.binding_version === undefined
      ? 1
      : Number(row.binding_version);
  const binding: PaymentAttemptBinding = {
    binding_version: bindingVersion as 1 | 2,
    payment_identifier: row.payment_identifier as string,
    quote_id: row.quote_id as string,
    requirement_id: row.requirement_id as string,
    service_id: row.service_id as PaymentAttemptBinding['service_id'],
    service_version: row.service_version as 'v1',
    contract_release: row.contract_release as string,
    request_input_hash: row.request_input_hash as string,
    resource_id: row.resource_id as string,
    scheme: row.scheme as 'exact' | 'upto',
    network: row.network as PaymentAttemptBinding['network'],
    asset: row.asset as string,
    amount: row.amount as string,
    payee: row.payee as string,
    ...(row.job_id !== null && row.job_id !== undefined ? { job_id: row.job_id as string } : {}),
    ...(row.idempotency_key !== null && row.idempotency_key !== undefined
      ? { idempotency_key: row.idempotency_key as string }
      : {}),
    ...(bindingVersion === 2
      ? {
          payment_rail: row.payment_rail as PaymentAttemptBinding['payment_rail'],
          payment_provider: row.payment_provider as PaymentAttemptBinding['payment_provider'],
          ...(row.nevermined_agent_id !== null && row.nevermined_agent_id !== undefined
            ? { nevermined_agent_id: row.nevermined_agent_id as string }
            : {}),
          ...(row.nevermined_plan_id !== null && row.nevermined_plan_id !== undefined
            ? { nevermined_plan_id: row.nevermined_plan_id as string }
            : {}),
          ...(row.nevermined_delegation_id !== null && row.nevermined_delegation_id !== undefined
            ? { nevermined_delegation_id: row.nevermined_delegation_id as string }
            : {}),
        }
      : {}),
  };
  return {
    payment_identifier: row.payment_identifier as string,
    binding_digest: row.binding_digest as string,
    binding,
    created_at: row.created_at as string,
    expires_at: row.expires_at as string,
    consumed: row.consumed_at !== null && row.consumed_at !== undefined,
  };
}

/** Required, non-nullable string columns every stored row must have — a
 * row missing any of these is treated as corrupted (directive §16's
 * "malformed stored binding" case), never silently coerced. */
const REQUIRED_STRING_COLUMNS = [
  'payment_identifier',
  'binding_digest',
  'quote_id',
  'requirement_id',
  'service_id',
  'service_version',
  'contract_release',
  'request_input_hash',
  'resource_id',
  'scheme',
  'network',
  'asset',
  'amount',
  'payee',
  'created_at',
  'expires_at',
] as const;

function tryMapRow(row: Record<string, unknown>): PaymentAttemptRecord | { error: string } {
  for (const column of REQUIRED_STRING_COLUMNS) {
    if (typeof row[column] !== 'string' || (row[column] as string).length === 0) {
      return { error: `stored payment_attempts row is missing/malformed column "${column}"` };
    }
  }
  try {
    const mapped = mapRow(row);
    const validation = validatePaymentAttemptBinding(mapped.binding);
    return validation.valid
      ? mapped
      : { error: `stored payment_attempts binding is invalid: ${validation.reason}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'unknown row-mapping error' };
  }
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isUniqueConstraintViolation(e: unknown): boolean {
  return describeError(e).includes('UNIQUE constraint');
}

export class D1PaymentAttemptRepository implements PaymentAttemptRepository {
  constructor(private readonly db: D1Database) {}

  async acquire(record: PaymentAttemptRecord): Promise<AcquireOutcome> {
    const b = record.binding;
    const validation = validatePaymentAttemptBinding(b);
    if (!validation.valid) {
      return { status: 'error', reason: `invalid payment-attempt binding: ${validation.reason}` };
    }
    // `nevermined_delegation_id` is written here (at acquire time, as part
    // of the immutable binding) AND later, redundantly, by
    // `recordSettlementPending` — the same real-world value both times.
    // Migration 0006 added the column for the settlement-recovery
    // correlation write; SUN-0900B checkpoint 1B route-recovery wiring
    // additionally makes it part of the binding itself (so a reused
    // Payment-Identifier with a *different* delegationId is
    // `duplicate_conflict`, never silently accepted) — no new migration
    // needed, the column already anticipated exactly this field.
    const stmt = this.db.prepare(`
      INSERT INTO payment_attempts (
        id, payment_identifier, binding_digest, quote_id, requirement_id,
        service_id, service_version, contract_release, request_input_hash,
        resource_id, scheme, network, asset, amount, payee, job_id,
        idempotency_key, created_at, expires_at, binding_version, payment_rail,
        payment_provider, nevermined_agent_id, nevermined_plan_id, nevermined_delegation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let insertSucceeded = false;
    let insertUniqueViolation = false;
    let insertOtherError: string | undefined;

    try {
      const result = await stmt
        .bind(
          crypto.randomUUID(),
          record.payment_identifier,
          record.binding_digest,
          b.quote_id,
          b.requirement_id,
          b.service_id,
          b.service_version,
          b.contract_release,
          b.request_input_hash,
          b.resource_id,
          b.scheme,
          b.network,
          b.asset,
          b.amount,
          b.payee,
          b.job_id ?? null,
          b.idempotency_key ?? null,
          record.created_at,
          record.expires_at,
          validation.version,
          b.payment_rail ?? null,
          b.payment_provider ?? null,
          b.nevermined_agent_id ?? null,
          b.nevermined_plan_id ?? null,
          b.nevermined_delegation_id ?? null
        )
        .run();

      const failure = getD1Failure(result);
      if (!failure) {
        insertSucceeded = true;
      } else if (failure.includes('UNIQUE constraint')) {
        insertUniqueViolation = true;
      } else {
        insertOtherError = failure;
      }
    } catch (e) {
      // D1/Miniflare throws on a UNIQUE constraint violation rather than
      // returning an unsuccessful result — verified directly by
      // d1-payment-attempts.test.ts. Distinguish that expected case from a
      // genuine repository failure (directive §16: a persistence failure
      // must never be interpreted as first_seen or a safe duplicate).
      if (isUniqueConstraintViolation(e)) {
        insertUniqueViolation = true;
      } else {
        insertOtherError = describeError(e);
      }
    }

    if (insertSucceeded) {
      return { status: 'acquired', record };
    }
    if (insertOtherError !== undefined) {
      return { status: 'error', reason: insertOtherError };
    }
    if (!insertUniqueViolation) {
      // Unreachable in practice (one of the three branches above always
      // sets exactly one of these), but fails closed rather than falling
      // through silently if it ever is.
      return { status: 'error', reason: 'insert outcome could not be determined' };
    }

    // UNIQUE constraint violation: another attempt already owns this
    // payment_identifier. Re-read the authoritative existing row — never
    // trust the candidate we tried to insert.
    let existing: Record<string, unknown> | null;
    try {
      existing = await this.getRawByIdentifier(record.payment_identifier);
    } catch (e) {
      return { status: 'error', reason: describeError(e) };
    }
    if (!existing) {
      // The conflicting row vanished between the failed INSERT and this
      // re-read (e.g. concurrent expiry cleanup) — a genuine repository
      // inconsistency, reported closed rather than guessed at.
      return {
        status: 'error',
        reason: `UNIQUE constraint conflict reported for "${record.payment_identifier}" but no existing row could be re-read`,
      };
    }
    const mapped = tryMapRow(existing);
    if ('error' in mapped) {
      return { status: 'error', reason: mapped.error };
    }
    return { status: 'conflict', existing: mapped };
  }

  async getByIdentifier(paymentIdentifier: string): Promise<PaymentAttemptRecord | null> {
    let row: Record<string, unknown> | null;
    try {
      row = await this.getRawByIdentifier(paymentIdentifier);
    } catch {
      // getByIdentifier's signature has no closed error variant (unlike
      // acquire()'s AcquireOutcome) — a lookup failure and "not found" are
      // deliberately indistinguishable here. Callers that need to
      // distinguish a repository failure from a genuine absence should use
      // acquire(), whose error path is closed and typed.
      return null;
    }
    if (!row) return null;
    const mapped = tryMapRow(row);
    return 'error' in mapped ? null : mapped;
  }

  /**
   * SUN-0700A checkpoint 3 (directive §25, §27-28): atomically transitions
   * a payment attempt's own summary lifecycle stage
   * (`payment_attempts.lifecycle_stage`, migration
   * 0003_payment_lifecycle_stage.sql). Guarded at the database layer — the
   * UPDATE's `WHERE lifecycle_stage = ?` clause means it can only affect a
   * row that is still in the expected `from` stage; if another concurrent
   * caller already moved it, `meta.changes` is 0 and this returns
   * `illegal_transition` without touching the row, never silently
   * overwriting a state another transition already claimed.
   */
  async transitionLifecycleStage(
    paymentIdentifier: string,
    from: PaymentLifecycleStage,
    to: PaymentLifecycleStage
  ): Promise<
    | { status: 'transitioned' }
    | { status: 'illegal_transition' }
    | { status: 'error'; reason: string }
  > {
    if (!isLegalLifecycleTransition(from, to)) {
      return { status: 'illegal_transition' };
    }
    try {
      const result = await this.db
        .prepare(
          `UPDATE payment_attempts SET lifecycle_stage = ? WHERE payment_identifier = ? AND lifecycle_stage = ?`
        )
        .bind(to, paymentIdentifier, from)
        .run();
      const failure = getD1Failure(result);
      if (failure) return { status: 'error', reason: failure };
      if ((result.meta?.changes ?? 0) === 0) {
        // Either the identifier doesn't exist, or it is no longer in the
        // expected `from` stage (a concurrent transition already moved
        // it) — both are `illegal_transition` from this call's point of
        // view: it did not, and could not, apply.
        return { status: 'illegal_transition' };
      }
      return { status: 'transitioned' };
    } catch (e) {
      return {
        status: 'error',
        reason: e instanceof Error ? e.message : 'unknown transition error',
      };
    }
  }

  async getLifecycleStage(paymentIdentifier: string): Promise<PaymentLifecycleStage | null> {
    const row = await this.getRawByIdentifier(paymentIdentifier);
    if (!row || typeof row.lifecycle_stage !== 'string') return null;
    return row.lifecycle_stage as PaymentLifecycleStage;
  }

  async markConsumed(paymentIdentifier: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE payment_attempts SET consumed_at = ? WHERE payment_identifier = ? AND consumed_at IS NULL`
      )
      .bind(new Date().toISOString(), paymentIdentifier)
      .run();
  }

  /**
   * SUN-0900B checkpoint 1B recovery hardening (migration
   * 0006_settlement_recovery.sql). Durably records the non-secret
   * correlation data a crash-recovery reconciliation pass needs, and
   * atomically transitions `lifecycle_stage` from `executed` to
   * `settlement_pending` in the SAME statement — a caller must call this
   * BEFORE ever invoking a facilitator's settle operation, never after.
   * Never accepts (and this type signature cannot express) an access
   * token, API key, authorization header, or any other secret.
   */
  async recordSettlementPending(
    paymentIdentifier: string,
    correlation: {
      neverminedDelegationId?: string;
      settlementPermissionHash?: string;
      serviceOutputHash?: string;
      serviceReceiptId?: string;
    }
  ): Promise<
    | { status: 'transitioned' }
    | { status: 'illegal_transition' }
    | { status: 'error'; reason: string }
  > {
    try {
      // SUN-1221E6R-H2AWI-3 fix (discovered via real-D1 integration
      // testing against the durable-continuation Workflow, H2AWI-2):
      // H2AWI-2's own `runSettlementStep` calls this method with only
      // `serviceOutputHash` populated -- its `DecryptedContinuationPayload`
      // (H2AWI-1, frozen) carries no Nevermined delegation-correlation
      // field at all. The four correlation columns below were previously
      // unconditionally overwritten (`= ?` with `?? null`), so ANY caller
      // that omits one silently WIPES an already-correct value written by
      // an earlier call (e.g. the initial `acquirePaymentAttempt` binding
      // write's `nevermined_delegation_id`) -- a real, observed data-
      // integrity regression, not merely a missing feature: a
      // `payment_attempts` row could reach a state
      // `validatePaymentAttemptBinding` then rejects on read-back
      // (`nevermined_binding_requires_delegation_id`), corrupting the
      // NEXT request's ability to even classify a replay/conflict.
      // `COALESCE` makes every one of these four columns write-once-then-
      // preserve when a caller doesn't supply a value, matching how a
      // partial-knowledge caller (like this Workflow) should behave by
      // default -- never silently regress an already-recorded correlation
      // fact. Callers that DO have a real value (the original in-request
      // Nevermined path, when re-enabled) still overwrite normally.
      const result = await this.db
        .prepare(
          `UPDATE payment_attempts SET
             lifecycle_stage = 'settlement_pending',
             nevermined_delegation_id = COALESCE(?, nevermined_delegation_id),
             settlement_permission_hash = COALESCE(?, settlement_permission_hash),
             service_output_hash = COALESCE(?, service_output_hash),
             service_receipt_id = COALESCE(?, service_receipt_id),
             settlement_pending_at = ?
           WHERE payment_identifier = ? AND lifecycle_stage = 'executed'`
        )
        .bind(
          correlation.neverminedDelegationId ?? null,
          correlation.settlementPermissionHash ?? null,
          correlation.serviceOutputHash ?? null,
          correlation.serviceReceiptId ?? null,
          new Date().toISOString(),
          paymentIdentifier
        )
        .run();
      const failure = getD1Failure(result);
      if (failure) return { status: 'error', reason: failure };
      if ((result.meta?.changes ?? 0) === 0) {
        return { status: 'illegal_transition' };
      }
      return { status: 'transitioned' };
    } catch (e) {
      return {
        status: 'error',
        reason: e instanceof Error ? e.message : 'unknown settlement_pending write error',
      };
    }
  }

  /**
   * SUN-1200 checkpoint C: records the outcome classification of a
   * `verified`/`settlement_pending -> settlement_failed` transition
   * (CDP rail) and increments the real facilitator settle-attempt
   * counter atomically with it. `kind: 'explicit_rejection'` is
   * permanently terminal (matches the frozen policy already applied
   * identically to both rails); `kind: 'ambiguous'` is the only outcome
   * `attemptCdpRecovery` may ever act on. `from: 'settlement_failed'` is
   * used only by a recovery retry re-confirming/reclassifying an
   * already-`settlement_failed` row (an idempotent stage no-op that
   * still updates the outcome kind/attempt count/tx reference). Never
   * accepts a secret value.
   */
  async recordCdpSettlementOutcome(
    paymentIdentifier: string,
    from: 'verified' | 'settlement_pending' | 'settlement_failed',
    kind: 'explicit_rejection' | 'ambiguous',
    candidateTransactionReference?: string
  ): Promise<
    | { status: 'transitioned' }
    | { status: 'illegal_transition' }
    | { status: 'error'; reason: string }
  > {
    try {
      const result = await this.db
        .prepare(
          `UPDATE payment_attempts SET
             lifecycle_stage = 'settlement_failed',
             settlement_outcome_kind = ?,
             settlement_transaction_reference = COALESCE(?, settlement_transaction_reference),
             cdp_facilitator_settle_attempt_count = cdp_facilitator_settle_attempt_count + 1
           WHERE payment_identifier = ? AND lifecycle_stage = ?`
        )
        .bind(kind, candidateTransactionReference ?? null, paymentIdentifier, from)
        .run();
      const failure = getD1Failure(result);
      if (failure) return { status: 'error', reason: failure };
      if ((result.meta?.changes ?? 0) === 0) {
        return { status: 'illegal_transition' };
      }
      return { status: 'transitioned' };
    } catch (e) {
      return {
        status: 'error',
        reason: e instanceof Error ? e.message : 'unknown cdp settlement-outcome write error',
      };
    }
  }

  /**
   * SUN-1200 checkpoint C: increments the real facilitator settle-attempt
   * counter for a bounded recovery retry, without changing
   * `lifecycle_stage` (the retry's own outcome decides the next stage
   * transition separately). Used only inside `attemptCdpRecovery`'s
   * bounded single retry.
   */
  async incrementCdpSettleAttemptCount(paymentIdentifier: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE payment_attempts SET cdp_facilitator_settle_attempt_count = cdp_facilitator_settle_attempt_count + 1 WHERE payment_identifier = ?`
      )
      .bind(paymentIdentifier)
      .run();
  }

  /**
   * SUN-1200 checkpoint C: records a real, confirmed successful economic
   * settlement discovered/produced during recovery (chain-receipt
   * confirmation or a successful bounded retry) — separate counter from
   * the attempt count above, so `successful_economic_settlement_count`
   * can never exceed 1 even when `facilitator_settle_attempt_count` is 2.
   */
  async incrementCdpSuccessfulSettlementCount(paymentIdentifier: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE payment_attempts SET cdp_successful_economic_settlement_count = cdp_successful_economic_settlement_count + 1 WHERE payment_identifier = ?`
      )
      .bind(paymentIdentifier)
      .run();
  }

  /** Read-only recovery lookup — the correlation data a crash-recovery
   * reconciliation pass reads back after a restart. Never returns a
   * secret (none is ever written by `recordSettlementPending`). */
  async getSettlementRecoveryRecord(paymentIdentifier: string): Promise<{
    lifecycleStage: PaymentLifecycleStage;
    neverminedDelegationId: string | null;
    settlementPermissionHash: string | null;
    serviceOutputHash: string | null;
    serviceReceiptId: string | null;
    settlementTransactionReference: string | null;
    settlementPendingAt: string | null;
    /** SUN-1200 checkpoint C: 'explicit_rejection' | 'ambiguous' | null.
     * Rail-neutral by column name, but only ever written by the CDP
     * recovery path today -- Nevermined's own recovery gate
     * (`isExplicitProviderFailure` in x402-service.ts) makes the same
     * distinction without persisting it, since its recovery mechanism
     * never needs to re-check this field across a restart. */
    settlementOutcomeKind: 'explicit_rejection' | 'ambiguous' | null;
    cdpFacilitatorSettleAttemptCount: number;
    cdpSuccessfulEconomicSettlementCount: number;
  } | null> {
    const row = await this.getRawByIdentifier(paymentIdentifier);
    if (!row || typeof row.lifecycle_stage !== 'string') return null;
    return {
      lifecycleStage: row.lifecycle_stage as PaymentLifecycleStage,
      neverminedDelegationId: (row.nevermined_delegation_id as string | null) ?? null,
      settlementPermissionHash: (row.settlement_permission_hash as string | null) ?? null,
      serviceOutputHash: (row.service_output_hash as string | null) ?? null,
      serviceReceiptId: (row.service_receipt_id as string | null) ?? null,
      settlementTransactionReference:
        (row.settlement_transaction_reference as string | null) ?? null,
      settlementPendingAt: (row.settlement_pending_at as string | null) ?? null,
      settlementOutcomeKind:
        (row.settlement_outcome_kind as 'explicit_rejection' | 'ambiguous' | null) ?? null,
      cdpFacilitatorSettleAttemptCount: Number(row.cdp_facilitator_settle_attempt_count ?? 0),
      cdpSuccessfulEconomicSettlementCount: Number(
        row.cdp_successful_economic_settlement_count ?? 0
      ),
    };
  }

  /**
   * SUN-1222C-R4-D10 — operator discovery surface for economic ambiguity
   * that automated reconciliation could not resolve (design §13 /
   * `reconcileAmbiguousSettlement`'s `inconclusive` outcome, and the
   * pre-settle CAS-contention `ambiguous_unresolved` case in
   * `paid-continuation-workflow.ts`'s `runSettlementStep`). Both converge
   * on exactly one durable fact this method reads: a row still sitting at
   * `lifecycle_stage = 'settlement_pending'`.
   *
   * Read-only, non-economic, and additive: no new column (reuses
   * `settlement_pending_at`, already indexed by
   * `idx_payment_attempts_settlement_pending`, migration
   * 0006_settlement_recovery.sql), no new table, no write path. Returns
   * only fields already surfaced elsewhere in this repository
   * (`mapRow`/`getSettlementRecoveryRecord`) — no secret, private key,
   * wallet material, authorization header, or raw payment signature is
   * ever a column on this table, so none can leak through this method
   * either (see `payment-attempts-unresolved-settlements.test.ts`'s
   * dedicated forbidden-field assertion).
   *
   * `olderThanMs`/`nowUnixMs` let a caller restrict the result to rows
   * that have been pending longer than a given age — deliberately NOT a
   * default threshold invented by this method: D10's audit found no
   * existing authoritative concept of reconciliation-attempt-count or
   * retry-exhaustion to derive one from (`reconcileAmbiguousSettlement`'s
   * bounded 5-retry loop is entirely in-memory, per-Workflow-invocation,
   * never persisted), so age filtering is left to the caller/runbook
   * rather than guessed here.
   */
  async listUnresolvedSettlements(options?: {
    readonly olderThanMs?: number;
    readonly nowUnixMs?: number;
    readonly limit?: number;
  }): Promise<
    ReadonlyArray<{
      readonly paymentIdentifier: string;
      readonly jobId: string | null;
      readonly serviceId: string;
      readonly serviceVersion: string;
      readonly resourceId: string;
      readonly network: string;
      readonly amount: string;
      readonly payee: string;
      readonly settlementPendingAt: string | null;
      readonly settlementTransactionReference: string | null;
      readonly settlementOutcomeKind: 'explicit_rejection' | 'ambiguous' | null;
      readonly cdpFacilitatorSettleAttemptCount: number;
    }>
  > {
    const limit = options?.limit ?? 100;
    const conditions = [`lifecycle_stage = 'settlement_pending'`];
    const params: unknown[] = [];
    if (options?.olderThanMs !== undefined) {
      const threshold = new Date(
        (options.nowUnixMs ?? Date.now()) - options.olderThanMs
      ).toISOString();
      conditions.push(`settlement_pending_at IS NOT NULL AND settlement_pending_at < ?`);
      params.push(threshold);
    }
    const result = await this.db
      .prepare(
        `SELECT payment_identifier, job_id, service_id, service_version, resource_id,
                network, amount, payee, settlement_pending_at,
                settlement_transaction_reference, settlement_outcome_kind,
                cdp_facilitator_settle_attempt_count
           FROM payment_attempts
          WHERE ${conditions.join(' AND ')}
          ORDER BY settlement_pending_at ASC
          LIMIT ?`
      )
      .bind(...params, limit)
      .all();
    if (!result.success) return [];
    return result.results.map((row) => ({
      paymentIdentifier: row.payment_identifier as string,
      jobId: (row.job_id as string | null) ?? null,
      serviceId: row.service_id as string,
      serviceVersion: row.service_version as string,
      resourceId: row.resource_id as string,
      network: row.network as string,
      amount: row.amount as string,
      payee: row.payee as string,
      settlementPendingAt: (row.settlement_pending_at as string | null) ?? null,
      settlementTransactionReference: (row.settlement_transaction_reference as string | null) ?? null,
      settlementOutcomeKind:
        (row.settlement_outcome_kind as 'explicit_rejection' | 'ambiguous' | null) ?? null,
      cdpFacilitatorSettleAttemptCount: Number(row.cdp_facilitator_settle_attempt_count ?? 0),
    }));
  }

  /** Records the settlement transaction reference once external
   * reconciliation (or a normal synchronous settle response) confirms
   * `SETTLED`/`settled_external`. Additive to `recordSettlementPending` —
   * separate so a crash between the two writes is itself recoverable
   * (the correlation data from the first write is enough to reconcile). */
  async recordSettledExternal(
    paymentIdentifier: string,
    settlementTransactionReference: string | undefined,
    /** Defaults to the normal, forward-path predecessor only. The single
     * additional value this ever needs — `'settlement_failed'` — exists
     * only for `attemptNeverminedRecovery`'s narrow, evidence-gated
     * recovery of a historical false-rejection (SUN-0900B checkpoint 1B,
     * third real-live-run incident); every other caller keeps the exact
     * prior behavior by omitting this parameter. This CAS `WHERE ...IN`
     * clause is still the sole atomicity guarantee — it does not itself
     * decide whether recovering FROM `settlement_failed` is appropriate,
     * only enforces that the row was in one of the stages the caller
     * declared acceptable. */
    fromStages: readonly ('settlement_pending' | 'settlement_failed')[] = ['settlement_pending']
  ): Promise<
    | { status: 'transitioned' }
    | { status: 'illegal_transition' }
    | { status: 'error'; reason: string }
  > {
    try {
      const placeholders = fromStages.map(() => '?').join(', ');
      const result = await this.db
        .prepare(
          `UPDATE payment_attempts SET
             lifecycle_stage = 'settled_external',
             settlement_transaction_reference = ?
           WHERE payment_identifier = ? AND lifecycle_stage IN (${placeholders})`
        )
        .bind(settlementTransactionReference ?? null, paymentIdentifier, ...fromStages)
        .run();
      const failure = getD1Failure(result);
      if (failure) return { status: 'error', reason: failure };
      if ((result.meta?.changes ?? 0) === 0) {
        return { status: 'illegal_transition' };
      }
      return { status: 'transitioned' };
    } catch (e) {
      return {
        status: 'error',
        reason: e instanceof Error ? e.message : 'unknown settled_external write error',
      };
    }
  }

  private async getRawByIdentifier(
    paymentIdentifier: string
  ): Promise<Record<string, unknown> | null> {
    const result = await this.db
      .prepare(`SELECT * FROM payment_attempts WHERE payment_identifier = ?`)
      .bind(paymentIdentifier)
      .all();
    if (!result.success || result.results.length === 0) return null;
    return result.results[0] as Record<string, unknown>;
  }
}
