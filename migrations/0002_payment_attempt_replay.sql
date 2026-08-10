-- SITEBORNE Utility Network - D1 Migrations
-- Migration 0002: Payment-attempt replay/idempotency (SUN-0700A checkpoint 2 closure)
--
-- Neither existing idempotency_records nor payment_quotes fits this record:
-- both declare `job_id`/`original_job_id` NOT NULL with a foreign key into
-- jobs(id) — but a payment attempt (directive: 402 requirement ->
-- PAYMENT-SIGNATURE received -> structural parse -> payment identifier
-- extraction -> authoritative acquisition -> external verify/settle
-- (SUN-0700B) -> service execution) is authoritatively acquired BEFORE a
-- job exists, not after. Reusing either table would require fabricating a
-- placeholder jobs row for every payment attempt just to satisfy an
-- unrelated NOT NULL constraint — semantically wrong, not merely
-- inconvenient. job_id here is therefore nullable (matching the existing
-- security_events.job_id nullable-FK precedent in migration 0001), backfilled
-- once a real job is created downstream.
--
-- The authoritative ownership rule (one payment_identifier -> one immutable
-- binding) is enforced by the database itself via
-- idx_payment_attempts_identifier's UNIQUE constraint — not by
-- application-level read-then-write logic.

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY,
  payment_identifier TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_version TEXT NOT NULL,
  contract_release TEXT NOT NULL,
  request_input_hash TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  scheme TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  payee TEXT NOT NULL,
  job_id TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

-- The authoritative uniqueness constraint: one payment_identifier can only
-- ever own one row. A second INSERT attempt for the same identifier fails
-- at the database layer (SQLITE_CONSTRAINT), which
-- D1PaymentAttemptRepository.acquire() converts into a 'conflict' result —
-- never an application-level SELECT-then-INSERT race.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_identifier ON payment_attempts(payment_identifier);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_expires ON payment_attempts(expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_quote ON payment_attempts(quote_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_job ON payment_attempts(job_id);
