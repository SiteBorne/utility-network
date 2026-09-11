# SUN-1222C PCC lifecycle-model gap remediation

Status: implementation evidence; production migration and deployment are not
authorized.

Start evidence commit: `5ee27296557a8b181ca350ea4bdbf077a83d62b7`.

## Outcome and scope

Model C is implemented as an orthogonal, append-only reconciliation history, a
durable Workflow-owner intent, an ownership-aware drain query, and durable
PaymentServiceLink/receipt evidence. The existing payment lifecycle and its two
terminal meanings are unchanged. No production D1 statement, Worker upload,
deployment, payment, provider operation, Workflow creation, settlement, or chain
transaction was performed by this checkpoint.

Migration `0010_lifecycle_reconciliation_and_workflow_ownership.sql` is
additive. It creates `payment_attempt_reconciliations`,
`payment_workflow_owner_intents`, and `payment_service_link_evidence`; it drops
nothing and updates no historical row. Reconciliation has a monotonic SQLite
`sequence` primary key. The repository exposes append/read only; supersession is
another event referencing `supersedes_reconciliation_id`, never an overwrite.
The unique `dedupe_key` makes operator and automatic inserts retry-safe.

## Frozen lifecycle semantics

The lifecycle remains:

`acquired → verified → executed → settlement_pending → settled_external → link_verified → settled`

with the existing failure branches and exactly the existing terminal stages
`verification_failed` and `settled`. A verified orphan is not a verification
failure. A settled-external record without required link/receipt proof is not
settled. Model C records conclusions without relabeling either fact.

## Reconciliation taxonomy

| Classification                                    | Meaning                                                                                      | Actionable | Automatic owner required   | Cutover blocking                                | Economic truth                                    | Allowed source stages                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------- | -------------------------- | ----------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| `legacy_execution_failed_unsettled`               | Governed historical review proved downstream execution failure and no settlement             | no         | no                         | no after explicit evidence review               | verified; unsettled                               | `verified`, `executed`                                    |
| `legacy_verified_unrouted_unsettled`              | Governed historical review proved verification but no routing/execution or settlement        | no         | no                         | no after explicit evidence review               | verified; unsettled                               | `verified`                                                |
| `legacy_execution_outcome_unknown`                | Historical execution began but final outcome is not provable; replay is not authorized       | no         | no                         | no only after explicit legacy governance        | verified; settlement not evidenced                | `verified`, `executed`                                    |
| `legacy_settled_external_finalization_incomplete` | Settlement/provider/result are real, but durable link/receipt completion is incomplete       | no         | no                         | no only under the explicit historical exception | economically settled; terminal proof incomplete   | `settled_external`                                        |
| `active_workflow_owned`                           | A deterministic Workflow currently owns continuation                                         | yes        | yes                        | yes                                             | in progress                                       | any nonterminal stage                                     |
| `current_execution_failed_unsettled`              | Current Workflow exhausted provider execution and durably proved no settlement/future action | no         | no                         | no                                              | verified; provider failed; unsettled              | `verified`, `executed`                                    |
| `current_settlement_finalization_unresolved`      | Current settlement/link evidence is incomplete and requires resolution                       | yes        | yes or operator escalation | yes                                             | settlement may be real; terminal proof incomplete | `settlement_pending`, `settled_external`, `link_verified` |
| `unreconciled`                                    | No governed conclusion exists                                                                | yes        | not yet established        | yes                                             | unknown                                           | any nonterminal stage                                     |

Unknown classifications fail schema validation. Unknown or absent
classifications fail the drain gate closed. The legacy exclusions are exact
names rather than an age predicate, so Model C cannot silently hide new
failures.

## Effective event and ownership model

The effective reconciliation is the row with the greatest monotonic `sequence`
for one `payment_attempt_id`:

```sql
SELECT * FROM payment_attempt_reconciliations
WHERE payment_attempt_id = ?
ORDER BY sequence DESC
LIMIT 1;
```

Equal timestamps are irrelevant to ordering. Owner kinds actually used are
`workflow`, `owner_intent`, and `none`. Durable ownership is represented by
`payment_workflow_owner_intents.status`: `pending`, `workflow_created`,
`completed`, or `retry_exhausted`. `retry_exhausted` remains blocking and alerts
an operator; it never becomes an inert success. One payment identifier, payment
attempt, and deterministic Workflow instance each have a unique constraint.

The idempotency key is the immutable payment identifier through the
deterministic Workflow ID. The intent ID is
`owner-intent:<deterministic-workflow-id>`. Its payload is the pre-existing
AES-GCM continuation envelope plus clear AAD metadata; no buyer private key or
reusable signing credential is retained.

## Verified-to-Workflow recovery

Before this change the sequence was external verify, job `PAYMENT_VERIFIED`, D1
payment `verified`, then Workflow create. A crash after the D1 write produced an
ownerless verified attempt, and a same-payment request used `get()` only.

Now the public Worker:

1. verifies once;
2. seals the continuation payload and derives the deterministic Workflow ID;
3. executes a D1 `batch()` that changes `acquired → verified` and inserts the
   unique pending owner intent;
4. attempts dispatch; and
5. leaves the intent pending and cutover-blocking on any unresolved failure.

Cloudflare D1 batch statements commit transactionally. An insert conflict rolls
back the paired stage change. After a successful verified commit, recovery
intent therefore always exists. The original request uses `waitUntil` for
latency and a one-minute public-Worker scheduled scan is the independent durable
recovery owner. The schedule remains inactive until separately deployed with the
remediated public source and trigger configuration.

Dispatch always performs `workflow.get(deterministicId)` first. Only confirmed
absence permits one `create({id, params})`. If create times out, it immediately
gets the same ID; success means the response was lost and the intent is marked
created. Otherwise it stays pending with exponential retry delay capped at five
minutes. Twelve automatic attempts cause `retry_exhausted`, a blocking/alerting
state. A same-payment HTTP retry uses the stored intent and the same algorithm;
it does not verify payment, create a payment attempt, reconstruct buyer
material, call a provider, or settle.

The settlement-alert Worker remains read-only and non-economic. It may be
extended in a future deployment to alert on stale pending/exhausted intents,
ownerless verified rows, and delayed settlement finalization. It must never
create Workflows or mutate payment state. Automatic owner creation belongs to
the public Worker because that Worker already owns the cross-script Workflow
binding and encrypted continuation handoff.

## Provider failure and settlement finalization

`settlement_failed` is not repurposed for provider failure: it describes a
settlement outcome, not execution. A terminal executor rejection or exhausted
executor exception retains the truthful payment stage and appends
`current_execution_failed_unsettled` with `actionability=non_actionable`,
`owner_kind=none`, job evidence reference, and `settlement_occurred=false`. The
owner intent is then completed. If that write fails, the owner remains blocking
and Workflow retry can finish it.

The successful CDP path now requires this durable order:

1. provider succeeds and PCC validates;
2. `settlement_pending` is recorded before settle;
3. successful settlement and its transaction reference are recorded as
   `settled_external`;
4. the PaymentServiceLink verifies in memory;
5. the full result and signed PCC receipt are persisted;
6. `payment_service_link_evidence` persists the link JSON/id/hash, payment and
   job correlations, transaction reference, settlement evidence hash, service
   output hash, verification receipt id/hash, verification evidence hash, buyer
   receipt id/hash, and public signing key id;
7. lifecycle advances idempotently to `link_verified` and then `settled`; and
8. the owner intent is completed.

No private signing material is stored. A missing transaction reference, missing
signed PCC fields, conflicting link evidence, or invalid link remains actionable
and never writes `settled`.

Re-entry at `settled_external`, `link_verified`, or `settled` never calls
settle. It reuses the durable settlement fact and runs only idempotent result,
receipt, link-evidence, and lifecycle completion. An ambiguous
`settlement_pending` outcome is resolved by read-only chain receipt evidence; no
blind settle retry is performed. If no authoritative result is available it
remains blocking. A transient link failure retries link finalization only—never
provider execution, payment verification, or settlement.

## Crash-point matrix

| Boundary                                     | Recovery owner and retry                     | Duplicate provider                                          | Duplicate settlement | Outcome                         |
| -------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- | -------------------- | ------------------------------- |
| A: verified externally before D1 batch       | original request; no verified commit yet     | no                                                          | no                   | retry/fail closed               |
| B: verified + intent before create           | scheduled scanner or same-payment retry      | no                                                          | no                   | deterministic owner created     |
| C: create succeeded, response lost           | get deterministic ID, mark created           | no                                                          | no                   | same owner                      |
| D: provider starts                           | Cloudflare Workflow step retry contract      | possible only under documented step-at-least-once semantics | no                   | Workflow-owned/blocking         |
| E: provider succeeds before durable result   | Workflow resumes; provider step memoization  | no after completed step                                     | no                   | continue                        |
| F: result persists before pending            | Workflow resumes to settlement claim         | no                                                          | no                   | continue                        |
| G: settle outcome unknown                    | read-only chain reconciliation               | no                                                          | no blind replay      | confirmed or blocking ambiguity |
| H: settle succeeds before `settled_external` | reconcile transaction reference              | no                                                          | no                   | persist external settlement     |
| I: `settled_external` before link            | Workflow finalization only                   | no                                                          | no                   | continue                        |
| J: link valid in memory before persistence   | repeat link verification and evidence insert | no                                                          | no                   | continue                        |
| K: `link_verified` before `settled`          | finalization CAS resumes                     | no                                                          | no                   | settled                         |
| L: `settled` before HTTP response            | same-payment result reconstruction           | no                                                          | no                   | original durable result         |

## Ownership-aware gate

`OWNERSHIP_AWARE_DRAIN_GATE_SQL` in `lifecycle-reconciliation.ts` returns
separately:

- `raw_nonterminal_lifecycle_count`—historical/raw payment state;
- `owner_intent_pending_count`;
- `active_workflow_owned_attempts`;
- `unreconciled_actionable_attempts`;
- `unresolved_settlement_finalization_count`; and
- `active_cutover_blocking_work_count`—the actual union of actionable attempts
  and pending/current owners.

It blocks absent/unreconciled classification, any classification other than the
explicit inert legacy/current-provider-failure allowlist, pending/exhausted
owner intent, active Workflow ownership, and current settlement finalization.
The same attempt is counted once by a union. It never excludes by age.

The future paid-runtime hard gate is:

```text
PUBLIC_PAID_ADMISSION_CLOSED=YES
OWNER_INTENT_PENDING_COUNT=0
ACTIVE_WORKFLOW_OWNED_ATTEMPTS=0
UNRECONCILED_ACTIONABLE_ATTEMPTS=0
UNRESOLVED_SETTLEMENT_FINALIZATION_COUNT=0
ACTIVE_CUTOVER_BLOCKING_WORK_COUNT=0
```

`RAW_NONTERMINAL_LIFECYCLE_COUNT` remains an audit metric and is not renamed.

## Exact historical 17 plan (design only)

The machine-readable, idempotent plan is
`scripts/data/sun1222c-legacy-17-model-c-plan.json`. Rows 1–4, 7–8, and 10–17
are `legacy_execution_failed_unsettled`; row 5
(`3a728ffc-5f1b-4b12-8145-c84f25fc9330`) is `legacy_execution_outcome_unknown`;
row 6 (`123c4f61-2090-40fb-b918-7b2e1f187af0`) is
`legacy_verified_unrouted_unsettled`; and row 9
(`56d84294-eff5-4f92-ae91-d61ceca5339a`) is
`legacy_settled_external_finalization_incomplete`. All are explicitly
non-actionable with owner `none` only under this governed historical review.
Each evidence reference combines this report's predecessor forensic report with
the exact D1 job ID. The unknown origin of row 6 is not upgraded.

The row-9 lifecycle stays `settled_external`; its settlement reference stays
unchanged; no second settlement or reconstruction is authorized. The plan has 17
unique attempt IDs and stable dedupe keys. It inserts reconciliation events only
and changes no payment attempt, identifier, stage, or settlement reference.

Future command (not executed):

```bash
pnpm tsx scripts/reconcile-payment-attempts.ts \
  --dry-run \
  --remote \
  --database siteborne-utility \
  --plan scripts/data/sun1222c-legacy-17-model-c-plan.json
```

After reviewing preimages under the future production authorization, replace
`--dry-run` with `--apply`. The script requires `--remote` for apply, validates
all 17 exact legacy classifications, uses append-only `INSERT ... SELECT`, and
uses `ON CONFLICT(dedupe_key) DO NOTHING`.

Evidence-reference authority is the committed Git report plus exact D1 attempt
and job identifiers. Git commit identity makes the plan tamper-evident; D1 keeps
the immutable event and deterministic evidence reference.

## Compatibility and future order

Old public and paid runtimes ignore the additive tables and are safe with the
new schema. New public/paid code requires migration 0010; with the old schema it
fails closed at owner-intent/finalization persistence. The required future order
is therefore:

1. separately authorize and apply migration 0010;
2. prove the old public and paid runtimes remain healthy;
3. dry-run and apply the exact 17 append-only legacy classifications;
4. verify raw count 17 and active blocking count 0 for only those reviewed rows;
5. upload and qualify remediated public normal and quiescence versions;
6. deploy the public remediated source and activate its owner-recovery cron;
7. quiesce new paid admission;
8. require every ownership-aware hard-gate metric to be zero; and
9. only then separately authorize the remediated paid-runtime deployment.

Future migration command (not executed):

```bash
npx wrangler d1 migrations apply siteborne-utility --remote --config wrangler.toml
```

## Verification summary

Focused Model-C tests cover append-only supersession, D1 transaction behavior,
single owner intent, same-ID ambiguous create, concurrent recovery, the 17-row
gate fixture, signed-evidence-before-settled, automatic provider-failure
classification, successful link finalization, and restart from
`settled_external` with zero settle replay. The existing 12-boundary Workflow
crash suite and durable HTTP handoff suite also run against the changed code.

Public payment requirements, MCP, A2A, PCC, price, seller, asset/network, and
service activation contracts are unchanged. Public source still has zero settle
calls and zero provider-recovery calls; the dedicated Workflow remains the only
settlement owner.

The final local gate matrix was:

- Typecheck: PASS (23/23 Turbo tasks).
- Build: PASS (12/12 Turbo tasks).
- Lint: PASS (16/16 Turbo tasks).
- Full Vitest suite: PASS (258 files and 3,145 tests passed; 22 files and 78
  explicitly live-gated tests skipped).
- x402 protocol: PASS (34 files, 512 tests).
- MCP protocol/edge/stdio: PASS (81 tests total).
- A2A protocol/edge: PASS (60 tests total).
- PCC Python suite: PASS (91 tests; 5 non-failing deprecation/config warnings).
- PCC generated-model drift: PASS.
- Model-C, seller-determinism, Workflow, and settlement-ownership focus: PASS
  (43 tests), plus the Model-C mutation matrix (14 tests).
- Model-C mutation proof: PASS; the unmutated control passed and all 13 governed
  source-architecture mutants were killed.
- D1 migration/schema/constraint/transaction/concurrency/queue verification:
  PASS with migration 0010 applied only to an isolated Miniflare database.
- Production preflight: PASS; its Cloudflare interaction was read-only secret
  name enumeration only.
- Public Worker Wrangler 4.119.0 dry-run: PASS (bundle and all configured
  bindings resolved; no upload).
- Paid continuation Worker Wrangler 4.119.0 dry-run: PASS (bundle and all
  configured bindings resolved; no upload).
- Secret scan: PASS across 785 commits and the working tree; zero leaks found.
- Reconciliation operator local dry-run: PASS; 17 unique planned rows and no D1
  statement executed.

An initial full-suite run exposed five deterministic test-fixture integration
gaps after the new finalization seam was introduced: four production-registry
orchestration doubles did not provide the new leaf repository, and one
hand-built `upto` route omitted the already-required durable continuation
fixture. The fixtures were corrected without weakening the real fail-closed
schema or Workflow requirements. The two affected files then passed 43/43, and
the final full suite passed as reported above.

No production migration, reconciliation insert, payment-attempt update/delete,
version upload, deployment, traffic change, variable/secret/route/DNS/preview
mutation, paid-runtime deployment, payment authorization, facilitator call,
provider execution, production Workflow creation, settlement, chain transaction,
or mTLS mutation occurred.
