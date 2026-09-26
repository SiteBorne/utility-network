-- R3-A3-ARTIFACT-RECLAIM-OWNERSHIP-34 (A3-CRON-GAP-1)
-- Additive only. Existing rows keep NULL in every new column, which means:
--   reclaim_state NULL  -> live / not claimed (today's behavior)
--   storage_key   NULL  -> legacy shared content-addressed R2 key
--                          (`artifacts/<sha256 hex>`), read exactly as before.
--
-- reclaim_state = 'reclaiming' is a monotonic, never-expiring claim: once set,
-- the row can never be refreshed back to live (`refreshExpiry` is CAS-guarded
-- on reclaim_state IS NULL) and it only leaves that state by being deleted.
-- reclaim_claimed_at records when the claim was acquired, for observability of
-- a claim stuck behind repeated R2/D1 failures.
--
-- storage_key gives every newly uploaded artifact its own R2 object
-- (`artifacts/<sha256 hex>/<row id>`) so a stale or resumed reclaimer, which
-- only ever deletes its own row's object, can never delete bytes belonging to
-- a later artifact row with the same content hash.
--
-- No index: the reclaim sweep already scans job_artifacts without one, and
-- rows in 'reclaiming' are transient and few.

ALTER TABLE job_artifacts ADD COLUMN reclaim_state TEXT CHECK (reclaim_state IS NULL OR reclaim_state = 'reclaiming');
ALTER TABLE job_artifacts ADD COLUMN reclaim_claimed_at TEXT;
ALTER TABLE job_artifacts ADD COLUMN storage_key TEXT;
