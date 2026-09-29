-- R3-PAID-READINESS-BLOCKER-REMEDIATION-57A (B2)
-- Append-only economic observation ledger. LOCAL ONLY until separately
-- authorized for production.
--
-- Additive only: one new table, one index, three triggers. No existing table,
-- column, index or trigger is touched. No runtime reads or writes it yet.
--
-- Unknown stays unknown: every amount column is nullable and NULL means "not
-- observed". There is no default and no zero-fill. Each observation carries
-- per-quantity provenance in body_jcs (value/quality/source), the projected
-- columns are CHECKed against the body. Amounts are non-negative integer
-- strings in the smallest unit of `currency`.
--
-- credit_benefit = normalized_cogs - cash_cogs, and is stored only when both
-- operands were observed, the CHECK recomputes it.
--
-- Authority: economics never grants execution, payment, result-release or
-- settlement authority. authority is pinned to 'NONE', there is no
-- status/permit/flag column and no foreign key into any control-plane table.
-- payment_identifier is an opaque key.
--
-- Append-only: UPDATE and DELETE raise. A different body under an existing id
-- raises. Identical re-insert with ON CONFLICT(observation_id) DO NOTHING is a
-- no-op.
--
-- Statement format: trigger bodies keep their inner terminator directly before
-- END so statement splitters keep each trigger whole.

CREATE TABLE IF NOT EXISTS economic_observations (
  observation_id TEXT PRIMARY KEY CHECK (observation_id GLOB 'eo:[0-9a-f]*' AND length(observation_id) = 67),
  payment_identifier TEXT NOT NULL CHECK (length(payment_identifier) > 0),
  service_id TEXT CHECK (service_id IS NULL OR length(service_id) > 0),
  provider_id TEXT CHECK (provider_id IS NULL OR length(provider_id) > 0),
  execution_id TEXT CHECK (execution_id IS NULL OR length(execution_id) > 0),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'staging', 'local')),
  platform_version_id TEXT CHECK (platform_version_id IS NULL OR length(platform_version_id) > 0),
  currency TEXT NOT NULL CHECK (length(currency) > 0),
  revenue_atomic TEXT CHECK (revenue_atomic IS NULL OR revenue_atomic GLOB '[0-9]*' AND revenue_atomic NOT GLOB '*[^0-9]*'),
  normalized_cogs_atomic TEXT CHECK (normalized_cogs_atomic IS NULL OR normalized_cogs_atomic GLOB '[0-9]*' AND normalized_cogs_atomic NOT GLOB '*[^0-9]*'),
  cash_cogs_atomic TEXT CHECK (cash_cogs_atomic IS NULL OR cash_cogs_atomic GLOB '[0-9]*' AND cash_cogs_atomic NOT GLOB '*[^0-9]*'),
  credit_benefit_atomic TEXT CHECK (credit_benefit_atomic IS NULL OR credit_benefit_atomic GLOB '[0-9]*' AND credit_benefit_atomic NOT GLOB '*[^0-9]*'),
  observation_kind TEXT NOT NULL CHECK (observation_kind IN ('PRE_EXECUTION_BOUND', 'POST_EXECUTION_ACTUAL', 'REVENUE', 'ESTIMATE', 'UNKNOWN')),
  bound_atomic TEXT CHECK (bound_atomic IS NULL OR bound_atomic GLOB '[0-9]*' AND bound_atomic NOT GLOB '*[^0-9]*'),
  observed_at TEXT NOT NULL,
  authority TEXT NOT NULL CHECK (authority = 'NONE'),
  body_jcs TEXT NOT NULL CHECK (
    json_valid(body_jcs)
    AND json_extract(body_jcs, '$.payment_identifier') = payment_identifier
    AND json_extract(body_jcs, '$.environment') = environment
    AND json_extract(body_jcs, '$.currency') = currency
    AND json_extract(body_jcs, '$.observed_at') = observed_at
    AND json_extract(body_jcs, '$.authority') = 'NONE'
    AND json_extract(body_jcs, '$.observation_kind') = observation_kind
    AND json_extract(body_jcs, '$.observation_id') IS NULL
  ),
  inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Kind gates columns: an estimate or unknown never fills an observed-cost column,
  -- a bound is never an actual, and revenue is only revenue.
  CHECK (
    (observation_kind = 'PRE_EXECUTION_BOUND' AND revenue_atomic IS NULL AND normalized_cogs_atomic IS NULL AND cash_cogs_atomic IS NULL AND credit_benefit_atomic IS NULL)
    OR (observation_kind = 'POST_EXECUTION_ACTUAL' AND bound_atomic IS NULL AND revenue_atomic IS NULL)
    OR (observation_kind = 'REVENUE' AND bound_atomic IS NULL AND normalized_cogs_atomic IS NULL AND cash_cogs_atomic IS NULL AND credit_benefit_atomic IS NULL)
    OR (observation_kind IN ('ESTIMATE', 'UNKNOWN') AND bound_atomic IS NULL AND revenue_atomic IS NULL AND normalized_cogs_atomic IS NULL AND cash_cogs_atomic IS NULL AND credit_benefit_atomic IS NULL)
  ),
  CHECK (
    credit_benefit_atomic IS NULL
    OR (normalized_cogs_atomic IS NOT NULL AND cash_cogs_atomic IS NOT NULL
        AND CAST(credit_benefit_atomic AS INTEGER) = CAST(normalized_cogs_atomic AS INTEGER) - CAST(cash_cogs_atomic AS INTEGER))
  )
);

CREATE INDEX IF NOT EXISTS economic_observations_payment ON economic_observations (payment_identifier, observed_at);

CREATE TRIGGER IF NOT EXISTS economic_observations_conflict BEFORE INSERT ON economic_observations
WHEN EXISTS (SELECT 1 FROM economic_observations WHERE observation_id = NEW.observation_id AND body_jcs <> NEW.body_jcs)
BEGIN SELECT RAISE(ABORT, 'economic conflict: observation_id already holds different content'); END;

CREATE TRIGGER IF NOT EXISTS economic_observations_no_update BEFORE UPDATE ON economic_observations
BEGIN SELECT RAISE(ABORT, 'economic observations are append-only'); END;

CREATE TRIGGER IF NOT EXISTS economic_observations_no_delete BEFORE DELETE ON economic_observations
BEGIN SELECT RAISE(ABORT, 'economic observations are append-only'); END;
