-- SITEBORNE Utility Network - D1 Migrations
-- Migration 0003: payment_attempts lifecycle stage (SUN-0700A checkpoint 3)
--
-- Adds a summary lifecycle stage to the checkpoint-2 payment_attempts
-- table (directive §25: "payment_attempts gains a state column" — the
-- option chosen, over a second table or reusing the existing job-domain
-- JobState machine, per docs/decisions/0046). This tracks the PAYMENT
-- ATTEMPT's own progress (acquired -> verified -> settled, or a failure
-- branch) independent of which job it is eventually linked to — it does
-- NOT replace or duplicate JobState, which remains the sole authority
-- over job execution state.
--
-- Smallest additive change: one nullable-safe column with a DEFAULT, no
-- new table, no constraint changes to the existing schema.

ALTER TABLE payment_attempts ADD COLUMN lifecycle_stage TEXT NOT NULL DEFAULT 'acquired';

CREATE INDEX IF NOT EXISTS idx_payment_attempts_lifecycle_stage ON payment_attempts(lifecycle_stage);
