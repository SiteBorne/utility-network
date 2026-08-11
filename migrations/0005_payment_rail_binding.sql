-- SITEBORNE Utility Network - D1 Migrations
-- Migration 0005: additive, versioned payment-rail binding (SUN-0900A checkpoint 1)
--
-- Existing rows predate alternative rails. NULL binding_version/rail/provider
-- therefore means the accepted legacy v1 CDP binding and MUST retain its old
-- digest. Every newly acquired row is written as version 2 by the repository,
-- with rail/provider required there before INSERT. Nevermined identifiers are
-- nullable because they are invalid for CDP rows and absent from legacy rows.

ALTER TABLE payment_attempts ADD COLUMN binding_version INTEGER;
ALTER TABLE payment_attempts ADD COLUMN payment_rail TEXT;
ALTER TABLE payment_attempts ADD COLUMN payment_provider TEXT;
ALTER TABLE payment_attempts ADD COLUMN nevermined_agent_id TEXT;
ALTER TABLE payment_attempts ADD COLUMN nevermined_plan_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_rail ON payment_attempts(payment_rail);
