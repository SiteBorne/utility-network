-- R3-A3-PROVIDER-EXECUTION-AUTHORITY-41 (A3-EXEC-FENCE-1, A3-PROVIDER-AMBIGUITY-1)
-- Additive only. Existing rows keep NULL, meaning "no provider dispatch
-- claimed yet". Old runtimes never read or write this column.
--
-- provider_dispatched_at is a monotonic, never-expiring claim on the ONE
-- provider (executor) dispatch a payment_identifier may make. The paid
-- continuation Workflow sets it with a CAS on IS NULL immediately before
-- calling the provider. A retry, restart or replay that finds it already set
-- must never redispatch: no SITEBORNE provider accepts an idempotency key or
-- supports lookup of a prior request, so a taken claim means the provider
-- may already have run.
--
-- No index: the claim is written and read only by the existing UNIQUE
-- payment_identifier lookup.

ALTER TABLE payment_workflow_owner_intents ADD COLUMN provider_dispatched_at TEXT;
