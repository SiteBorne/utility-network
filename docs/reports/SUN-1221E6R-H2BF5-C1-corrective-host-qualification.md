# SUN-1221E6R-H2BF5-C1 — Corrective Dedicated Workflow-Host Qualification

## Result: BLOCKED (new gap found, no second mutation attempted)

The R1 false-success defect is confirmed fixed: the corrected host no longer
returns `Completed`/`Success=Yes` on a configuration failure. The real
instance this checkpoint created terminated `Errored`/`Success=No`, with the
platform-level "RPC receiver does not implement the method run" error absent.

However, the instance did **not** reach the expected `open-envelope` step.
It threw one dependency-construction check earlier than the R1 proof
covered: `MODAL_WEBCTX_*` safe-egress executor credentials, required by
`buildProductionPaidContinuationWorkflowDependencies` for the
`web_context_verified.v2` service path used by the proven-safe probe
payload, were never provisioned to this host (they were treated as
optional/out-of-scope by every H2BF5 secret-recovery checkpoint — R1,
S1, S2 — because they were not among the 5 secrets required to fix the
false-success defect). `REAL_WORKFLOW_STEP_COUNT=0`, so §22's decisive
proof requirement (`FIRST_REAL_STEP_NAME=open-envelope`) is not met, and
`DEDICATED_WORKFLOW_HOST_REAL_INFRA_QUALIFIED=NO` per §28.

Per this checkpoint's own authorization (no retry, no second instance, no
corrective second mutation on unexpected/ambiguous state), I stopped
immediately at read-only reconciliation rather than provisioning the
missing Modal credentials and triggering a second instance.

## Sequence executed (all real commands, real output)

1. `C1_START_HEAD` verified: `fe7efb5` (contains R1 fix `4428528`), working
   tree clean.
2. Staged 5-secret file (`h2bf5-host-secrets-bulk.json`, mode 0600, outside
   repo) confirmed: `PAYMENT_CONTINUATION_ENCRYPTION_KEY`,
   `PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`,
   `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` present; `CDP_WALLET_SECRET`
   absent.
3. Revalidated all 5 without disclosure: continuation key 32 bytes,
   AES-256-GCM seal/open PASS, AAD tamper rejected; receipt key 32-byte
   Ed25519 seed, sign/verify PASS via `@noble/ed25519`; key ID matches
   `^kid_[a-z0-9]{24}$`; CDP credentials structurally present.
   `NEW_*_GENERATED=0` throughout — nothing regenerated.
4. Predeploy regression, all real command output: 213 files / 2581 tests
   pass (matches R1 baseline exactly); worker-runtime 99/99; lint PASS;
   typecheck 3 pre-existing errors in the R1 test file itself, 0 new
   (`ACCEPTED_UNCHANGED_BASELINE`); production preflight PASS; secrets
   scan 4 pre-existing findings, 0 new; single-settlement-owner audit
   confirmed exactly one production `evidenceProvider.settle()` call site
   (`paid-continuation-workflow.ts:480`).
5. Host public-surface confirmed from `wrangler.paid-continuation-runtime.toml`:
   `workers_dev = false`, no `[[routes]]`, no custom domains, no
   `[triggers]` cron.
6. Deploy command class: `wrangler deploy --config
   wrangler.paid-continuation-runtime.toml --secrets-file <staged-file>`
   (Wrangler 4.119.0 confirmed to support atomic code+secrets in one
   mutation via `--secrets-file`, avoiding a two-mutation
   `secret bulk` + `deploy` sequence).
7. Pre-mutation readback: public API `de70bf98-f304-4d7f-b189-4ae2401041a0`
   @ 100%; host version `7bf84d2b-7b06-4147-a7f6-499ced4332d9`; Workflow
   version `182668e9-4d8f-454c-8e50-45986af2eadc` (the broken zero-step
   version).
8. **Executed the one authorized deployment.** New host version
   `e4f01d0e-800b-41ee-8f44-37f3d25064bd`. All 5 secrets bound (values
   hidden in Wrangler's own output). `HOST_WRANGLER_DEPLOYS=1`.
9. Host readback: secret names exactly the 5 required, `CDP_WALLET_SECRET`
   absent. Public API containment reconfirmed unchanged (`de70bf98` @
   100%, checked repeatedly during subsequent steps). Workflow ownership
   unchanged (`script_name=siteborne-paid-continuation-runtime`,
   `class_name=PaidContinuationWorkflow`); new Workflow version
   `8f79c00c-b59c-48cd-8bf2-cfe876e9ed5d` created (differs from the
   pre-C1 broken version, as required).
10. `C1_GRAPH_DIRECT_READBACK=UNAVAILABLE` — no Wrangler CLI subcommand
    exposes DAG/graph inspection (`wrangler workflows --help` confirmed:
    `list`/`describe`/`delete`/`trigger`/`instances` only). The real
    instance is the authoritative proof, per this checkpoint's own §17
    fallback.
11. Reproved the safe-probe path locally immediately before triggering
    (`ACTUAL_CLASS_HAPPY_PATH` test, 1/1 pass).
12. **Triggered the one authorized real instance**
    (`9895a6ed-e265-413c-9b0c-1929bb6e7e31`) against Workflow version
    `8f79c00c-b59c-48cd-8bf2-cfe876e9ed5d`, using a freshly generated
    proven-safe undecryptable-envelope payload (fresh random IV/ciphertext,
    C1-specific identifiers).
13. Result: `Status: Errored`, `Success: No`, `Duration: 0 seconds`,
    `Steps: (none)`, `Error: dependencies_unavailable: MODAL_WEBCTX_*
    safe-egress executor credentials are missing`.
14. Final containment: public API confirmed unchanged (`de70bf98` @ 100%,
    re-read after the instance). D1 `payment_attempts` query for the C1
    probe identifiers: `rows_written: 0`. Zero economic writes.

## What this proves and does not prove

- **Proves**: the R1 fail-closed fix generalizes correctly on real
  infrastructure — a genuine configuration failure now terminates
  `Errored` on the real platform, not the previous false `Completed`.
  `RPC_RUN_METHOD_MISSING_ERROR=NO` — the graph-compilation defect from
  H2BF3 (plain `wrangler deploy` vs. metadata-only `triggers deploy`) also
  did not recur; the host has a genuinely callable `run()` this time.
- **Does not prove**: that the host reaches `open-envelope` or correctly
  rejects a malformed envelope, because dependency construction for the
  `web_context_verified.v2` service path requires `MODAL_WEBCTX_*`
  credentials that no prior H2BF5 checkpoint identified as required and
  that were never provisioned to this host.

## Mutation counters (all real, all as authorized)

```
HOST_WRANGLER_DEPLOYS=1
WORKFLOW_INSTANCE_CREATIONS=1
HOST_SECRET_MUTATIONS=1 (one atomic bulk write via --secrets-file)
PUBLIC_API_MUTATIONS=0
NEW_CONTINUATION_KEYS_GENERATED=0
NEW_RECEIPT_KEYPAIRS_GENERATED=0
NEW_RECEIPT_KEY_IDS_GENERATED=0
NEW_CDP_CREDENTIALS_CREATED=0
REAL_EXECUTOR_CALLS=0
REAL_FACILITATOR_VERIFY_CALLS=0
REAL_FACILITATOR_SETTLE_CALLS=0
SETTLEMENT_ATTEMPT_COUNT=0
REAL_SETTLEMENTS=0
REAL_PAYMENT_ATTEMPT_ROWS_CREATED=0
CHAIN_TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
HISTORICAL_FORENSIC_MUTATIONS=0
```

## Next required checkpoint

`DIAGNOSIS_ONLY` — determine whether `MODAL_WEBCTX_*` should be added to
the dedicated host's required-secret set (it is legitimately required for
`web_context_verified.v2`, per the same production composition function
the public API Worker's own route already depends on) before any further
host deployment or instance is attempted. No second instance was created
under this authorization.
