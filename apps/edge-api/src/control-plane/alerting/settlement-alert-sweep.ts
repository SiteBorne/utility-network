/**
 * SUN-1222C-R4-D12 — scheduled unresolved-settlement alert sweep.
 *
 * Pure orchestration for the dedicated alert Worker's `scheduled()` handler
 * (see `../../settlement-alert-worker-entrypoint.ts`). This module owns NO
 * economic authority: it only reads the existing, unmodified
 * `listUnresolvedSettlements()` repository contract (D10/D11,
 * `../repositories/d1/payment-attempts.ts`) and performs best-effort
 * outbound HTTPS notification. It never calls `settle()`, `verify()`, any
 * executor-provider, any facilitator client, or any D1 write path —
 * §22's static capability audit is provable by inspection: this file
 * imports nothing from `../workflows/paid-continuation-workflow`, nothing
 * from `@siteborne/protocol-x402`'s facilitator surface, and holds no
 * `D1Database` write handle of its own (the repository itself is injected
 * read-only via the `UnresolvedSettlementSource` interface below, which
 * exposes exactly one method).
 *
 * Dedup/repeat model (D12 §13, `D12_DEDUP_MODEL=BOUNDED_REPEAT`): no new
 * alert-state table is introduced. `payment_attempts.settlement_pending_at`
 * marks when the row *entered* the unresolved state, not when it was last
 * alerted — repurposing it as a last-notified timestamp would misrepresent
 * that column to any other reader (D9's own reconciliation engine reads it
 * too). Absent a dedicated notification-log table (out of D12's scope —
 * would be a schema migration this checkpoint's authorization forbids),
 * the honest, minimal semantics are: every sweep invocation sends at most
 * one webhook attempt per still-unresolved incident it observes. Repeat
 * reminders therefore occur naturally at the deployed cron cadence for as
 * long as an incident remains unresolved, and delivery stops the moment the
 * underlying `payment_attempts` row leaves `lifecycle_stage =
 * 'settlement_pending'` (resolved by D9's reconciliation engine or by
 * manual operator recovery) — `listUnresolvedSettlements()` simply stops
 * returning it on the next sweep. This is `AT_LEAST_ONCE_RECOVERABLE_BY_SWEEP`
 * (D12 §11): the D1 row is the durable source of truth, not the alert
 * Worker's own execution.
 */

export interface UnresolvedSettlementRecord {
  readonly paymentIdentifier: string;
  readonly jobId: string | null;
  readonly settlementPendingAt: string | null;
  readonly settlementTransactionReference: string | null;
  readonly settlementOutcomeKind: 'explicit_rejection' | 'ambiguous' | null;
  readonly cdpFacilitatorSettleAttemptCount: number;
}

/**
 * The exact (narrowed) read surface this module requires from
 * `D1PaymentAttemptRepository.listUnresolvedSettlements()`. Depending on
 * this narrow interface — rather than importing the concrete D1 repository
 * class — is itself part of the static capability proof: this module
 * cannot reach any other repository method (`recordSettlementPending`,
 * `recordSettledExternal`, `acquire`, …) even by accident, because nothing
 * here ever holds a reference to the full repository object.
 */
export interface UnresolvedSettlementSource {
  listUnresolvedSettlements(options?: {
    readonly olderThanMs?: number;
    readonly nowUnixMs?: number;
    readonly limit?: number;
  }): Promise<ReadonlyArray<UnresolvedSettlementRecord>>;
}

/**
 * Generic operator-controlled HTTPS webhook payload (D12 §7/§10). No
 * vendor-specific schema (Slack/Discord/PagerDuty/…) — an operator-side
 * relay is expected to translate this into whatever their paging tool
 * needs. No raw settlement/payment secret material, no signed payment
 * object, no wallet address beyond what is already public production
 * configuration. `transaction_reference_present` is a boolean rather than
 * the raw reference (D12 §10 preference) since the alert consumer needs to
 * know *whether* an on-chain artifact exists to look up during manual
 * reconciliation, not the value itself — the same value is already durably
 * queryable from `payment_attempts` by the incident key.
 */
export interface SettlementAlertPayload {
  readonly event: 'siteborne.settlement.manual_intervention_required';
  readonly payment_identifier: string;
  readonly job_id: string | null;
  readonly recovery_stage: 'explicit_rejection' | 'ambiguous' | 'unknown';
  readonly first_observed_at: string | null;
  readonly last_observed_at: string;
  readonly reconciliation_attempts: number;
  readonly transaction_reference_present: boolean;
}

/**
 * The single outbound side effect this module performs. Injected so real
 * qualification (D12 §27) and all unit tests use a controlled test double
 * — `REAL_WEBHOOK_CALLS=0` outside a separately authorized production
 * deployment with a real provisioned `SETTLEMENT_ALERT_WEBHOOK_URL`. The
 * real implementation (`settlement-alert-worker-entrypoint.ts`) is a thin
 * `fetch(url, { method: 'POST', ... })` wrapper — nothing more.
 */
export type SettlementAlertTransport = (
  payload: SettlementAlertPayload
) => Promise<{ readonly delivered: boolean }>;

export interface SettlementAlertSweepDependencies {
  readonly source: UnresolvedSettlementSource;
  readonly transport: SettlementAlertTransport;
  /** Injectable clock — real caller uses `Date.now()`. */
  readonly nowUnixMs?: number;
  /**
   * D12 §14/§4: rows younger than this are excluded — a row that entered
   * `settlement_pending` moments ago is almost certainly still inside a
   * normal in-flight `settle()` step or D9's own bounded (5-retry)
   * reconciliation attempt, both of which complete inside a single
   * Workflow step invocation (seconds, not minutes). Default 3 minutes:
   * comfortably above that normal-completion window so the sweep does not
   * page an operator for a settlement that is about to resolve itself.
   */
  readonly minimumAgeMs?: number;
  /** D12 §15: bounded records per invocation. Forwarded to the repository
   * query's own `limit`, which already defaults to 100 — kept explicit
   * here so the sweep's bound is visible without reading the repository. */
  readonly maxRecordsPerSweep?: number;
}

export interface SettlementAlertSweepResult {
  readonly consideredCount: number;
  readonly deliveredCount: number;
  readonly failedCount: number;
  readonly failedPaymentIdentifiers: readonly string[];
}

const DEFAULT_MINIMUM_AGE_MS = 3 * 60 * 1000;
const DEFAULT_MAX_RECORDS_PER_SWEEP = 100;

function toPayload(
  record: UnresolvedSettlementRecord,
  nowIso: string
): SettlementAlertPayload {
  return {
    event: 'siteborne.settlement.manual_intervention_required',
    payment_identifier: record.paymentIdentifier,
    job_id: record.jobId,
    recovery_stage: record.settlementOutcomeKind ?? 'unknown',
    first_observed_at: record.settlementPendingAt,
    last_observed_at: nowIso,
    reconciliation_attempts: record.cdpFacilitatorSettleAttemptCount,
    transaction_reference_present: record.settlementTransactionReference !== null,
  };
}

/**
 * Runs exactly one sweep: discover unresolved settlements older than
 * `minimumAgeMs`, attempt exactly one webhook delivery per incident (D12
 * §17: `D12_WEBHOOK_ATTEMPTS_PER_INCIDENT_PER_SWEEP=1` — no in-sweep
 * retry, the next scheduled sweep is the retry mechanism), isolating each
 * record's outcome from the others (D12 §16) so one failing/slow
 * destination cannot hide the remaining incidents. Never mutates any
 * economic state — a transport failure or success is observed and
 * returned, nothing else (D12 §12).
 */
export async function runSettlementAlertSweep(
  deps: SettlementAlertSweepDependencies
): Promise<SettlementAlertSweepResult> {
  const nowUnixMs = deps.nowUnixMs ?? Date.now();
  const nowIso = new Date(nowUnixMs).toISOString();
  const minimumAgeMs = deps.minimumAgeMs ?? DEFAULT_MINIMUM_AGE_MS;
  const limit = deps.maxRecordsPerSweep ?? DEFAULT_MAX_RECORDS_PER_SWEEP;

  const records = await deps.source.listUnresolvedSettlements({
    olderThanMs: minimumAgeMs,
    nowUnixMs,
    limit,
  });

  const failedPaymentIdentifiers: string[] = [];
  let deliveredCount = 0;

  // Sequential, not `Promise.all` — deliberately bounds outbound
  // concurrency to 1 (D12 §16: "do not create unbounded parallel outbound
  // traffic"). Backlogs large enough for this to matter operationally are
  // themselves an incident; correctness here favors a predictable,
  // reviewable sweep over throughput.
  for (const record of records) {
    const payload = toPayload(record, nowIso);
    try {
      const outcome = await deps.transport(payload);
      if (outcome.delivered) {
        deliveredCount += 1;
      } else {
        failedPaymentIdentifiers.push(record.paymentIdentifier);
      }
    } catch {
      // Network error / thrown exception from the transport is a delivery
      // failure like any other (D12 §18) — never rethrown, never allowed
      // to abort remaining records' delivery attempts.
      failedPaymentIdentifiers.push(record.paymentIdentifier);
    }
  }

  return {
    consideredCount: records.length,
    deliveredCount,
    failedCount: failedPaymentIdentifiers.length,
    failedPaymentIdentifiers,
  };
}
