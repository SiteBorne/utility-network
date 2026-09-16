# METADATA-VCM-07 — Scheduled-Execution Safety Under Multi-Version Deployments

Status: **PASS**

Parent: `METADATA-VCM-IMPL-04B` evidence `bd999ef` (BLOCKED — left unmodified,
correct given the evidence available at that time).

This checkpoint is read-only design + evidence. No Worker version was
uploaded, no deployment was created, Cron was not modified, the scheduled
handler was not modified, git was not pushed, and production traffic was not
changed.

## I. Scheduled call graph

```
SCHEDULED_ENTRYPOINT=apps/edge-api/src/index.ts:400 (default export .scheduled)
CRON_EXPRESSIONS=["* * * * *"]  (wrangler.toml:259, single trigger)
SCHEDULED_JOB_COUNT=2
SCHEDULED_JOBS=[recoverWorkflowOwnerIntentsScheduled, reclaimStaleArtifactsScheduled]
```

Both jobs are started via `ctx.waitUntil(...)` in the same `scheduled()` call
(`index.ts:405-406`), independently of each other — one throwing/hanging does
not affect the other.

### Job 1 — `recoverWorkflowOwnerIntentsScheduled` (`index.ts:285-293`)

```
entry: recoverWorkflowOwnerIntentsScheduled(env) [index.ts:285]
  -> recoverPendingWorkflowOwnerIntents(repo, workflow) [owner-recovery.ts:85]
       -> repo.listRecoverable(now, 25)  [D1 SELECT, no claim/lock]
       -> Promise.all(intents.map(dispatch))
            -> dispatch() [owner-recovery.ts:26]
                 already workflow_created/completed -> workflow.get() (read-only)
                 else: workflow.get() to resolve ambiguous prior create
                       else: workflow.create({ id: deterministic workflowInstanceId })
                             -> repo.markWorkflowCreated(id)  [D1 UPDATE ... WHERE status='pending']
                       on create() throw: workflow.get() again
                             -> repo.markWorkflowCreated(id)  [same CAS-guarded UPDATE]
                       on that throw too: repo.markAttemptFailed(id, backoff)
                             [D1 UPDATE ... WHERE status='pending']
```

Guard/admission: `env.DB` and `env.PAID_CONTINUATION_WORKFLOW` both required or
the job is a no-op (`index.ts:288`).
Durable guards present:
- Deterministic, caller-supplied Workflow instance id (`intent.workflowInstanceId`,
  fixed at `commitVerifiedWithIntent` time, `workflow-owner-intents.ts:40-86`).
- D1 compare-and-set: every state-advancing `UPDATE` carries `WHERE status =
  'pending'` (`workflow-owner-intents.ts:122`, `:136`) — a losing concurrent
  writer affects zero rows and does not throw (`getD1Failure` only inspects
  `result.success`, never `meta.changes`; `shared.ts:231-238`).
- Retry/backoff: exponential, capped at 300s, capped attempt count
  (`owner-recovery.ts:14-16`, default `DEFAULT_MAX_ATTEMPTS=12`).
Idempotency key: the Workflow instance id itself.
No external/economic call is made directly by this scheduled path; it only
creates or joins a durable Workflow instance. The Workflow's own `run()` (a
separate class, invoked by the Workflows engine, not by this scheduled
handler) performs any provider/settlement steps, exactly once per instance id
(see §V).

### Job 2 — `reclaimStaleArtifactsScheduled` (`index.ts:329-380`)

```
entry: reclaimStaleArtifactsScheduled(env) [index.ts:329]
  -> reclaimStaleArtifacts({ artifactStore, artifactsRepository, nowIso })
       [artifact-reclamation.ts:87]
       -> artifactsRepository.listReclaimable(cutoffIso, nowIso)  [D1 SELECT]
       -> for each record (sequential, not Promise.all):
            artifactStore.deleteByContentHash(hash)   [R2 delete, idempotent no-throw-on-missing]
            artifactsRepository.delete(id)             [D1 DELETE, no-op if already gone]
  -> if r2_delete_failures > 0: console.error (unconditional, every pass)
  -> if STORAGE_ALERT_RECEIVER + STORAGE_ALERT_PATH_TOKEN present and
     r2_delete_failures > 0: runStorageAlertSweep(...) [best-effort, never throws,
     never blocks/rolls back reclamation — called strictly after reclamation
     already completed and was counted]
```

Guard/admission: `env.DB` and `env.ARTIFACTS` both required or no-op
(`index.ts:332`).
Durable guards: R2 delete-by-content-hash is idempotent by construction (both
`ArtifactStore` implementations return `false`, never throw, on an
already-missing object — doc comment `artifact-reclamation.ts:113-116`); order
is R2-delete-before-D1-delete so a mid-batch crash never leaves a dangling D1
row (`:82-85`); a D1 row already gone by delete time (a concurrent pass) is
counted as a harmless no-op, never as a failure, and never re-triggers a
second R2 delete for the same record in the same pass (`:128-140`, explicitly
covered by test — see §VIII).
It never reads or writes any payment/settlement/job-state table (doc comment
`:76-80`) — structurally nothing there for it to corrupt.
Retention window: `ARTIFACT_PHYSICAL_RECLAMATION_AFTER_SECONDS = 86,400`
(24h), a large deliberate multiple of every real Workflow step's retry/timeout
bound in this codebase (`:34-39`).
Alert dedup: `runStorageAlertSweep` supports a `previousFailureCount`-based
dedup (`storage-alert-sweep.ts:62-75`), but the call site in `index.ts` does
**not** pass it — it uses the documented "safe default" of alerting on every
nonzero-failure pass, every minute, for as long as an R2 outage persists
(`storage-alert-sweep.ts:70-72`). This is a pre-existing characteristic of the
*current single-version* system, not something introduced by multi-version
concurrency (see §VI, §XII).

## II. Adversarial platform-model analysis

Cloudflare's own documentation on gradual deployments and Cron Triggers does
not state which version(s) receive `scheduled()` invocations during a
percentage-split deployment (confirmed again in this checkpoint by re-reading
both pages; unchanged since `METADATA-VCM-IMPL-04B`). The six platform models
below are therefore treated as adversarial hypotheses, not claims about
Cloudflare's actual behavior.

```
PLATFORM_MODEL_A_RESULT=SAFE (strict subset of the concurrent case proven safe below)
PLATFORM_MODEL_B_RESULT=SAFE (same)
PLATFORM_MODEL_C_RESULT=SAFE (same)
PLATFORM_MODEL_D_RESULT=SAFE (every version invoked concurrently -- the actual
  worst case analyzed; see §V/§VI)
PLATFORM_MODEL_E_RESULT=SAFE (no cross-tick state is owned by any version --
  every tick is an independent full rescan, so which version ran the
  previous tick is irrelevant)
PLATFORM_MODEL_F_RESULT=SAFE (a retried/duplicated scheduled occurrence is
  indistinguishable in effect from "one more normal tick" -- both jobs are
  designed to run every 60 seconds forever and tolerate that already)
```

Both jobs' safety properties are structural (idempotent design plus a
platform-guaranteed primitive), not dependent on which model is true. That is
why every model above resolves the same way: the analysis does not need to
know which model Cloudflare actually implements.

## III/IV. `recoverWorkflowOwnerIntentsScheduled` concurrency analysis

Adversarial scenarios (from `owner-recovery.ts` source, all traced by hand
against the exact code in §I):

1. **Current version starts job, candidate starts same job 1ms later (both
   read the same pending intent before either writes).** Both reach
   `workflow.create({ id })` with the identical deterministic id. Per
   Cloudflare's own Workflows documentation (fetched live this checkpoint,
   `https://developers.cloudflare.com/workflows/build/workers-api/`,
   `Workflow.create` section): *"Throws an error if the provided ID is
   already used by an existing instance."* Exactly one `create()` call can
   win; the other throws, falls into the `catch` branch, calls `workflow.get()`
   (which now succeeds because the winner's instance exists), and returns
   `joined_after_ambiguous_create`. Zero duplicate Workflow instances; zero
   duplicate downstream provider/settlement steps (those live inside the
   Workflow's own `run()`, invoked once per instance id by the Workflows
   engine, not by this scheduled handler).
2. **Both then race to call `repo.markWorkflowCreated(id)`.** Both statements
   carry `WHERE status = 'pending'`. SQLite (D1's engine) serializes writes to
   the same row; the first commits and flips status; the second's `UPDATE`
   matches zero rows. `getD1Failure` treats that as success (it only inspects
   `result.success`, `shared.ts:231-238`) — no exception, no double-counted
   attempt, no corrupted `dispatch_attempt_count`.
3. **Current commits halfway and throws; candidate retries the same
   intent.** "Halfway" for this job means at most: `workflow.create()`
   succeeded but `markWorkflowCreated()` did not yet run (a mid-`waitUntil`
   Worker eviction). The row is still `status='pending'`. The next tick (by
   either version) re-reads it, calls `workflow.get()` (succeeds, instance
   already exists from the earlier create), and calls `markWorkflowCreated()`
   — reaching `workflow_created` with no duplicate instance ever created.
4. **Same scheduled timestamp delivered twice (retry).** Identical to
   scenario 1/2 one tick later; no cross-tick state is required for
   correctness, so a duplicate delivery is indistinguishable from a second
   independent tick.

```
WORKFLOW_RECOVERY_DUPLICATE_SAFE=YES
WORKFLOW_RECOVERY_LOSS_SAFE=YES
```

Loss-safety reasoning: `listRecoverable` is a stateless, unclaimed read
executed fresh on every invocation (`workflow-owner-intents.ts:96-107`); an
intent's `status` only ever advances forward (`pending` ->
`workflow_created`/`retry_exhausted`) via a CAS-guarded write. If a given tick
is run by a version that (for whatever undocumented platform reason) does
nothing, the intent simply remains `pending` and is picked up by the next
tick, run by whichever version that turns out to be. No intent can be
silently dropped by a version switch between ticks; the only way to lose work
is total non-invocation of `scheduled()` on every version for an extended
period, which is outside the scope of "which version received the event" and
was the subject of the unrelated, already-fixed export-shape bug documented
in `SUN-1222C-R4-D15-natural-cron-operational-verification.md`.

## V. Economic-effect proof

```
SCHEDULED_PATH_CAN_CREATE_ECONOMIC_EFFECT=NO
```

`reclaimStaleArtifactsScheduled` never reads or writes any payment,
settlement, or job-state table (doc comment, `artifact-reclamation.ts:76-80`,
confirmed by import graph: only `ArtifactStore` and `ArtifactsRepository` are
touched). Structurally nothing there to affect economically.

`recoverWorkflowOwnerIntentsScheduled` never calls a provider, never signs a
payment, never settles. It only creates-or-joins a Workflow instance whose id
was fixed at the time a real, already-verified payment intent was committed
(`commitVerifiedWithIntent`, called from the *paid* request path, not from
this scheduled path). The Workflow's actual paid steps run inside the
Workflow class's own `run()`, invoked by the Workflows engine exactly once
per instance id (the same platform guarantee analyzed in §III/IV) —
independent of how many times, or by how many Worker versions, this scheduled
handler calls `create`/`get` against that id. Existing containment,
independently: `PAID_ROUTES_ENABLED=false` in the current production
configuration (verified live in `METADATA-VCM-IMPL-04B`, re-confirmed
unchanged this checkpoint via the same read-only `wrangler versions view` on
`38cbf4dd-52fd-4afc-ad34-626a2e6454d3`), so no new paid-route admission is
occurring in production regardless of this analysis.

## VI. Duplicate alert email — named, not hidden

Under Platform Model D (every version invoked concurrently), both invocations
could independently observe `r2_delete_failures > 0` in the same minute and
both call `runStorageAlertSweep`, each attempting one delivery — at most
doubling alert volume during a live R2 outage. This is **not** a new failure
class: the existing single-version call site already omits
`previousFailureCount` and therefore already re-alerts every single minute
for the duration of any ongoing outage (`storage-alert-sweep.ts:70-72`, "the
safe default for a caller with no cross-invocation memory"). Multi-version
concurrency changes the cadence of an already-repeating, already
non-deduplicated, content-free (`no economic credential, no artifact
content`, `storage-alert-sweep.ts:13-15`) notification during a rare failure
condition. It does not corrupt data, does not create an economic effect, and
does not violate the "no unsafe duplicate execution" requirement as stated
for the two actual scheduled jobs.

```
ALERT_DEDUP_SEMANTIC=BEST_EFFORT_PERIODIC (by existing design, not exactly-once)
ALERT_DUPLICATION_UNDER_MULTIVERSION=BOUNDED_VOLUME_INCREASE_ONLY_DURING_RARE_R2_OUTAGE
ALERT_DUPLICATION_IS_NEW_FAILURE_CLASS=NO
```

## VII. Semantic requirement per job (derived from code, not assumed)

```
recoverWorkflowOwnerIntentsScheduled: EXACTLY_ONCE_EFFECT for Workflow-instance
  creation (platform-guaranteed by deterministic id + create() uniqueness),
  AT_LEAST_ONCE_IDEMPOTENT for the scheduled scan/dispatch attempt itself.
reclaimStaleArtifactsScheduled: AT_LEAST_ONCE_IDEMPOTENT for both the R2 delete
  and the D1 row delete (each safely repeatable to a fixed point).
storage alert delivery (downstream of job 2): BEST_EFFORT_PERIODIC, explicitly
  not deduplicated at the current call site.
```

## VIII. Existing concurrency/idempotency/retry tests (run fresh this checkpoint)

```
EXISTING_SCHEDULED_CONCURRENCY_TESTS=2
  - "allows concurrent recovery actors but retains one logical owner"
    (apps/edge-api/tests/lifecycle-model-c.test.ts:259) -- two concurrent
    Promise.all(recoverPendingWorkflowOwnerIntents) calls against the same
    seeded intent; asserts workflow.instances.size === 1.
  - "a D1 row already gone by the time delete() runs (a concurrent
    reclamation race) is not counted as reclaimed, never thrown, and never
    retriggers the R2 delete a second time incorrectly"
    (apps/edge-api/src/control-plane/artifacts/artifact-reclamation.test.ts:176)
EXISTING_SCHEDULED_IDEMPOTENCY_TESTS=3
  - "repairs ambiguous create by get and never creates a second logical
    Workflow" (lifecycle-model-c.test.ts:223)
  - "is idempotent: running twice in a row reclaims once, then finds nothing
    left" (artifact-reclamation.test.ts:108)
  - "is idempotent: an R2 object already missing ... is treated as a normal
    no-op" (artifact-reclamation.test.ts:125)
EXISTING_SCHEDULED_RETRY_TESTS=1
  - "a genuine R2 delete failure (thrown, not a clean false) is counted,
    never thrown past this function, and leaves the D1 row intact for the
    next pass" (artifact-reclamation.test.ts:144)
```

All five files covering these jobs were re-run fresh, not from memory:

```
Test Files  5 passed (5)
     Tests  45 passed (45)
  (lifecycle-model-c.test.ts 8, lifecycle-model-c-mutation.test.ts 14,
   artifact-reclamation.test.ts 9, reclaim-stale-artifacts-scheduled.test.ts 6,
   index.scheduled-export-shape.test.ts 8)
```

This is genuinely stronger than "implementation appears safe from reading it"
— the two-actor concurrent-recovery test and the concurrent-reclamation-race
test directly exercise the exact scenarios in §III/IV and §I Job 2, and the
`workflowDouble` test fixture's uniqueness check
(`lifecycle-model-c.test.ts:85-102`, `if (instances.has(id)) throw`) mirrors
Cloudflare's own documented `create()` semantics rather than assuming them.

## IX. Result

```
CRON_SAFETY_RESULT=SAFE_UNDER_ALL_ANALYZED_MODELS
```

Both scheduled jobs are safe against duplicate unsafe side effects and
against lost required durable state under every adversarial platform model
in §II, including the worst case (every deployed version invoked
concurrently, indefinitely, with retries). This holds because of two
structural properties that do not depend on knowing Cloudflare's actual
scheduled-dispatch semantics: (1) every tick is a stateless full rescan with
no version-owned state, and (2) Workflow-instance creation is exactly-once
per deterministic id, a platform-documented guarantee, reinforced by a
second, independent D1-level compare-and-set. The one identified
side-effect of multi-version concurrency (§VI, duplicate alert emails during
a rare R2 outage) is a bounded, non-economic, non-corrupting cadence change
to an already-non-deduplicated notification, not a new safety violation.

## X. Mitigation strategies

Not required. §IX establishes existing behavior is already safe under every
analyzed model, including the worst case. No hardening checkpoint
(`METADATA-VCM-IMPL-04C`) or scheduler-isolation checkpoint is needed before
retrying `METADATA-VCM-IMPL-04B`. Options A-E were not evaluated in detail
since the prerequisite ("existing implementation is not proven safe") does
not hold; they remain available in the parent design
(`METADATA-VCM-06`/`METADATA-VCM-IMPL-04B`) if a future job with different
(non-idempotent) semantics is added to the same Cron Trigger.

## XI. Version Metadata binding

```
VERSION_METADATA_BINDING_PRESENT=NO
```

Confirmed by grep of `wrangler.toml` and `apps/edge-api/src` — no
`version_metadata` binding is declared or consumed anywhere in the codebase.
Not needed for the result in §IX (the safety argument does not use version
identity at all), and not proposed here since introducing it would itself be
a source change, out of scope for this read-only checkpoint. It would need:
one `[[version_metadata]]`-shaped binding entry in `wrangler.toml` (`binding
= "VERSION"`), no new secret, no route change, no trigger change — a small,
independently reviewable delta if a future checkpoint wants version-aware
observability (e.g., attributing which version's `scheduled()` invocation
produced a given structured log line) without depending on it for
correctness.

## XII. Design requirement check

Neither job silently guarantees only `AT_MOST_ONCE` (which could skip
required recovery/reclamation forever) nor only unbounded `AT_LEAST_ONCE`
with harmful duplication. `recoverWorkflowOwnerIntentsScheduled` achieves
`EXACTLY_ONCE_EFFECT` for the one operation that would be harmful to
duplicate (Workflow-instance/economic-step creation) while remaining
`AT_LEAST_ONCE` (safely) for the scan itself.
`reclaimStaleArtifactsScheduled` is `AT_LEAST_ONCE_IDEMPOTENT` throughout,
which is the correct and sufficient semantic for a delete-to-fixed-point
job. The one `BEST_EFFORT_PERIODIC` element (storage alert delivery) is
explicitly and correctly documented as such in the existing source, not
silently assumed.

## XIII. 0%-candidate HTTP invocation

```
ZERO_PERCENT_HTTP_CANDIDATE_DIRECT_INVOCATION_SUPPORTED=YES
```

Per the updated external platform facts provided for this checkpoint,
Cloudflare Workers Version Overrides can invoke a specific version present in
a deployment even when that version is configured for 0% of normal traffic.
This is carried forward as resolved; it is not treated as an open blocker in
the required return below or in any future retry of `METADATA-VCM-IMPL-04B`.

## XIV. Remote source provenance policy

```
REMOTE_SOURCE_SYNC_REQUIRED_BEFORE_PRODUCTION_CANDIDATE=UNDEFINED
```

Searched `scripts/production-preflight.mts` (the only production preflight
script in the repository), `docs/decisions/*.md`, and the two paid-e2e
preflight reports for any git-remote-sync/branch requirement. None exists:
`production-preflight.mts`'s only "remote" checks are against Cloudflare's
remote secret store (`wrangler secret list`), not git. The one located prior
canary-decision precedent
(`SUN-1222C-pcc-canary-version-skew-remediation.md:53-55`) records that
session's actual state (`BRANCH=main`, clean tree) as a fact, not as a
stated policy requirement. No ADR establishes a rule either way. Given that
this specific candidate's source currently exists only on a local, unpushed
branch left over from unrelated prior work
(`smtp-diagnostic-starttls-observability`, noted in
`METADATA-VCM-IMPL-04B-zero-percent-candidate-qualification.md`), this
checkpoint recommends the gap be closed as an explicit, low-cost gate (push
the branch, or merge to `main`, before candidate creation) rather than left
implicit — not because any existing rule requires it, but because a
production Worker version with no durable off-machine record of its exact
source is a real, easily-avoided provenance risk independent of anything
else analyzed in this report.

## XV. Next path

```
RECOMMENDED_NEXT_PATH=PATH_1
```

Existing scheduled implementation is safe under all analyzed multi-version
semantics. Retry `METADATA-VCM-IMPL-04B` (as `METADATA-VCM-IMPL-04B-R2`, per
its own reattempt-semantics rule) unchanged in scheduled-handler source. The
retry should independently re-verify §XIV's provenance recommendation
(push/merge the branch) before candidate creation, as a separate, cheap
precondition rather than a scheduled-safety blocker.

## Required return

```
METADATA_VCM_07=PASS

PARENT_VCM_IMPL_04B_EVIDENCE=bd999ef

SCHEDULED_ENTRYPOINT=apps/edge-api/src/index.ts:400
CRON_EXPRESSIONS=["* * * * *"]
SCHEDULED_JOB_COUNT=2

SCHEDULED_JOBS=[recoverWorkflowOwnerIntentsScheduled, reclaimStaleArtifactsScheduled]

WORKFLOW_RECOVERY_DUPLICATE_SAFE=YES
WORKFLOW_RECOVERY_LOSS_SAFE=YES

STALE_ARTIFACT_RECLAIM_DUPLICATE_SAFE=YES
STALE_ARTIFACT_RECLAIM_LOSS_SAFE=YES

SCHEDULED_PATH_CAN_CREATE_ECONOMIC_EFFECT=NO

EXISTING_SCHEDULED_CONCURRENCY_TESTS=2
EXISTING_SCHEDULED_IDEMPOTENCY_TESTS=3
EXISTING_SCHEDULED_RETRY_TESTS=1

PLATFORM_MODEL_A_RESULT=SAFE
PLATFORM_MODEL_B_RESULT=SAFE
PLATFORM_MODEL_C_RESULT=SAFE
PLATFORM_MODEL_D_RESULT=SAFE
PLATFORM_MODEL_E_RESULT=SAFE
PLATFORM_MODEL_F_RESULT=SAFE

CRON_SAFETY_RESULT=SAFE_UNDER_ALL_ANALYZED_MODELS

VERSION_METADATA_BINDING_PRESENT=NO

ZERO_PERCENT_HTTP_CANDIDATE_DIRECT_INVOCATION_SUPPORTED=YES

REMOTE_SOURCE_SYNC_REQUIRED_BEFORE_PRODUCTION_CANDIDATE=UNDEFINED
  (recommended to become an explicit gate; see §XIV)

RECOMMENDED_NEXT_PATH=PATH_1

NEXT_IMPLEMENTATION_CHECKPOINT=NONE
  (retry METADATA-VCM-IMPL-04B as METADATA-VCM-IMPL-04B-R2)

SOURCE_MUTATIONS=0
RUNTIME_MUTATIONS=0
CRON_MUTATIONS=0
PRODUCTION_MUTATIONS=0

REPORT=docs/reports/METADATA-VCM-07-scheduled-execution-multiversion-safety.md
```
