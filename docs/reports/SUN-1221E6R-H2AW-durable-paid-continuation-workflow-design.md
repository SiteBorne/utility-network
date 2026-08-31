# SUN-1221E6R-H2AW — Durable Paid-Continuation Workflow Architecture

Design/threat-model/contract-preservation checkpoint. **No implementation. No
Worker upload. No Workflow deployment. No secret creation. Zero economic
activity.**

## 1. Reconciliation of H2AR

Read: `H2A` implementation (`x402-service.ts` `waitUntil` wrap, commit
`1a7e9e6`), `SUN-1221E6R-H2A-*` report, `SUN-1221E6R-H2AR-*` report, `H1A`
report, and the current production paid-service orchestration
(`x402-service.ts`, `cdp-provider.ts`, `payment-attempts.ts`).

- `H2A_WAITUNTIL_FIX_INCOMPLETE=YES` — confirmed. `waitUntil` only extends
  execution ~30s past client disconnect; Modal's own declared executor
  timeout (35s) alone exceeds that in isolation, and PCC/settlement/D1
  persistence have no enforced ceiling at all.
- `H2A_CANDIDATE_USABLE_FOR_REAL_PAYMENT=NO` — confirmed, matches H2AR.
- `SUN1221E6R_H2B_REAL_PAYMENT_ELIGIBLE=NO` — confirmed, unchanged by this
  checkpoint (design-only).

No discrepancy found. Proceeding.

## 2. Cloudflare Workflows capability verification

Verified against **current** Cloudflare Workflows documentation
(`developers.cloudflare.com/workflows/reference/limits/`, fetched live this
checkpoint):

| Claim | Value | Source |
|---|---|---|
| `WORKFLOWS_AVAILABLE_ON_CURRENT_ACCOUNT_PLAN` | **YES (high confidence, not directly billing-API-verified)** | This account already exercises Workers Paid–gated features throughout this entire checkpoint chain (Worker Versions API, percentage-based gradual deployments) — the same plan tier Workflows requires. A direct Cloudflare billing/subscription API read was attempted and returned no valid route for this account's token scope; plan tier is therefore inferred from consistent evidence, not independently confirmed via billing API. |
| `WORKFLOWS_COMPATIBLE_WITH_CURRENT_WORKER_DEPLOYMENT_MODEL` | **YES**, with one caveat | Workflows do **not** support Workers for Platforms namespaces (not applicable here — this project is a normal top-level Worker) |
| `WORKFLOW_STEP_WALL_TIME_MODEL` | **Unlimited** wall-clock duration per step for network I/O waits (e.g. waiting on `fetch`, DB calls) | Docs, "Duration (wall clock) per step" row |
| `WORKFLOW_CPU_TIME_LIMIT` | 30s **active CPU time** per step by default (Workers Paid), configurable up to 5 minutes | Docs, "Compute time per step" row — this bounds *CPU*, not wall-clock; a step `await`-ing Modal's HTTP response consumes ~0 CPU while waiting |
| `WORKFLOW_INSTANCE_ID_UNIQUENESS` | **YES** — platform-enforced unique per Workflow, max 100 chars | Docs |
| `WORKFLOW_STEP_RETRY_CONFIGURABLE` | **YES** — explicit `retries: { limit, delay, backoff }` and `timeout` per `step.do()` call | Docs example (`src/index.ts` sample) |
| `WORKFLOW_STEP_RETRY_LIMIT_ZERO_SUPPORTED` | **YES** — `limit: 0` is a valid retry-policy value; omitting explicit `retries` inherits Workflow-engine defaults, which is exactly why every step in §12 below sets `retries` explicitly rather than relying on defaults |
| `WORKFLOW_STATE_RETENTION_CONFIGURABLE` | **Fixed by plan**, not caller-configurable: 3 days (Free) / 30 days (Paid) retention for *completed* instance state | Docs |
| `WORKFLOW_SENSITIVE_OUTPUT_REDACTION_SUPPORTED` | **NO** native redaction primitive found in current docs — Workflow step outputs and params are persisted as durable state as-is. This is exactly why §8 (encrypted envelope) is required rather than relying on a platform redaction feature that does not exist. |

`CORRECTED_POST_VERIFY_ARCHITECTURE` is **not** blocked by this section:
Workflows are available and compatible.

The decisive fact for this whole design: **step wall-clock time is
unlimited for I/O waits**, decoupled entirely from both the HTTP
request/response lifecycle and the ~30s `waitUntil` ceiling that made H2A
insufficient. A Workflow step can `await` Modal's response for however long
Modal itself takes (bounded by Modal's own 35s function timeout, which
remains the real outer bound on that phase — Workflows do not remove it,
they simply stop *Workflows itself* from being the bottleneck).

## 3. Ownership boundary

```
HTTP_WORKER_RESPONSIBILITIES=
  request validation, service/route activation gate, economics resolution
  (price/network/asset from config), x402 402 challenge construction,
  payment payload receipt, facilitator .verify() call, TermsGuard policy
  checks, PAYMENT_VERIFIED persistence, durable Workflow-continuation
  creation (idempotent), synchronous wait-for-terminal-state while the
  client connection is alive, response serialization back to the client.

WORKFLOW_RESPONSIBILITIES=
  real executor invocation (Modal safe-egress fetch), executor output
  validation, PCC generation/validation, pre-settlement invariant
  re-check (authorization not expired, amount/network/asset match),
  facilitator .settle() call, ambiguous-settlement read-only
  reconciliation, result persistence, receipt persistence, terminal job
  state transition (job/payment_attempts terminal rows).

SINGLE_SETTLEMENT_OWNER=WORKFLOW
```

There is **no** Worker-side settlement fallback path once the Workflow
instance is created — enforced structurally: the current
`evidenceProvider.settle()` call site (`x402-service.ts:1710`, plus the
bounded retry call at `:1196`) is **removed from the Worker's direct
request-handling path** in this design and becomes exclusively a step
inside the Workflow class. The Worker retains only `.verify()`, never
`.settle()`.

## 4. Durable handoff point

Traced exact existing state path in `payment-attempts.ts` /
`x402-service.ts`: `CHALLENGED → VERIFIED → LOCKED → ROUTED → EXECUTING →
...`. The handoff freezes immediately **after** `PAYMENT_VERIFIED` is
durably persisted and **after** TermsGuard / pre-execution policy gates
pass, i.e. exactly at the point the current code today transitions into
`LOCKED`.

```
DURABLE_HANDOFF_CALLSITE=
  x402-service.ts, the call site immediately following the existing
  PAYMENT_VERIFIED persistence + TermsGuard pass (today's `LOCKED`
  transition point) — replace direct in-request continuation with
  Workflow-instance creation.

DURABLE_HANDOFF_PRECONDITIONS=
  facilitator .verify() returned valid=true; TermsGuard passed;
  payment_attempts row has lifecycle_stage=verified persisted; job row
  exists and is in a pre-execution state; economics (network/asset/amount/
  payTo) match the quoted 402 exactly.

NEW_STATE_OR_EVENT_REQUIRED=YES
  A new job/payment_attempts state (e.g. `CONTINUATION_CREATED` or reuse
  of `LOCKED` with a new `workflow_instance_id` column) is required to
  record that durable ownership has transferred, distinct from the
  existing `LOCKED`/`ROUTED` labels which currently describe an
  in-request, non-durable continuation.
```

## 5. Workflow instance ID

```
WORKFLOW_INSTANCE_ID_DERIVATION=
  Deterministic, derived from payment_identifier (the x402/CDP-issued
  identifier already unique per payment attempt and already the
  authoritative join key established in H1A), e.g.
  `webctx-v2:${payment_identifier}`. NOT random, NOT job_id alone (job_id
  is created before payment verification and a client could in principle
  retry the initial request path before payment, producing multiple job
  rows for one eventual payment — payment_identifier is the later,
  payment-anchored identity).

WORKFLOW_INSTANCE_ID_CONTAINS_SECRET=NO
  payment_identifier is an opaque CDP-issued correlation ID already
  persisted in plaintext throughout D1 today; it is not payment material
  itself.

DUPLICATE_WORKFLOW_CREATE_BEHAVIOR=
  Create call for an already-existing deterministic instance ID fails
  (Cloudflare enforces unique instance IDs); the Worker's create call is
  wrapped: on a "duplicate ID" error, look up the existing instance by
  that same ID and bind to its status instead of starting a second
  pipeline. This is the preferred behavior mandated by this checkpoint,
  and is directly supported by the platform's own uniqueness guarantee
  rather than bespoke deduplication logic.
```

## 6. Payment-material requirements at settle()

Read `cdp-provider.ts:139-167`. The real call site is:

```ts
this.facilitator.settle(context.paymentPayload, facilitatorRequirements)
```

```
SETTLEMENT_REQUIRES_PAYMENT_PAYLOAD=YES
SETTLEMENT_REQUIRES_RAW_SIGNATURE=YES   (paymentPayload embeds the signed
                                          EIP-3009 authorization + signature)
SETTLEMENT_REQUIRES_AUTHORIZATION=YES   (same object — authorization fields
                                          from/valid/to/value/validAfter/
                                          validBefore/nonce)
SETTLEMENT_REQUIRES_PAYMENT_REQUIREMENTS=YES  (facilitatorRequirements:
                                          network/asset/amount/payTo/scheme
                                          — derivable from the job's own
                                          quoted economics, not secret)
SETTLEMENT_MINIMUM_REQUIRED_FIELDS=
  paymentPayload.{authorization:{from,to,value,validAfter,validBefore,
  nonce}, signature}; facilitatorRequirements.{scheme,network,asset,
  payTo,maxAmountRequired,resource}. No other fields are required by the
  settle() call site as read.
```

## 7. Payment-material classification

```
RAW_SIGNATURE_SENSITIVITY=HIGH — bearer-like until validBefore/nonce
  consumed; anyone holding it can attempt settlement to the payTo address
  encoded within it (fixed recipient, but still constitutes an economic
  authorization redeemable by any submitter).
AUTHORIZATION_PAYLOAD_SENSITIVITY=HIGH — contains the above signature plus
  buyer address, exact amount, and validity window.
PAYMENT_REQUIREMENTS_SENSITIVITY=LOW — reconstructable from public,
  already-quoted 402 economics (network/asset/price/payTo are not secret
  and are served to any 402 client today).
PAYMENT_IDENTIFIER_SENSITIVITY=LOW — an opaque correlation ID, not
  economic bearer material by itself; already persisted in plaintext in
  D1 today.

Storage placement:
  D1: payment_identifier, job_id, service_id, network, amount, validBefore,
      lifecycle_stage, key_id/envelope_version metadata — PLAINTEXT OK.
  Workflow params (durable persisted state): ciphertext envelope ONLY for
      {authorization, signature}; facilitatorRequirements MAY be stored in
      the clear (low sensitivity, needed by the settle step) but is
      included as AEAD associated data regardless, to bind it to the
      ciphertext (see §8).
  Workflow step output: settlement result metadata (status class, tx
      reference if any) — plaintext OK, never the raw signature.
  Logs/telemetry: NEVER paymentPayload, NEVER raw signature. Existing
      repository convention (established throughout this whole checkpoint
      chain: "never printed, never logged, never committed") extends
      unchanged to Workflow step logs.
```

Raw signed payment material is **not** stored plaintext merely because
Workflow state is durable — durability is not confidentiality.

## 8. Encrypted continuation envelope

```
CONTINUATION_ENVELOPE_VERSION=1
ENCRYPTION_PRIMITIVE=WebCrypto AES-256-GCM (AEAD), available natively in
  the Workers runtime via `crypto.subtle` — no new dependency.
AEAD_ASSOCIATED_DATA_FIELDS=
  job_id, payment_identifier, service_id ("web_context_verified.v2"),
  network ("eip155:8453"), amount ("9000"), payTo — binds ciphertext to
  this exact economic context; a ciphertext produced for one job/amount/
  network cannot be decrypted-and-accepted against another without the
  AEAD tag failing.
ENCRYPTED_FIELDS=
  { authorization: {from, to, value, validAfter, validBefore, nonce},
    signature }
CLEAR_FIELDS=
  version, key_id, job_id, payment_identifier, service_id, network,
  amount, valid_before (valid_before duplicated in clear as a fast-path
  expiry check *before* decryption is even attempted — decrypting is not
  needed to reject an already-expired continuation).
```

New secret (name to follow repository convention, e.g.
`PAYMENT_CONTINUATION_ENCRYPTION_KEY`) — **not created in this
checkpoint**. Never reuses `CDP_API_KEY_SECRET`, `PAID_RECEIPT_SIGNING_*`,
`AGENT_CARD_SIGNING_PRIVATE_KEY`, or `MODAL_WEBCTX_*` (each already scoped
to a distinct concern; reusing any of them for payment-envelope encryption
would widen that secret's blast radius beyond its current audited scope).

## 9. Key management design

```
CONTINUATION_KEY_ROTATION_MODEL=
  Versioned keys addressed by key_id (clear envelope field). Rotation =
  provision key_id N+1 as a new secret/binding, deploy Worker+Workflow
  reading both N and N+1 for decrypt, switch encryption to N+1 only,
  retire N once its longest-possible in-flight envelope (bounded by
  validBefore + reconciliation margin, see §10) has necessarily expired.
  This mirrors the existing MODAL_WEBCTX_* / CDP_API_KEY_* secret pattern
  already in use (named, environment-scoped Worker secrets), not a new
  paradigm.
KEY_UNAVAILABLE_BEHAVIOR=
  Fail closed. If the expected key_id binding is absent at either
  encrypt time (Worker, handoff) or decrypt time (Workflow, settle step),
  abort the operation, transition the job to an explicit
  `configuration_error` terminal state, and never fall back to plaintext
  or to a different key without explicit key_id match. Matches the
  existing repository convention (Worker fails closed when
  MODAL_WEBCTX_* is absent, established in Q6G).
```

## 10. Envelope retention

```
PLAINTEXT_PAYMENT_MATERIAL_PERSISTED_DURABLY=NO
CIPHERTEXT_RETENTION_POLICY=
  Bounded by validBefore + a fixed reconciliation margin (proposed: 10
  minutes, generously covering ambiguous-settlement read-only
  reconciliation in §13). Workflow instance completed-state retention is
  plan-fixed (30 days, Paid — see §2) and NOT independently shortenable
  per-instance; the mitigation is therefore at the content layer, not the
  retention-policy layer: once the Workflow reaches a terminal state
  (settled, expired-unsettled, or failed), the instance's own final step
  explicitly overwrites its stored envelope reference with a tombstone
  value (application-level "encrypt-then-discard"), so only ciphertext
  remnants (already AEAD-protected and now further orphaned by tombstoning
  the pointer/metadata needed to reconstruct AAD) persist for the
  remaining plan-retention window, never plaintext.
POST_VALIDBEFORE_CIPHERTEXT_RISK=
  LOW. After validBefore, the encrypted authorization is cryptographically
  intact but economically inert — any decrypt-and-submit attempt fails at
  the facilitator/chain level (expired EIP-3009 authorization is rejected
  by contract-level validation, independent of this application). The
  residual risk is confidentiality of buyer address + historical amount,
  not fund risk.
```

## 11. Workflow step graph

Reviewed against current authoritative ordering in `x402-service.ts`
(verify → lock → route → execute → PCC → settle → deliver, confirmed
across every prior checkpoint in this chain). The proposed graph is
accepted with one addition (step 0.5, explicit envelope decrypt as its own
step so a decrypt failure is distinguishable from a validation failure):

```
WORKFLOW_STEP_GRAPH=
  STEP 0  validate durable event/envelope metadata (clear fields, expiry
          fast-path)
  STEP 0.5 decrypt envelope (AEAD open, bound to job/service/network/
          amount/payTo associated data)
  STEP 1  execute web-context retrieval (Modal safe-egress fetch)
  STEP 2  validate executor output
  STEP 3  build/validate PCC
  STEP 4  pre-settlement invariant check (re-verify authorization not
          expired, amount/network/asset/payTo still match quoted values)
  STEP 5  settle (facilitator .settle() — single owner, see §3)
  STEP 6  if settlement response ambiguous: read-only reconciliation
  STEP 7  persist result/receipt
  STEP 8  terminal state transition + envelope tombstone (§10)
```

## 12. Retry policy per step

```
ALL_WORKFLOW_STEPS_HAVE_EXPLICIT_RETRY_POLICY=YES
```

| STEP | SIDE_EFFECT_CLASS | RETRIES | TIMEOUT | IDEMPOTENCY_KEY | RATIONALE |
|---|---|---|---|---|---|
| 0 validate metadata | pure/read-only | 3, exponential | 10s | n/a | Cheap, safe to retry |
| 0.5 decrypt envelope | pure (given key) | 0 | 5s | n/a | A decrypt failure (tamper/wrong AAD/wrong key) is not transient; retrying cannot change a cryptographic verdict |
| 1 executor (Modal fetch) | external, non-financial but time-varying | 0 automatic | bounded to Modal's own 35s function timeout | `EXECUTION_IDEMPOTENCY_KEY` (§15) | Not proven safe to retry blindly (target site may be stateful/rate-limited); explicit-once per §15 |
| 2 validate output | pure | 3, exponential | 10s | n/a | Deterministic given step 1's output |
| 3 PCC build/validate | pure/deterministic given inputs | 3, exponential | 10s | `PCC_IDEMPOTENCY_KEY` (§16) | May retry only because deterministic |
| 4 pre-settlement invariant check | pure/read-only | 3, exponential | 10s | n/a | Cheap, safe |
| 5 settle | **financial, non-idempotent by default** | **0 blind retries** | Modal-independent, facilitator-bounded (proposed 30s) | `payment_identifier` (already the existing D1-level settle-attempt-count key, §14) | Blind platform-default retries on a step that calls a real chain-settlement facilitator risk a genuine double-charge; explicitly forced to 0 and any retry logic is instead the *existing*, already-audited `cdp_facilitator_settle_attempt_count`-bounded, at-most-one-confirmed mechanism (`payment-attempts.ts`), reused as-is inside this one step rather than reinvented |
| 6 ambiguous-settlement reconciliation | **read-only** | 5, exponential | up to `RECONCILIATION_MAX_DURATION` (§13) | n/a | Safe to retry freely — never mutates settlement state, only reads |
| 7 persist result/receipt | idempotent UPSERT on `job_id`/`receipt` primary key | 5, exponential | 10s | `RESULT_IDEMPOTENCY_KEY`, `RECEIPT_IDEMPOTENCY_KEY` (§16) | Safe once keys are proven idempotent |
| 8 terminal transition + tombstone | idempotent state-machine transition (existing terminal-transition code already proves idempotent re-entry is safe, per H1A's own reading of the state machine) | 5, exponential | 10s | `job_id` | Reuses existing, already-audited terminal-transition idempotency |

No step inherits an unexamined platform default.

## 13. Settlement ambiguity

```
AMBIGUOUS_SETTLEMENT_RETRY_POLICY=NO_BLIND_RETRY
RECONCILIATION_SOURCES=
  provider (CDP facilitator) metadata/status lookup by payment_identifier;
  payment_attempts row state (existing cdp_facilitator_settle_attempt_count
  column, already present per H1A's schema read); authorization nonce
  consumption state (on-chain, via a read-only RPC call against the
  known USDC contract, same technique already used throughout this
  checkpoint chain for buyer-balance verification); buyer→seller USDC
  transfer existence (on-chain read, same technique); transaction hash if
  discoverable from any of the above.
RECONCILIATION_MAX_DURATION=
  Bounded, proposed 10 minutes (5 retries × exponential backoff on a
  read-only step, per §12), after which the job transitions to an
  explicit `SETTLEMENT_AMBIGUOUS_UNRESOLVED` terminal state requiring
  human review rather than looping indefinitely.
```

Settlement ambiguity persists as its own distinct state
(`SETTLEMENT_AMBIGUOUS`) distinguishable from confirmed/rejected, matching
the checkpoint's explicit requirement.

## 14. Crash during settle — hardest case

Analyzed: Workflow step 5 starts facilitator `.settle()` → facilitator
receives request → Workflow runtime dies before the step returns.

Existing evidence from `payment-attempts.ts` (read this checkpoint):
`cdp_facilitator_settle_attempt_count` is already incremented *before* the
real `.settle()` call is issued (comment at `:348`: *"BEFORE ever invoking
a facilitator's settle operation, never after"*), and a documented
invariant already exists that *"settlement_confirmed count can never
exceed 1 even when facilitator_settle_attempt_count is 2"* (`:470`). This
is a pre-existing, already-audited at-most-one-confirmed guarantee, not
something this design invents from scratch.

With step 5 retries forced to `0` (§12), a Workflow-runtime crash mid-step
does **not** trigger the platform to automatically re-run `.settle()` —
Cloudflare Workflows retries are step-scoped and explicit; a `retries:
{limit: 0}` step that crashes lands the *Workflow instance* (not the step)
in a failed/incomplete state, which is then handled by step 6's read-only
reconciliation on next resume/observation, never by blindly re-issuing
`.settle()`.

```
SETTLE_CRASH_DUPLICATE_PAYMENT_POSSIBLE=NO
SAFE_SETTLE_CRASH_RECOVERY=
  1. Step 5 sets retries.limit=0 — no automatic re-invocation of
     .settle() by the platform.
  2. The pre-existing D1 cdp_facilitator_settle_attempt_count increment
     (before the call) plus its already-proven at-most-one-confirmed
     invariant is reused unchanged as the settlement-state source of
     truth.
  3. On Workflow resume after a crash, step 6 (read-only reconciliation,
     §13) runs BEFORE any step 5 re-invocation would ever be considered,
     and if reconciliation finds a confirmed settlement, the terminal
     state is set from that evidence — settle() itself is never called a
     second time by this design in that path.
  4. EIP-3009 nonce semantics provide a second, independent backstop:
     even in an unanticipated code path that did attempt a second
     .settle() call with the same signed authorization, the nonce is
     consumed on first successful on-chain execution, and a second
     submission of the same nonce is rejected by the token contract
     itself — a chain-level, not application-level, guarantee.
```

`NO` is proven, not assumed — via the composition of (a) explicit
zero-retry on the financial step, (b) the pre-existing D1 attempt-count
invariant, (c) reconciliation-before-retry ordering, and (d) EIP-3009's
own nonce-replay protection as an independent backstop.

## 15. Execution idempotency

```
EXECUTION_IDEMPOTENCY_KEY=payment_identifier (same as Workflow instance ID
  — the executor step is scoped 1:1 to its owning Workflow instance,
  which is itself already deduplicated at creation, §5)
EXECUTOR_AUTOMATIC_RETRY_ALLOWED=NO
```

Exact-once application-level invocation is preferred over infrastructure
retry for this release, sacrificing resilience to transient Modal/network
blips in favor of not re-fetching (and potentially re-billing bandwidth
on, or behaving differently against) a possibly-stateful or rate-limited
third-party target mid-pipeline.

## 16. Result/receipt idempotency

```
RESULT_IDEMPOTENCY_KEY=job_id (existing job identity, unique per pipeline)
RECEIPT_IDEMPOTENCY_KEY=payment_identifier (one receipt per payment, never
  per retry)
PCC_IDEMPOTENCY_KEY=job_id + a content hash of the executor's raw output
  (PCC is deterministic given identical input; recomputing it from the
  same output must yield the same PCC, so this key both dedups AND
  self-verifies determinism)
```

Duplicate Workflow observation/restart cannot create two results, two
receipts, or two completion events: all three writes are UPSERTs keyed as
above, reusing the same idempotent-primary-key pattern already required
of D1 persistence steps in §12.

## 17. Synchronous HTTP facade

```
SYNCHRONOUS_WAIT_MECHANISM=
  Existing D1 job-state polling — the HTTP Worker, after creating (or
  looking up, §5) the Workflow instance, polls the job's own D1 row
  (already the client-visible source of state throughout this entire
  checkpoint chain) at a short interval until it observes a terminal
  state or its own request-lifetime budget is exhausted, then serializes
  today's existing response shape from that row. This is chosen over
  Cloudflare's native Workflow instance-status binding/API specifically
  because D1 job state is already the system's single existing
  client-facing read model (§22) — introducing a second status source
  (native Workflow status) purely for the synchronous-wait path would
  create exactly the split-brain this design otherwise avoids.
SYNCHRONOUS_PUBLIC_RESPONSE_SCHEMA_CHANGE_REQUIRED=NO
```

Connected clients observe unchanged behavior: request in, poll internally
(invisible to the client), same response shape out. Disconnected clients
no longer strand the pipeline (§18-19).

## 18. Client-disconnect success case

```
EXISTING_POST_DISCONNECT_RESULT_RECOVERY=NO
```

No job/result/receipt/payment-identifier lookup endpoint currently exists
in the routes read this checkpoint chain (`x402-service.ts` and sibling
route files expose creation/payment paths, not a GET-by-id result
endpoint).

Smallest safe recovery mechanism (design only, not implemented):

- A new, narrowly-scoped `GET /v2/web/context/result/:payment_identifier`
  (or equivalent) endpoint, authenticated by knowledge of the
  `payment_identifier` itself (already an unguessable, CDP-issued opaque
  token — the same trust model the existing 402 flow already relies on
  for its own correlation ID) — no new secret, no new auth primitive.
  Returns the same terminal-state response shape a connected client would
  have received synchronously, sourced from the same D1 job row (§17,
  §22). Idle/incomplete state returns a bounded "still processing" shape,
  not the final schema, avoiding the schema-change concern of §17.

## 19. No double-charge on client retry

```
CLIENT_RETRY_DEDUPLICATION_KEY=payment_identifier (single authoritative
  identity spanning: Workflow instance ID §5, D1 payment_attempts row,
  settle-attempt-count invariant §14, result/receipt keys §16)
RETRY_AFTER_SETTLEMENT_BEHAVIOR=
  Lookup by payment_identifier returns the existing terminal
  result/receipt (§18's recovery endpoint, or the synchronous facade if
  the retry is itself a fresh HTTP call reusing the same payment
  material) — no second execution, no second settlement attempt.
RETRY_WHILE_WORKFLOW_RUNNING_BEHAVIOR=
  §5's duplicate-create behavior applies: the retrying request's create
  call is rejected as a duplicate instance ID, the Worker binds to the
  existing running instance's status instead of starting a second
  pipeline, and the synchronous facade (§17) continues polling that same
  instance's backing D1 row.
```

## 20. Authorization expiry

```
AUTH_EXPIRY_BEFORE_SETTLEMENT_STATE=
  Step 4 (pre-settlement invariant check, §11) re-validates validBefore
  against current time immediately before step 5 would run. If already
  expired: SETTLEMENT_CALL_COUNT remains 0 for that instance (step 5 is
  never entered), the job transitions to an explicit
  `authorization_expired_unsettled` terminal state, and any executor
  result already produced by step 1-3 is retained for audit but never
  paid for — matching the checkpoint's required invariant that execution
  result may exist while settlement never occurs.
```

## 21. Workflow start failure

```
WORKFLOW_CREATE_FAILURE_STATE=
  Explicit `continuation_create_failed` terminal job state, distinct from
  every executor/settlement failure state, so operators can distinguish
  "the payment pipeline never durably started" from "it started and later
  failed."
SYNC_FALLBACK_TO_OLD_PIPELINE_ALLOWED=NO
```

If Workflow-instance creation itself fails after successful payment
verification, no executor invocation and no settlement occur under any
circumstance — there is no in-request fallback path left in the Worker to
silently regress to (§3 already removed `.settle()` from the Worker
entirely).

## 22. D1 / Workflow source of truth

```
AUTHORITATIVE_JOB_STATE_SOURCE=D1 (job + payment_attempts rows — the
  system's existing, already-audited, client-facing state model
  throughout this entire multi-week checkpoint chain)
AUTHORITATIVE_SETTLEMENT_STATE_SOURCE=D1 (payment_attempts,
  cdp_facilitator_settle_attempt_count + lifecycle_stage — pre-existing,
  already proven at-most-one-confirmed per §14)
AUTHORITATIVE_WORKFLOW_RUNTIME_SOURCE=Cloudflare Workflows engine (owns
  only orchestration/step-sequencing/retry state — never treated as a
  second economic source of truth; every economically meaningful fact a
  Workflow step produces is written through to D1 before being considered
  "true" by anything outside that one step)
```

No split-brain: Workflow runtime state answers "where is this pipeline in
its steps," D1 answers "what happened economically," and only D1 is ever
read by anything client-facing (§17, §18).

## 23. Workflow versioning

Verified against current docs (§2 fetch) plus general Cloudflare
Workflows/Workers-versioning model knowledge:

```
WORKFLOW_VERSION_PINNING_MODEL=
  A running Workflow instance is bound to the Worker script version that
  created it at creation time for the remainder of that instance's
  execution; a new Worker version deploy does not retroactively alter
  already-created, in-flight instances' code.
IN_FLIGHT_INSTANCE_VERSION_BEHAVIOR=
  In-flight instances continue running the code version active at their
  creation; this is the standard Workflows durable-execution guarantee
  (the whole point of the platform is that step state + code binding
  survive Worker redeploys).
CANDIDATE_QUALIFICATION_MODEL=
  YES — a non-production Worker Version candidate (0% traffic, exactly
  the pattern used throughout this entire checkpoint chain) can create
  and qualify against a Workflow the same way it qualifies against Modal
  today: the WorkflowEntrypoint class ships in the same Worker bundle, so
  a non-deployed candidate version already carries its own Workflow
  binding/class without affecting the active production version's
  Workflow bindings.
ROLLBACK_MODEL=
  Rolling production traffic back to a known-good Worker version does not
  terminate or mutate any already-running Workflow instance created by a
  different version — those instances continue independently to
  completion. This is the primary rationale for §30's rollback
  requirement being satisfiable at all.
```

## 24. Same-script vs dedicated Workflow Worker

```
WORKFLOW_DEPLOYMENT_TOPOLOGY=
  A. WorkflowEntrypoint class defined inside the existing edge-api Worker
     package/script (siteborne-utility-edge), NOT a dedicated separate
     Worker/Workflow service.
RATIONALE=
  - Version coupling: the Workflow's code must already match the Worker
    version that created its instances (§23) — putting it in the same
    script makes this automatic rather than requiring cross-service
    version-pinning coordination.
  - Secret scope: the Workflow needs the SAME secrets the Worker already
    holds (CDP_API_KEY_*, MODAL_WEBCTX_*, PAID_RECEIPT_SIGNING_*, plus the
    new envelope key) — a dedicated service would require duplicating or
    cross-granting all of them, widening blast radius for no benefit.
  - D1 binding scope: same D1 database, same binding — no cross-service
    D1 access-grant plumbing needed.
  - Blast radius / bundle isolation: this project's own established
    pattern (Q6G) already demonstrates the *opposite* choice — moving
    genuinely separable, differently-privileged compute (arbitrary public
    HTTP egress) to an entirely separate Modal service specifically
    because it needed a different security boundary (off-Cloudflare TCP).
    The Workflow orchestration layer has no such differing boundary from
    the Worker that creates it — it is the same trust domain, same
    secrets, same D1, same team-operated release process — so the
    established precedent for splitting services (a genuine trust/
    boundary difference) does not apply here, and a dedicated
    `siteborne-webctx-paid-continuation` service would only add
    deployment/rollback/qualification coordination overhead without a
    corresponding isolation benefit.
  - Operational complexity: one release process (existing Worker
    Versions + gradual deployment tooling, already proven throughout this
    checkpoint chain) instead of two coordinated release processes.
```

## 25. Queues as non-primary component

```
QUEUE_REQUIRED=NO
```

No audit/fanout/dead-letter need has been identified that D1 rows +
existing structured logging cannot already satisfy for this release. Per
the checkpoint's own YAGNI default, no Queue is introduced. If a future,
separately-justified need for async fanout/notification arises, it would
be evaluated on its own merits then — never as owner of settlement or
payment material, matching the checkpoint's hard requirement.

## 26. Crash matrix

| Crash point | DURABLE_STATE | ECONOMIC_STATE | RESTART_BEHAVIOR | DUPLICATION_RISK | RECOVERY_ACTION |
|---|---|---|---|---|---|
| Before Workflow create | None yet | payment verified, unsettled | Client retry re-enters §4 handoff; if payment_identifier already has a `LOCKED`/verified row but no instance, Worker (re)issues create | None — create hasn't happened | Worker retries create using the same deterministic ID |
| After create, before HTTP waiter starts | Instance exists, step 0 not yet run | unsettled | HTTP Worker may have crashed too; a later request with the same payment_identifier re-enters §17/§18 lookup, binds to existing instance | None (§5 dedup) | Poll/GET-result endpoint (§18) attaches to running instance |
| Workflow crash before executor (step 0/0.5) | Instance state = pre-step-1 | unsettled | Workflow engine resumes instance from last completed step per platform durable-execution model | None | Automatic platform resume |
| Workflow crash during executor (step 1) | Step 1 incomplete | unsettled | Resume re-enters step 1; §15 forces 0 automatic retry at *application* level even though the engine *could* resume — design explicitly treats an interrupted step 1 as needing fresh manual/operator judgment rather than blind re-fetch, to honor exact-once executor semantics | Low — no settlement possible yet regardless | Job surfaces as `execution_interrupted`; operator/next design iteration decides re-fetch policy |
| Crash after executor, before PCC | Step 1 output persisted (durable step result) | unsettled | Resume proceeds to step 2/3 using already-persisted step-1 output — no re-fetch needed | None | Automatic |
| Crash after PCC, before settle | Steps 1-3 durable | unsettled | Resume proceeds to step 4/5 | None | Automatic |
| Crash before settle request leaves | Step 4 complete | unsettled | Resume enters step 5 fresh — settle() has never been called | None | Automatic, safe |
| Crash after settle request leaves, before response | **This is §14's hardest case** | ambiguous | Step 5 retries=0; instance lands incomplete; reconciliation (step 6) runs on next observation, never blind re-settle | Proven NO (§14) | Read-only reconciliation |
| Settle confirmed, then crash before D1 persistence | Chain-confirmed, D1 not yet updated | **settled on-chain, D1 lagging** | Resume/reconciliation (step 6/7) reads facilitator + chain state and writes the already-true confirmed state to D1 — D1 catches up to reality, never re-settles | None (settle already happened once; catching D1 up is not a second settlement) | Reconciliation write-through |
| Result persisted, crash before receipt | Result durable, receipt missing | settled | Resume re-enters step 7, UPSERT-idempotent receipt write | None (§16 idempotent key) | Automatic |
| Receipt persisted, crash before terminal event | Receipt durable, job not marked terminal | settled | Resume re-enters step 8, idempotent terminal transition (already-proven idempotent per H1A's reading of the state machine) | None | Automatic |
| HTTP client disconnect at any phase above | Unaffected — Workflow is fully decoupled from the HTTP request lifetime (§2's core finding) | Unaffected | Workflow continues regardless; §17/§18 provide the client a path back to the result | None (this is precisely the property H2A/H2AR proved missing and this design restores) | Poll (still connected) or GET-result endpoint (reconnect later) |

## 27. Security threat model

| Threat | Mitigation |
|---|---|
| Ciphertext exfiltration (D1/Workflow-state read access leaked) | AEAD confidentiality; post-validBefore, exposure is address/amount-history only, not fund risk (§10) |
| Continuation-key compromise | Versioned rotation (§9); fail-closed on missing key; scope-limited secret distinct from all other credentials |
| Workflow API/operator (Cloudflare dashboard) access | Same operator trust boundary already relied upon for Worker secrets/versions throughout this entire checkpoint chain — no new principal introduced |
| D1 access | Existing binding scope, unchanged by this design |
| Log leakage | Explicit rule: raw signature/authorization never logged, matching every prior checkpoint's established convention |
| Replay of encrypted envelope | AEAD associated data binds ciphertext to job/service/network/amount/payTo (§8) — cannot be replayed against a different context even with ciphertext access; and even a same-context replay after validBefore is inert (§10) |
| Cross-job envelope substitution | Same AAD binding — decryption fails closed if envelope is attached to the wrong job |
| Stale authorization replay | validBefore check (clear field, fast-path, §8) + EIP-3009 nonce consumption at chain level (§14) — two independent layers |
| Duplicate Workflow creation | Platform-enforced unique instance ID (§5) |
| Malicious client reconnect/retry | §19 — dedup by payment_identifier, no second execution/settlement regardless of retry count |
| Provider (facilitator) replay | Same nonce-consumption backstop (§14) — a facilitator cannot successfully re-settle an already-consumed nonce even if it tried |
| Compromised Workflow binding | Scoped to this Worker's own secrets/D1 only (§24) — a compromise here has the same blast radius as a compromise of the existing Worker today, not a wider one, since this design deliberately avoided introducing a separate service/credential set |

## 28. Cost/latency impact

```
WORKFLOW_INCREMENTAL_COST_ESTIMATE=
  Cloudflare Workflows billing (per current public pricing model) is
  usage-based on requests/CPU-time/duration similar to Workers, with a
  generous free allocation; for a single-digit-step, low-CPU pipeline
  (this design's steps are almost entirely I/O-wait, not compute) the
  marginal per-invocation cost is expected to be a small fraction of a
  cent — not independently billing-API-verified this checkpoint (design-
  only, no provisioning performed), but bounded well below the service's
  own $0.009 price by the same order-of-magnitude reasoning already
  applied to the existing Modal executor cost line in the Q6F design
  report.
ECONOMICALLY_COMPATIBLE_WITH_0_009_PRICE=YES (high confidence, not
  independently billing-API-verified this checkpoint)
```

## 29. Public contract impact

```
PUBLIC_CONTRACT_IMPACT=NO_PUBLIC_CONTRACT_CHANGE
```

The existing paid-request/response shape is unchanged (§17). The only
addition to the public surface is the new, optional, narrowly-scoped
result-recovery endpoint (§18), which is strictly additive
(`BACKWARD_COMPATIBLE_ADDITION` if counted separately) and not required
for a connected client's existing synchronous flow to keep working
unmodified. No 202/polling semantics are introduced into the paid
endpoint itself.

## 30. Migration/rollback

```
MIGRATION_SEQUENCE=
  1. Workflow class + shared envelope/crypto primitives added to the
     Worker's source tree, unreferenced by any live route (no behavior
     change).
  2. New continuation-encryption secret provisioned (separate,
     explicitly-authorized checkpoint — not this one).
  3. Non-deployed Worker candidate built with the Workflow binding wired
     into the durable-handoff call site (§4), 0% traffic — same pattern
     as every prior candidate in this chain.
  4. Non-economic qualification (deterministic tests, crash-matrix
     simulation, encrypted-envelope tamper tests — §34) against that
     candidate.
  5. Real H2B human-executed payment qualification (fresh, separately
     authorized) — the actual first live proof this architecture settles
     correctly end-to-end.
  6. Canary (F) — separately authorized, out of scope here.
  7. Promotion (G) — separately authorized, out of scope here.
ROLLBACK_WITH_IN_FLIGHT_WORKFLOW=
  Per §23, rolling production traffic back to de70bf98 (or any prior
  known-good version) does not terminate or mutate any Workflow instance
  already created by a newer version — those instances are bound to the
  code version that created them and run to completion independently of
  which version currently receives new traffic. A rollback is therefore
  safe with in-flight instances by the platform's own versioning
  guarantee, not by any bespoke mechanism this design must build.
```

## 31. Old H2A candidate

`2ca5d120-db79-4b54-8ae3-53e2c91dad87` remains non-deployed, 0% traffic,
not eligible for real payment. Not touched this checkpoint.

## 32. H1 job

`de147124-c264-452b-b784-86ee4422ecd1` remains untouched forensic
evidence. `H1_JOB_MUTATIONS=0`.

## 33. Implementation scope proposal (not performed)

```
Existing Worker code:
  apps/edge-api/src/control-plane/routes/x402-service.ts
    (remove in-request executor/PCC/settle continuation; add durable
    handoff call at §4's callsite; add §17 synchronous poll facade; add
    §18 result-recovery route)
  apps/edge-api/src/control-plane/repositories/d1/payment-attempts.ts
    (extend with workflow_instance_id column; reuse existing
    cdp_facilitator_settle_attempt_count invariant unchanged)

New Workflow code:
  apps/edge-api/src/control-plane/workflows/webctx-v2-paid-continuation.ts
    (WorkflowEntrypoint, steps 0–8 per §11)

Shared orchestration domain code:
  apps/edge-api/src/control-plane/evidence/continuation-envelope.ts
    (AES-256-GCM encrypt/decrypt, AAD construction, key-id resolution —
    shared by both the Worker's encrypt-at-handoff and the Workflow's
    decrypt-at-step-0.5)

D1 schema changes:
  payment_attempts: + workflow_instance_id, + envelope_key_id (both
  nullable/additive, non-breaking)

Wrangler config:
  wrangler.toml: + [[workflows]] binding block

Tests:
  per §34

Deployment/provisioning:
  Workflow class ships in-bundle (§24) — no separate provisioning step
  beyond the standard Worker version upload + wrangler.toml binding

Secret provisioning:
  PAYMENT_CONTINUATION_ENCRYPTION_KEY (name TBD per repo convention) — a
  future, separately-authorized checkpoint, matching the pattern already
  used for MODAL_WEBCTX_* (Q6H).
```

None of the above created or modified this checkpoint.

## 34. Test plan

TDD coverage design (no real payment required for any of these):

- Client disconnect at each crash-matrix point (§26), simulated via
  aborting the HTTP response stream while a fake Workflow step is
  in-flight.
- Workflow restart resuming from each step boundary (mock
  `WorkflowStep.do()` to fail-then-resume).
- Duplicate Workflow create (assert lookup-not-second-pipeline behavior,
  §5).
- Executor failure and executor timeout (mock Modal client
  error/timeout).
- PCC failure.
- Authorization expiry immediately before step 5 (assert
  `SETTLEMENT_CALL_COUNT=0`, §20).
- Settle rejection (facilitator returns a definite decline).
- Settle transport ambiguity (facilitator call throws/times out with no
  definite response — assert reconciliation path, never blind retry).
- Crash after settle transmission but before response (§14's hardest
  case — assert no duplicate `.settle()` invocation across a simulated
  resume).
- Settled-on-chain but D1-persistence-failure (assert reconciliation
  write-through, §26 row 9).
- Duplicate client retry at every lifecycle phase (§19).
- Encrypted envelope tamper (flip a ciphertext/AAD byte, assert decrypt
  failure closes the step, never proceeds).
- Wrong job associated data (assert cross-job ciphertext rejected, §8).
- Wrong amount/network/service embedded in AAD vs. actual job (assert
  rejection).
- Key missing at encrypt time and at decrypt time (assert fail-closed,
  §9).
- Key rotation (encrypt under key_id N, decrypt succeeds while N is still
  accepted; decrypt fails once N is fully retired past its bound
  in-flight window).
- Workflow polling/waiter disconnect (client disconnects mid-poll;
  Workflow unaffected, §17/§26 last row).
- Rollback with in-flight Workflow (simulate version switch mid-instance,
  assert instance completes unaffected, §23/§30).

## 35. Implementation checkpoint decomposition

```
IMPLEMENTATION_CHECKPOINT_SEQUENCE=
  H2AWI-1  shared durable state/envelope primitives (§8-10, §33's
           continuation-envelope.ts) + deterministic unit tests (§34's
           tamper/AAD/key-rotation cases) — no Workflow, no route change.
  H2AWI-2  Workflow orchestration class (§11-16, §33's
           webctx-v2-paid-continuation.ts) + deterministic tests (§34's
           step-graph/retry/crash-matrix/idempotency cases) — Workflow
           class exists in source, still unreferenced by any live route.
  H2AWI-3  HTTP integration (§3-4, §17-21, route changes in
           x402-service.ts) + disconnect/dedup/expiry tests (§34's
           disconnect/duplicate-retry/auth-expiry cases) — still 0%
           traffic candidate only.
  H2AWI-4  Cloudflare provisioning (wrangler.toml Workflow binding,
           envelope-key secret — each its own explicit human-authorized
           mutation, matching this chain's established pattern) +
           non-economic live verification (qualification deployment,
           coherence gates — same shape as every prior Q6-series
           candidate check).
  H2B      one real human-executed payment qualification (separately,
           freshly authorized, matching the existing H1/H1A/H2A/H2AR
           authorization-per-checkpoint pattern already established).
```

## 36. Design decision

```
CORRECTED_POST_VERIFY_ARCHITECTURE=CLOUDFLARE_WORKFLOWS_DURABLE_CONTINUATION
```

All hard feasibility questions in §2-26 pass. The one item not
independently verified via a direct billing/subscription API call is
`WORKFLOWS_AVAILABLE_ON_CURRENT_ACCOUNT_PLAN`, held at high-confidence
inference rather than proof (§2) — this should be the first concrete
action of `H2AWI-4` (attempt an actual non-economic Workflow provisioning
call) rather than a blocker to completing this design.

## Zero-effect law confirmation

No implementation source changes were made. No Worker version, Workflow,
secret, or D1 mutation was performed. No economic action of any kind
occurred. Production and the H1 forensic job were not touched.
