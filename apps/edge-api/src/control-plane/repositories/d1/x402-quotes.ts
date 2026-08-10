/**
 * D1-backed persistence for x402 quotes/requirements minted at 402-issue
 * time (SUN-0700A checkpoint 5, migration 0004_x402_quotes.sql). See that
 * migration's header comment for why the pre-existing `payment_quotes`
 * table (migration 0001) is not reused.
 *
 * Stores the exact canonical `Quote`/`PaymentRequirements` objects
 * `@siteborne/protocol-x402` produced, as JSON — a later
 * PAYMENT-SIGNATURE retry re-validates the buyer's echoed
 * `payload.accepted` against the *exact* quote that was issued, never a
 * re-derived approximation (a re-derivation would need to reproduce
 * `issued_at`/`expires_at`, which are wall-clock values from the original
 * request and cannot be deterministically recomputed later).
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { Quote } from '@siteborne/protocol-x402';
import type { PaymentRequirements } from '@x402/core/types';

export interface StoredX402Quote {
  quote: Quote;
  requirement: PaymentRequirements;
  requirement_id: string;
}

export class X402QuoteRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * `INSERT OR IGNORE`, deliberately: `quote_id` is a deterministic
   * digest of the quote's own bound fields
   * (`@siteborne/protocol-x402`'s `buildQuote`) — two calls with
   * identical inputs (same service/input/price/nowIso) always produce
   * the same `quote_id` and, necessarily, identical row content. A
   * buyer that requests the same 402 twice at the same instant (or a
   * test exercising the same fixture input under a fixed injected
   * clock) must not fail with a spurious UNIQUE-constraint error —
   * there is no real conflict to reject, unlike `payment_attempts`
   * (checkpoint 2), where a duplicate `payment_identifier` genuinely
   * can carry a *different* binding and must be classified, not
   * silently ignored.
   */
  async create(
    quote: Quote,
    requirement: PaymentRequirements,
    requirementId: string,
    resourceId: string
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO x402_quotes (
          quote_id, requirement_id, service_id, scheme, resource_id,
          quote_json, requirement_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        quote.quote_id,
        requirementId,
        quote.service_id,
        quote.scheme,
        resourceId,
        JSON.stringify(quote),
        JSON.stringify(requirement),
        quote.issued_at,
        quote.expires_at
      )
      .run();
  }

  async getById(quoteId: string): Promise<StoredX402Quote | null> {
    const result = await this.db
      .prepare(`SELECT * FROM x402_quotes WHERE quote_id = ?`)
      .bind(quoteId)
      .all();
    if (!result.success || result.results.length === 0) return null;
    const row = result.results[0] as Record<string, unknown>;
    try {
      return {
        quote: JSON.parse(row.quote_json as string) as Quote,
        requirement: JSON.parse(row.requirement_json as string) as PaymentRequirements,
        requirement_id: row.requirement_id as string,
      };
    } catch {
      return null;
    }
  }
}

/**
 * D1-backed authoritative retry-reconstruction storage (migration
 * 0004_x402_quotes.sql's `x402_service_results` table) — see that
 * migration's header comment for why this exists alongside (not instead
 * of) the existing `job_artifacts` metadata table.
 */
export class X402ServiceResultRepository {
  constructor(private readonly db: D1Database) {}

  async create(
    jobId: string,
    paymentIdentifier: string,
    result: unknown,
    nowIso: string
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO x402_service_results (job_id, payment_identifier, result_json, created_at) VALUES (?, ?, ?, ?)`
      )
      .bind(jobId, paymentIdentifier, JSON.stringify(result), nowIso)
      .run();
  }

  async getByJobId<T = unknown>(jobId: string): Promise<T | null> {
    const result = await this.db
      .prepare(`SELECT result_json FROM x402_service_results WHERE job_id = ?`)
      .bind(jobId)
      .all();
    if (!result.success || result.results.length === 0) return null;
    const row = result.results[0] as Record<string, unknown>;
    try {
      return JSON.parse(row.result_json as string) as T;
    } catch {
      return null;
    }
  }
}
