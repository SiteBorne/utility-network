-- SITEBORNE Utility Network - D1 Migrations
-- Migration 0006: durable settlement-recovery correlation (SUN-0900B
-- checkpoint 1B recovery hardening)
--
-- Smallest additive extension to the existing `payment_attempts` table
-- (checkpoint 2) and its `lifecycle_stage` summary state (checkpoint 3,
-- migration 0003) rather than a parallel lifecycle. Every column here is
-- nullable and additive: historical rows (CDP v1 bindings, and any row
-- that never enters the durable-recovery path) are entirely unaffected.
--
-- These columns exist so a `SETTLEMENT_PENDING` write, made durably
-- BEFORE calling a facilitator's settle operation, carries enough
-- non-secret correlation data to reconcile the external outcome after a
-- process crash — never an access token, API key, authorization header,
-- or any other secret material.

ALTER TABLE payment_attempts ADD COLUMN nevermined_delegation_id TEXT;
ALTER TABLE payment_attempts ADD COLUMN settlement_permission_hash TEXT;
ALTER TABLE payment_attempts ADD COLUMN service_output_hash TEXT;
ALTER TABLE payment_attempts ADD COLUMN service_receipt_id TEXT;
ALTER TABLE payment_attempts ADD COLUMN settlement_transaction_reference TEXT;
ALTER TABLE payment_attempts ADD COLUMN settlement_pending_at TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_settlement_pending
  ON payment_attempts(settlement_pending_at);
