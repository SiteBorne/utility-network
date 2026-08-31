# SITEBORNE Dedicated Workflow-Host — H2BF5 External Provisioning Plan

**Goal:** deploy and independently qualify a dedicated Workflow-host Worker
(`siteborne-paid-continuation-runtime`) on real Cloudflare, proving a
compiled Workflow DAG and at least one real, non-economic step execution,
BEFORE the public API Worker's own candidate is ever changed to point at
it — with zero effect on the public API Worker's `de70bf98...@100` /
candidate `@0` split at any point.

**Architecture / evidence:**
`docs/design/SUN-1221E6R-H2BF4-dedicated-workflow-host-architecture.md`,
`docs/reports/SUN-1221E6R-H2BF4-dedicated-workflow-host-local-qualification.md`,
`docs/reports/SUN-1221E6R-H2BF3-workflow-version-id-graph-forensics.md`.

**This document is DESIGN ONLY.** No task below may be executed until a
fresh, explicit, standalone human authorization names this checkpoint
(H2BF5) and its exact scope. H2BF4 itself performs zero external mutation.

## Global constraints (unchanged from every prior H2AWI/H2B checkpoint)

- Every external mutation below requires its own fresh human authorization
  at the H2BF5 gate — this plan freezes the *sequence*, not the
  authorization.
- No task may skip its own authoritative readback. A step whose readback
  does not match its expected result is a hard STOP — do not proceed to
  the next task, do not retry with a variation, escalate instead.
- `SUN1221E6R_H2B2_REAL_PAYMENT_ELIGIBLE=NO` throughout this entire plan.
  Nothing in H2BF5 authorizes a real payment. §G below explicitly requires
  `executor=0, settlement=0, economic effect=0` for the one Workflow
  instance this plan creates.
- Reuse existing primitives; this plan wires configuration and secrets, it
  does not modify `runPaidContinuationWorkflow`, the state machine, or any
  settlement/executor code.

---

## H2BF5-A — Read production state (read-only)

**Command class:** `wrangler workflows describe siteborne-paid-continuation`,
`wrangler deployments list`, `wrangler versions list`, `wrangler secret list
--config wrangler.paid-continuation-runtime.toml` (expect NOT_FOUND — host
script does not exist yet), a read-only D1 query for any
`payment_attempts` row with a non-terminal `lifecycle_stage`.

**Expected mutation:** none.

**Authoritative readback:** confirm `de70bf98...@100` / current candidate
`@0` (whatever candidate is active at H2BF5 execution time); confirm
`siteborne-paid-continuation-runtime` does not yet exist as a Worker
script; confirm zero non-terminal `payment_attempts` rows beyond the
already-forensically-closed `de147124-...` (H1).

**Stop rule:** if a real, non-forensic, non-terminal `payment_attempts`
row exists that is NOT `de147124-...` and not already documented as
closed, STOP — do not proceed to key rotation (§C) or host deploy (§D)
until that job's disposition is explicitly resolved in its own checkpoint.

## H2BF5-B — Provision required host secrets/bindings

**Command class:** `wrangler secret put <NAME> --config
wrangler.paid-continuation-runtime.toml`, once per required secret (see
the architecture doc's §6 secret/binding matrix): `PAID_RECEIPT_SIGNING_PRIVATE_KEY`,
`PAID_RECEIPT_SIGNING_KEY_ID`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and
(if reusing, per §C below) `PAYMENT_CONTINUATION_ENCRYPTION_KEY`. Values
for the four non-continuation-key secrets are the EXISTING production
values already provisioned on the public API Worker (`wrangler secret
list --config wrangler.toml` names them; values are never read back by
this or any prior checkpoint — provisioned from the same secure source the
public Worker's own values originally came from, per this repository's
established secret-handling convention).

**Expected mutation:** up to 5 new Cloudflare Worker secrets on the new
`siteborne-paid-continuation-runtime` script. Zero mutation to the public
API Worker's own secrets.

**Authoritative readback:** `wrangler secret list --config
wrangler.paid-continuation-runtime.toml` lists exactly the secret NAMES
just provisioned (values never printed).

**Stop rule:** if any required secret's value cannot be sourced from an
approved secure source (per the architecture doc §"Other secret source
availability" — never assume, never invent a placeholder), STOP and
document exactly which name is blocking before proceeding.

## H2BF5-C — Continuation-key decision (conditional)

Per the architecture doc §7: `H2BF5_CONTINUATION_KEY_ROTATION_REQUIRED=YES`
was frozen at H2BF4. This task executes that decision.

**Command class:** generate exactly one new 256-bit CSPRNG key locally
(same generation method the original H2AWI-4P provisioning used), held
only transiently in process memory / a local gitignored file — never
logged, never committed. `wrangler secret put PAYMENT_CONTINUATION_ENCRYPTION_KEY
--config wrangler.paid-continuation-runtime.toml`.

**Expected mutation:** one new Cloudflare Worker secret
(`PAYMENT_CONTINUATION_ENCRYPTION_KEY`) on the host script only. The public
API Worker's OWN copy of this secret is provisioned later, in §H/§I below,
in the same operation as its new candidate upload — never provisioned to
the host alone and left mismatched.

**Authoritative readback:** `wrangler secret list --config
wrangler.paid-continuation-runtime.toml` includes
`PAYMENT_CONTINUATION_ENCRYPTION_KEY`.

**Stop rule:** never provision this secret to only one of the two scripts
and leave it there across a checkpoint boundary — if §H/§I cannot complete
in the same bounded H2BF5 session, STOP and treat the host's copy as
provisional/unqualified until the public API side is provisioned too.

## H2BF5-D — Deploy the dedicated host (the qualifying action)

**Command class:** `wrangler deploy --config
wrangler.paid-continuation-runtime.toml` (plain deploy — no `--dry-run`,
no `versions`/`triggers` subcommand; this IS the documented Workflow
DAG-compiling path per H2BF3/H2BF4's own evidence).

**Expected mutation:** one new Worker script (`siteborne-paid-continuation-runtime`),
one new Worker version, deployed at 100% of THAT script's own traffic (see
architecture doc §10 — this has no public-traffic meaning, the script has
zero routes). Cloudflare registers/updates the `siteborne-paid-continuation`
Workflow resource's `script_name`/`class_name` against this new script and
(per the documented contract) compiles its DAG.

**Authoritative readback:** `wrangler workflows describe
siteborne-paid-continuation` → `Script Name: siteborne-paid-continuation-runtime`.
`GET /accounts/{id}/workflows/siteborne-paid-continuation/versions` (the
same read-only endpoint H2BF3 used) → latest version's
`GET .../versions/{id}/graph` → require `graph != null`.

**Stop rule:** if `graph` is still `null` after this deploy, STOP — this
would falsify H2BF3/H2BF4's own root-cause conclusion and requires fresh
investigation (possibly a Cloudflare support escalation), not a retry of
the same command.

## H2BF5-E — Read back the compiled DAG (hard gate before §F)

**Command class:** the same two read-only Workflow-version GET calls as
§D's readback, repeated explicitly as their own gated task.

**Expected mutation:** none (read-only).

**Authoritative readback:** require ALL of: `has_dag=true`, `graph != null`,
`class_name=PaidContinuationWorkflow`, a `run` entry present in the graph,
step-graph node count ≥ 1.

**Stop rule:** any single field failing this exact check is a hard STOP —
do not proceed to §F (instance creation) with a partially-compiled or
ambiguous graph.

## H2BF5-F — One proven-safe, non-economic Workflow instance

**Command class:** `wrangler workflows trigger siteborne-paid-continuation
'<payload>' --id <bounded-test-id>`, where `<payload>` is a
structurally-valid `WorkflowContinuationInput` envelope with
UNDECRYPTABLE ciphertext (same construction H2BF2 used: correct
IV/ciphertext/fingerprint lengths and encoding, random bytes, sealed under
no real key) — pre-mutation-proven locally first (build the exact same
payload, run it through the real, unmodified `runPaidContinuationWorkflow`
with fully-instrumented fake dependencies that throw on any call, confirm
`stepCalls === ['open-envelope']`, `executorCalls === 0`,
`settleCalls === 0`, `jobWrites === 0`) before ever triggering it against
the real Workflow.

**Expected mutation:** one new Workflow instance, `Status: Errored` (step 0
open-envelope legitimately fails closed on undecryptable ciphertext — this
is the CORRECT, intended terminal state for this deliberately-invalid
payload, not a failure of this checkpoint).

**Authoritative readback:** `wrangler workflows instances describe
siteborne-paid-continuation <instance-id>` → `Steps: 1` (open-envelope, the
only step that should have run), status Errored with a decrypt-failure
error, NOT `TypeError: The RPC receiver does not implement the method
"run"` (that specific error is exactly what §E's DAG gate exists to rule
out in advance).

**Stop rule:** if step count is 0, or the error is the RPC-receiver
error, STOP — the DAG compiled (§E passed) but dispatch still fails; this
is a new, distinct defect class requiring its own investigation, not this
plan's remaining steps.

## H2BF5-G — Confirm zero economic effect

**Command class:** re-read the same buyer/seller balance checks prior
checkpoints (H1, H2B, H2BF2) used; re-confirm zero D1 mutation beyond the
one Workflow-instance-scoped row this instance itself may have touched (if
any — step 0 fails before any job/state D1 write is reachable, per the
orchestration function's own step order).

**Expected mutation:** none beyond what §F already produced.

**Authoritative readback:** `executor_calls=0`, `settlement_calls=0`,
`facilitator_verify_calls=0`, `facilitator_settle_calls=0`,
`chain_transactions=0`, buyer/seller balances unchanged.

**Stop rule:** any nonzero economic signal is an immediate STOP and
requires full forensic reconciliation before any further H2BF5 task.

## H2BF5-H — Upload exactly one new public API candidate

Only after §D–G all pass.

**Command class:** `wrangler versions upload --tag h2bf5-candidate
--keep-vars` from this exact H2BF4 commit (or a later commit that has only
had this plan's own H2BF5 changes layered on, never an unrelated
diff) → new candidate version ID.

**Expected mutation:** one new immutable Worker version. No traffic change
yet (upload only, not deploy).

**Authoritative readback:** `wrangler versions view <new-id>` — confirm
the `[[workflows]]` binding reads `script_name=siteborne-paid-continuation-runtime`
in the uploaded version's own bundled config, and (if §C rotated the key)
confirm the new `PAYMENT_CONTINUATION_ENCRYPTION_KEY` secret is attached
to this version per §I below.

**Stop rule:** if the binding readback does not show the cross-script
`script_name`, STOP — do not deploy this candidate at any traffic
percentage.

## H2BF5-I — Provision the rotated key to the new candidate (conditional)

Only if §C rotated the key.

**Command class:** `wrangler secret put PAYMENT_CONTINUATION_ENCRYPTION_KEY`
(against the PUBLIC API Worker's own `wrangler.toml`, no `--config`
override) — same new value as §C, provisioned within the same bounded
H2BF5 session.

**Expected mutation:** one new Cloudflare Worker secret value on the
public API Worker (secrets are Worker-scoped, not version-scoped —
confirmed by this repository's own prior secret-provisioning checkpoints).

**Authoritative readback:** `wrangler secret list` (public API Worker)
still lists `PAYMENT_CONTINUATION_ENCRYPTION_KEY` (name only).

**Stop rule:** if this step cannot complete in the same session as §C,
treat the host's key as provisional and do not proceed to §J.

## H2BF5-J — Place the new candidate at 0% traffic

**Command class:** `wrangler versions deploy de70bf98...@100
<new-candidate-id>@0 --yes`.

**Expected mutation:** deployment record updated; `de70bf98...` remains
100%; new candidate enters at 0%, replacing whatever prior candidate was
at 0% (per this project's existing candidate-replacement convention).

**Authoritative readback:** `wrangler deployments list` shows exactly
`de70bf98...@100` / `<new-candidate-id>@0`.

**Stop rule:** any percentage other than exactly this split is a hard
STOP — do not proceed to `triggers deploy` (§K) with an unexpected split.

## H2BF5-K — `triggers deploy` + final binding readback

**Command class:** `wrangler triggers deploy` (registers the new
candidate's routes/queues/Workflow-binding metadata — unchanged mechanics
from every prior checkpoint).

**Expected mutation:** Workflow resource metadata sync (routes/Workflow
binding registration for the new candidate) — the DAG itself was already
compiled at §D/E and is NOT re-compiled by this call (H2BF3's own finding).

**Authoritative readback:** re-run §D's exact Workflow-describe/version/graph
read-only checks — DAG must still be `has_dag=true`/non-null (unchanged by
this call, confirming H2BF3's finding that `triggers deploy` alone never
affects graph compilation, only metadata).

**Stop rule:** if the DAG regresses to `has_dag=false` after this call,
STOP immediately — this would be a new, previously-unobserved defect class
(triggers deploy destructively affecting an already-compiled DAG) requiring
its own dedicated investigation before ANY further action, including before
declaring H2BF5 complete.

---

## What H2BF5 does NOT authorize

- No real 402/payment/signing/settlement request at any point.
- No promotion of the new candidate above 0% traffic.
- No creation of a second Workflow resource.
- `SUN1221E6R_H2B2_REAL_PAYMENT_ELIGIBLE` remains `NO` after every task in
  this plan completes successfully — H2B2 requires its own fresh
  authorization, gated on H2BF5's own successful, fully-documented
  completion (all of §D–G passing) as a PRECONDITION, never a substitute.
