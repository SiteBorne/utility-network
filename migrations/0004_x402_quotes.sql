-- SITEBORNE Utility Network - D1 Migrations
-- Migration 0004: x402_quotes (SUN-0700A checkpoint 5)
--
-- A quote/requirement is minted at 402-issue time and must survive to the
-- buyer's later PAYMENT-SIGNATURE retry — Cloudflare Workers are
-- stateless per-request, so this cannot live in memory. The existing
-- `payment_quotes` table (migration 0001) is NOT reused: it declares
-- `job_id TEXT NOT NULL` with a foreign key into `jobs(id)`, but an x402
-- quote is minted *before* any job exists (the same reasoning that led
-- checkpoint 2's ADR 0043 to create `payment_attempts` as its own table
-- rather than reuse `idempotency_records`/`payment_quotes`) — and its
-- column shape (amount_usd, payment_method, facilitator, verified_at,
-- settled_at) models a different, CDP-facilitator-era concept that no
-- code in this repository has ever actually written to.
--
-- `x402_quotes` stores the exact, already-canonical `Quote` and
-- `PaymentRequirements` objects `@siteborne/protocol-x402`'s
-- `buildQuote`/`buildExactPaymentRequirement`/`buildUptoPaymentRequirement`
-- produced (as JSON) so a later request can re-validate a buyer's echoed
-- `payload.accepted` against the exact same quote, never a re-derived
-- approximation. See docs/decisions/0051-http-vertical-slice-architecture.md.

CREATE TABLE IF NOT EXISTS x402_quotes (
  quote_id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  scheme TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  quote_json TEXT NOT NULL,
  requirement_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_x402_quotes_expires ON x402_quotes(expires_at);
CREATE INDEX IF NOT EXISTS idx_x402_quotes_service ON x402_quotes(service_id);

-- x402_service_results: the authoritative content a retry reconstructs
-- from, keyed by job_id (one row per DELIVERED logical job). The
-- existing `job_artifacts` table (migration 0001) records only
-- metadata (content_hash/media_type/byte_length) — actual bytes live in
-- a separate `ArtifactStore` abstraction that, in this checkpoint's
-- wiring, is in-memory and does not survive a repository/router
-- instance being recreated. Retry reconstruction (directive §14) must
-- survive that recreation, so the full result is additionally persisted
-- here, directly in D1.
CREATE TABLE IF NOT EXISTS x402_service_results (
  job_id TEXT PRIMARY KEY,
  payment_identifier TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_x402_service_results_payment_identifier
  ON x402_service_results(payment_identifier);
