-- SITEBORNE Utility Network - D1 Migrations
-- Migration 0007: CDP-rail settlement-recovery accounting (SUN-1200
-- checkpoint C recovery convergence)
--
-- Migration 0006 added durable settlement-recovery correlation columns,
-- but every one of them was written and read only for the Nevermined
-- rail (`nevermined_delegation_id`, `settlement_permission_hash`).
-- `settlement_transaction_reference`, `service_output_hash`,
-- `service_receipt_id`, and `settlement_pending_at` are already
-- rail-neutral by name and are reused as-is for CDP recovery -- this
-- migration adds only the columns genuinely new to CDP's own recovery
-- accounting, and does not reinterpret any Nevermined-specific column.
--
-- `settlement_outcome_kind` distinguishes an EXPLICIT, definitive
-- provider rejection (never recoverable, matches the frozen policy
-- already applied identically on both rails) from an AMBIGUOUS outcome
-- (timeout, transport failure, malformed response after a possible
-- economic mutation -- recoverable via read-only chain reconciliation or
-- a bounded identical settle retry, CDP rail only for now).
--
-- The two counters are accounting only, never used as an authorization
-- gate by themselves: `cdp_facilitator_settle_attempt_count` counts every
-- real `.settle()` call regardless of outcome;
-- `cdp_successful_economic_settlement_count` counts only calls that
-- resulted in a real, confirmed on-chain settlement. The invariant this
-- checkpoint's tests prove is `successful_economic_settlement_count <= 1`
-- even when `facilitator_settle_attempt_count` is 2 (one ambiguous
-- attempt, one recovery retry).
--
-- All columns nullable/defaulted and additive: every historical row
-- (Nevermined or CDP, v1 or v2) is completely unaffected.

ALTER TABLE payment_attempts ADD COLUMN settlement_outcome_kind TEXT;
ALTER TABLE payment_attempts ADD COLUMN cdp_facilitator_settle_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_attempts ADD COLUMN cdp_successful_economic_settlement_count INTEGER NOT NULL DEFAULT 0;
