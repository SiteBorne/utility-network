-- SITEBORNE Utility Network - D1 Migrations
-- Migration 0009: SEC EDGAR aggregate sliding-window rate coordination
-- (SUN-1222C2-Q1-R2)
--
-- Closes the gap SUN-1222C2-Q1-R1/R2 found: SecSubmissionsAdapter's own
-- per-instance TokenBucketLimiter is reconstructed fresh on every single
-- production executor invocation (a new adapter per job -- see
-- apps/edge-api/src/control-plane/rate-limit/sec-d1-rate-coordinator.ts's
-- own doc comment for the full trace), so it provides zero real aggregate
-- guarantee against SEC's published fair-access ceiling
-- (sec.gov/os/accessing-edgar-data: "no more than 10 requests per second,
-- regardless of the number of machines used").
--
-- A genuine SLIDING window (one row per admitted request timestamp, never
-- a fixed-window counter): eligibility is "how many rows exist with
-- requested_at_ms >= now - 1000", continuously slid, not aligned to a
-- calendar boundary -- this is what avoids the double-burst-at-the-
-- boundary failure mode a naive fixed window has (SUN-1222C2-Q1-R2 §20).
-- Reuses this schema's own already-reviewed atomic-admission idiom
-- (document_ingress_admission_windows / SUN-1222C0-R1): a single INSERT
-- ... SELECT ... WHERE statement is genuinely atomic under concurrent
-- callers because D1 serializes writes to one logical database (single-
-- writer SQLite underneath) -- not "eventually consistent" the way
-- Cloudflare's native Workers Rate Limiting binding documents itself as
-- being (rejected for this exact reason by SUN-1222C0-R1's own module
-- doc comment, cited again here rather than re-litigated).
--
-- One row per admitted request (provider_id, requested_at_ms). Rows are
-- self-cleaned by the application on every acquire attempt (see
-- SecD1RateCoordinator.tryAcquire's own doc comment) -- never unbounded.
CREATE TABLE IF NOT EXISTS provider_rate_window (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  requested_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_rate_window_provider_time
  ON provider_rate_window (provider_id, requested_at_ms);
