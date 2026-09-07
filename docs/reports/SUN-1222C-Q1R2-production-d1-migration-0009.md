# SUN-1222C-Q1R2-MIGRATION-0009 — Production D1 Migration 0009 Applied

Source head: `aa2080e` (unchanged by this checkpoint — no repo commit needed
for the migration itself; the SQL file was already committed in R2).

## 0. Original blocker (from SUN-1222C-Q1R2-CANDIDATE-REFRESH)

That checkpoint stopped before candidate upload after proving:

- Stale candidate `efc5a287-d807-4b07-957f-ebbdf471e439` was built from
  `26a7735`, predating R1/R2/R3.
- Current R2 (`SecD1RateCoordinator`) requires a table
  (`provider_rate_window`) that migration `0009_sec_rate_window.sql`
  creates.
- `wrangler d1 migrations list siteborne-utility --remote` showed `0009`
  still pending — the coordinator would fail closed (deny every SEC
  request as `rate_limited`) in production, masking the fix rather than
  proving it.

This checkpoint applies exactly that one migration, nothing else.

## 1. Authorization gate

Standalone authorization present, verbatim, immediately preceding this
checkpoint's own runbook, naming exactly `SUN-1222C-Q1R2-MIGRATION-0009`
and exactly `0009_sec_rate_window.sql`.

```
Q1R2_MIGRATION_0009_AUTHORIZATION=PRESENT
```

## 2. Migration read in full

Path: `migrations/0009_sec_rate_window.sql` (repo-relative). Full content
reproduced below verbatim.

```sql
CREATE TABLE IF NOT EXISTS provider_rate_window (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  requested_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_rate_window_provider_time
  ON provider_rate_window (provider_id, requested_at_ms);
```

(The file also carries an extensive doc comment tracing the design
rationale back to SUN-1222C2-Q1-R1/R2 and SUN-1222C0-R1's own atomic-
admission precedent — omitted here as commentary, not a statement.)

Statement inventory:

| # | Statement | Classification |
|---|---|---|
| 1 | `CREATE TABLE IF NOT EXISTS provider_rate_window (...)` | CREATE TABLE |
| 2 | `CREATE INDEX IF NOT EXISTS idx_provider_rate_window_provider_time ON provider_rate_window (...)` | CREATE INDEX |

```
MIGRATION_0009_PATH=migrations/0009_sec_rate_window.sql
MIGRATION_0009_STATEMENT_COUNT=2
MIGRATION_0009_SCHEMA_OBJECTS_CREATED=table provider_rate_window (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, requested_at_ms INTEGER NOT NULL); index idx_provider_rate_window_provider_time ON provider_rate_window (provider_id, requested_at_ms)
MIGRATION_0009_DATA_MUTATION=NO
MIGRATION_0009_DESTRUCTIVE=NO
MIGRATION_0009_UNRELATED_EFFECTS=NO
```

No INSERT/UPDATE/DELETE/DROP/ALTER/TRIGGER anywhere in the file. Both
statements are additive (`IF NOT EXISTS`-guarded) and scoped exclusively
to the one new table.

## 3. Source dependency proof

`apps/edge-api/src/control-plane/repositories/d1/sec-rate-window.ts`
(`D1SecRateWindowRepository.tryAdmit`) issues exactly two statements
against exactly this table:

- `DELETE FROM provider_rate_window WHERE provider_id = ? AND requested_at_ms < ?`
- `INSERT INTO provider_rate_window (id, provider_id, requested_at_ms) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM provider_rate_window WHERE provider_id = ? AND requested_at_ms >= ?) < ?`

Both reference exactly the three columns the migration creates, and both
filter on `(provider_id, requested_at_ms)` — exactly the composite index
the migration also creates.

```
R2_COORDINATOR_TABLE=provider_rate_window
R2_COORDINATOR_REQUIRED_COLUMNS=id (TEXT PRIMARY KEY), provider_id (TEXT NOT NULL), requested_at_ms (INTEGER NOT NULL)
R2_COORDINATOR_REQUIRED_INDEXES=idx_provider_rate_window_provider_time ON (provider_id, requested_at_ms)
MIGRATION_0009_EXACTLY_SATISFIES_R2=YES
```

## 4. Migration order / dependency

Repo migration sequence: `0001` … `0008_document_ingress_admission_windows.sql`,
then `0009_sec_rate_window.sql` (latest; no migration follows it). The
0009 SQL itself has zero foreign keys and zero references to any other
table — it is fully self-contained. Its only real prerequisite is that
every earlier migration (0001–0008) is already applied, which §5's live
listing (showing 0009 as the *sole* pending migration) proves directly.

```
MIGRATION_0009_PREREQUISITES_SATISFIED=YES
```

## 5. Authoritative pre-mutation remote state

```
$ wrangler d1 migrations list siteborne-utility --remote
Migrations to be applied:
┌──────────────────────────┐
│ Name                     │
├──────────────────────────┤
│ 0009_sec_rate_window.sql │
└──────────────────────────┘
```

```
PENDING_PRODUCTION_MIGRATIONS_BEFORE=[0009_sec_rate_window.sql]
UNEXPECTED_PENDING_MIGRATION=NO
```

## 6. Pre-migration schema proof

```
$ wrangler d1 execute siteborne-utility --remote --command \
  "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE '%provider_rate_window%'"
results: []
```

```
R2_TABLE_PRESENT_BEFORE=NO
AMBIGUOUS_SCHEMA_STATE=NO
```

## 7. Exact command

`wrangler d1 migrations apply --help` confirms the CLI's own contract:
"Apply any unapplied D1 migrations" — there is no per-migration-name
targeting flag. Since §5 already proved `0009` is the *sole* pending
migration, "apply any unapplied migrations" is exactly equivalent to
"apply 0009 only" for this database, at this moment.

```
MIGRATION_COMMAND=wrangler d1 migrations apply siteborne-utility --remote
COMMAND_APPLIES_ONLY_0009=YES
```

## 8. Execution (exactly once)

```
$ wrangler d1 migrations apply siteborne-utility --remote
Migrations to be applied:
┌──────────────────────────┐
│ name                     │
├──────────────────────────┤
│ 0009_sec_rate_window.sql │
└──────────────────────────┘
? About to apply 1 migration(s)
Your database may not be available to serve requests during the migration, continue?
🤖 Using fallback value in non-interactive context: yes
🌀 Executing on remote database siteborne-utility (efe23c42-cbcc-47c2-9b28-922a541bdcdd):
🚣 Executed 3 commands in 0.90ms
┌──────────────────────────┬────────┐
│ name                     │ status │
├──────────────────────────┼────────┤
│ 0009_sec_rate_window.sql │ ✅     │
└──────────────────────────┴────────┘
```

("3 commands" = the two DDL statements plus wrangler's own internal
migration-bookkeeping insert into its `d1_migrations` tracking table.)

```
PRODUCTION_D1_MIGRATION_COMMANDS=1
```

## 9. Immediate migration readback

```
$ wrangler d1 migrations list siteborne-utility --remote
✅ No migrations to apply!
```

```
MIGRATION_0009_RECORDED_APPLIED=YES
PENDING_PRODUCTION_MIGRATIONS_AFTER=[]
```

## 10. Schema readback

```
$ wrangler d1 execute siteborne-utility --remote --command \
  "SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%provider_rate_window%' ORDER BY type, name"
```

| type | name | sql |
|---|---|---|
| index | `idx_provider_rate_window_provider_time` | `CREATE INDEX idx_provider_rate_window_provider_time ON provider_rate_window (provider_id, requested_at_ms)` |
| index | `sqlite_autoindex_provider_rate_window_1` | *(implicit — SQLite's automatic index backing the `id TEXT PRIMARY KEY` constraint; standard behavior for any `PRIMARY KEY` column, not migration-authored, not drift)* |
| table | `provider_rate_window` | `CREATE TABLE provider_rate_window (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, requested_at_ms INTEGER NOT NULL)` |

Byte-for-byte match (modulo SQLite's own harmless whitespace
normalization) to the migration source.

```
R2_TABLE_PRESENT_AFTER=YES
R2_SCHEMA_EXACT_MATCH=YES
UNEXPECTED_SCHEMA_DRIFT=NO
```

## 11. Non-destructive data check

```
$ wrangler d1 execute siteborne-utility --remote --command "SELECT COUNT(*) as row_count FROM provider_rate_window"
row_count: 0

$ wrangler d1 execute siteborne-utility --remote --command \
  "SELECT (SELECT COUNT(*) FROM services) as services_count, (SELECT COUNT(*) FROM payment_attempts) as payment_attempts_count"
services_count: 8
payment_attempts_count: 11
```

The new table is empty (expected — schema-only migration, no seed data,
no live SEC traffic invoked). `services` (8, matching every prior
readback across this engagement) and `payment_attempts` (11, the
accumulated total across this entire multi-week engagement's real paid
qualifications for all four services) both look like ordinary steady
state; a migration containing zero DML statements has no mechanism by
which it could mutate either table regardless.

```
R2_COORDINATOR_ROW_COUNT_AFTER=0
UNRELATED_DATA_MUTATION_OBSERVED=NO
```

## 12. Safe read-only coordinator sanity

No live SEC traffic was invoked. Compatibility was proven via
`EXPLAIN QUERY PLAN` — a genuinely read-only SQLite/D1 operation that
compiles and plans a statement without executing its effects — run
against the *exact* statement shapes `D1SecRateWindowRepository.tryAdmit`
issues:

```
$ wrangler d1 execute siteborne-utility --remote --command \
  "EXPLAIN QUERY PLAN DELETE FROM provider_rate_window WHERE provider_id = 'sec-edgar' AND requested_at_ms < 0"
detail: "SEARCH provider_rate_window USING INDEX idx_provider_rate_window_provider_time (provider_id=? AND requested_at_ms<?)"

$ wrangler d1 execute siteborne-utility --remote --command \
  "EXPLAIN QUERY PLAN INSERT INTO provider_rate_window (id, provider_id, requested_at_ms) SELECT 'x','sec-edgar',0 WHERE (SELECT COUNT(*) FROM provider_rate_window WHERE provider_id = 'sec-edgar' AND requested_at_ms >= 0) < 8"
(plan compiled successfully; SCAN CONSTANT ROW + correlated subquery, no schema error)
```

The DELETE plan confirms the query optimizer is genuinely *using* the
index this migration created (not a full table scan). The INSERT plan
compiled with no schema/column error. A follow-up row-count check (§11's
own query, re-run) confirmed `provider_rate_window` was still empty
immediately after both `EXPLAIN QUERY PLAN` calls — proving they were
genuinely read-only and consumed no production rate-window slot.

```
R2_COORDINATOR_SCHEMA_COMPATIBILITY=PASS
```

## 13. Production containment

```
CANDIDATE_UPLOADS=0
WORKER_DEPLOYMENTS=0
DEPLOYMENT_TRAFFIC_MUTATIONS=0
SECRET_MUTATIONS=0
VARIABLE_MUTATIONS=0
REAL_SEC_QUALIFICATION_REQUESTS=0
REAL_402_REQUESTS=0
EIP3009_AUTHORIZATIONS_CREATED=0
PAYMENT_SIGNING_ACTIONS=0
PAID_POSTS=0
FACILITATOR_SETTLEMENT_CALLS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_EFFECT_USDC=0
```

## 14. Q1R2 re-eligibility

Migration applied successfully, schema exact, coordinator compatibility
proven, no unexpected migration or drift.

```
SUN1222C_Q1R2_CANDIDATE_REFRESH_PREREQUISITE=PASS
SUN1222C_Q1R2_CANDIDATE_REFRESH_ELIGIBLE=YES
```

This does **not** itself authorize a candidate upload — that remains its
own, separately-authorizable checkpoint
(`SUN-1222C-Q1R2-CANDIDATE-REFRESH`).

## Final packet

```
SUN1222C_Q1R2_MIGRATION_0009=PASS
Q1R2_MIGRATION_0009_AUTHORIZATION=PRESENT
MIGRATION_0009_PATH=migrations/0009_sec_rate_window.sql
MIGRATION_0009_STATEMENT_COUNT=2
MIGRATION_0009_DATA_MUTATION=NO
MIGRATION_0009_DESTRUCTIVE=NO
MIGRATION_0009_UNRELATED_EFFECTS=NO
MIGRATION_0009_EXACTLY_SATISFIES_R2=YES
MIGRATION_0009_PREREQUISITES_SATISFIED=YES
PENDING_PRODUCTION_MIGRATIONS_BEFORE=[0009_sec_rate_window.sql]
UNEXPECTED_PENDING_MIGRATION=NO
R2_TABLE_PRESENT_BEFORE=NO
PRODUCTION_D1_MIGRATION_COMMANDS=1
MIGRATION_0009_RECORDED_APPLIED=YES
PENDING_PRODUCTION_MIGRATIONS_AFTER=[]
R2_TABLE_PRESENT_AFTER=YES
R2_SCHEMA_EXACT_MATCH=YES
UNEXPECTED_SCHEMA_DRIFT=NO
R2_COORDINATOR_SCHEMA_COMPATIBILITY=PASS
CANDIDATE_UPLOADS=0
WORKER_DEPLOYMENTS=0
DEPLOYMENT_TRAFFIC_MUTATIONS=0
REAL_SEC_QUALIFICATION_REQUESTS=0
REAL_402_REQUESTS=0
PAYMENT_SIGNING_ACTIONS=0
PAID_POSTS=0
FACILITATOR_SETTLEMENT_CALLS=0
CHAIN_TRANSACTIONS_CREATED=0
ECONOMIC_EFFECT_USDC=0
SUN1222C_Q1R2_CANDIDATE_REFRESH_PREREQUISITE=PASS
SUN1222C_Q1R2_CANDIDATE_REFRESH_ELIGIBLE=YES
EVIDENCE_COMMIT_SHA=<set by the commit that includes this file>
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-Q1R2-CANDIDATE-REFRESH
```

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
