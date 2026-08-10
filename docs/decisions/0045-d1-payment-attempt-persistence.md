# SITEBORNE Utility Network — ADR 0045: D1 Payment-Attempt Persistence (SUN-0700A checkpoint 2 closure)

## Context

Checkpoint 2's `@siteborne/protocol-x402` implementation proved
payment-identifier/replay classification (`first_seen` / `duplicate_same` /
`duplicate_conflict` / `already_consumed` / `expired`) only against
`InMemoryPaymentAttemptRepository` — sufficient to prove the domain algorithm,
but not that SITEBORNE's actual D1 persistence enforces the same semantics under
real concurrency. The official x402 Payment-Identifier extension is specifically
intended to support retries across process/client failures via persistent,
shared deduplication — not only one process's memory — so this gap needed
closing before checkpoint 2 could be considered complete.

## Decision

**Option evaluated first (directive §2): adapt an existing table.** Both
candidates were inspected and rejected:

- `idempotency_records` (SUN-0200, already accepted): `original_job_id` is
  `NOT NULL` with a foreign key into `jobs(id)`.
- `payment_quotes`: `job_id` is likewise `NOT NULL` with a foreign key into
  `jobs(id)`.

A payment attempt is authoritatively acquired **before** a job exists (directive
§15's sequencing: 402 requirement → PAYMENT-SIGNATURE received → structural
parse → payment identifier extraction → authoritative acquisition → external
verify/settle (SUN-0700B) → service execution). Reusing either table would
require fabricating a placeholder `jobs` row for every payment attempt purely to
satisfy an unrelated NOT NULL constraint — a real semantic mismatch, not merely
an inconvenience.

**Decision: option C, a dedicated table** — `payment_attempts`
(`migrations/0002_payment_attempt_replay.sql`), with `job_id` nullable (matching
the existing `security_events.job_id` nullable-FK precedent already in migration
0001), backfilled once a real job is created downstream. This is the smallest
additive migration that correctly models the domain — not schema proliferation
for its own sake.

**Uniqueness / atomic acquisition.** `idx_payment_attempts_identifier` is a
`UNIQUE INDEX` on `payment_attempts.payment_identifier` — the authoritative "one
payment_identifier, one immutable-binding owner" rule (directive §4) is enforced
by the database itself, not by application-level read-then-write logic.
`D1PaymentAttemptRepository.acquire()`
(`apps/edge-api/src/control-plane/ repositories/d1/payment-attempts.ts`) always
attempts the INSERT first; only on a UNIQUE-constraint failure does it re-SELECT
the authoritative existing row to classify the outcome — mirroring
`D1IdempotencyRepository.acquire()`'s own real, already-accepted pattern.

**A genuine bug this closure's real-D1 testing caught before it shipped**:
D1/Miniflare's `.run()` **throws** a JS exception on a UNIQUE constraint
violation, rather than returning `{ success: false, error }` the way the
existing `D1IdempotencyRepository`'s own doc comment describes. The first
version of `D1PaymentAttemptRepository.acquire()` only checked `result.error` on
an unsuccessful _returned_ result and treated any _thrown_ exception as a
generic repository failure — which meant every real conflict (`duplicate_same`,
`duplicate_conflict`, restart-persistence, concurrency) initially misclassified
as `repository_error` in the real D1 test run. Fixed by checking for the
UNIQUE-constraint signature in both the thrown-exception path and the
unsuccessful-result path before classifying an outcome as a genuine failure.
This is exactly the class of defect an in-memory-only proof cannot catch — the
reason this closure pass exists.

## Consequences

- `AcquireOutcome` (and the derived `IdempotencyOutcome`) gained a closed
  `error`/`repository_error` variant — a persistence failure is never
  interpreted as `first_seen` or a safe duplicate. `getByIdentifier`'s signature
  has no equivalent (it returns `null` on both "not found" and "lookup failed" —
  callers that must distinguish the two should use `acquire()`, whose failure
  path is closed and typed).
- `apps/edge-api/tests/d1-payment-attempts.test.ts` is the authoritative proof:
  real D1 fresh/duplicate_same/duplicate_conflict/consumed/expired
  classification, 20-way and conflicting-binding concurrency, two forms of
  repository-instance-restart persistence, InMemory↔D1 parity (both a fixed
  operation sequence and expiry-boundary parity, plus 5 model-based bounded
  sequences), and failure injection against a database missing the table.
- Not wired into any HTTP route yet — `D1PaymentAttemptRepository` is the
  integration seam a later checkpoint calls into; no transition to
  `PAYMENT_VERIFIED` or `SETTLED` occurs anywhere in SUN-0700A.
