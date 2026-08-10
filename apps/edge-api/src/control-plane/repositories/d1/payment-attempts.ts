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
} from '@siteborne/protocol-x402';

function mapRow(row: Record<string, unknown>): PaymentAttemptRecord {
  const binding: PaymentAttemptBinding = {
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
    return mapRow(row);
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
    const stmt = this.db.prepare(`
      INSERT INTO payment_attempts (
        id, payment_identifier, binding_digest, quote_id, requirement_id,
        service_id, service_version, contract_release, request_input_hash,
        resource_id, scheme, network, asset, amount, payee, job_id,
        idempotency_key, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          record.expires_at
        )
        .run();

      if (result.success) {
        insertSucceeded = true;
      } else if (result.error?.includes('UNIQUE constraint')) {
        insertUniqueViolation = true;
      } else {
        insertOtherError = result.error ?? 'insert failed for an unknown reason';
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

  async markConsumed(paymentIdentifier: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE payment_attempts SET consumed_at = ? WHERE payment_identifier = ? AND consumed_at IS NULL`
      )
      .bind(new Date().toISOString(), paymentIdentifier)
      .run();
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
