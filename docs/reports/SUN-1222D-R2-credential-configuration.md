# SUN-1222D-R2-CREDENTIAL-CONFIGURATION

Dedicated Workflow-host document-worker credential provisioning + R2 binding.

## Authorization

Explicit, scoped, standalone authorization message preceding this checkpoint
(same turn as a separate, unrelated SUN-1222B-S3 runbook, which carried no
authorization of its own and was explicitly NOT acted on — see the assistant's
reply at the start of this checkpoint).

Authorized: repo-only R2 binding addition (conditioned on source-tracing
proof it is genuinely required); deletion of exactly one proven orphaned
Modal token (`wk-6LcEUTuEzcQBsQ7oIPSmMj`); creation of exactly one new
dedicated Modal proxy-auth token; injection of exactly the `MODAL_DOCWORKER_*`
secret names proven required by source; exactly one deployment of
`siteborne-paid-continuation-runtime`.

Explicitly not authorized (and not performed): any public API
deployment/candidate upload/traffic mutation, promotion of `3a74686d`,
modification of live production version `db7054c9`, deletion/mutation of the
live candidate token `wk-lSGM4IuoAogKV3CTZX5xHj`, any other credential
rotation, any real 402/signing/settlement/payment.

## 0. Pre-mutation reconciliation

```
D_R2_START_HEAD=62e7974fc160a244221967822aeaaee6766b4e98
WORKING_TREE_CLEAN=YES
```

`modal client version: 1.5.5`. `modal workspace proxy-tokens list --json`
(pre-mutation) returned three tokens, not two — the prior R1 reconciliation
had only examined the two tokens created during document-worker work and
never enumerated the full workspace list:

| token_id | created_at | disposition |
|---|---|---|
| `wk-lSGM4IuoAogKV3CTZX5xHj` | 2026-09-02 07:53:20-05:00 | live, wired to public API 0%-candidate `3a74686d` — **untouched, not authorized** |
| `wk-6LcEUTuEzcQBsQ7oIPSmMj` | 2026-09-01 21:02:34-05:00 | orphaned (created 1e891b6, secret wiped locally, never wired to any Worker) — **deleted this checkpoint** |
| `wk-jozfRBPfBFAJbWbQoXV88z` | 2026-08-30 22:28:20-05:00 | predates all document-worker work by 2 days — almost certainly the existing `web_context_verified.v2` production token; not implicated by this checkpoint's scope and **untouched** |

## 1. Source-traced R2 requirement

`apps/edge-api/src/control-plane/workflows/production-dependencies.ts:167`:
`env.ARTIFACTS ? new R2ArtifactStoreAdapter(env.ARTIFACTS) : undefined`, called
from `buildProductionPaidContinuationWorkflowDependencies` which runs
**on the dedicated Workflow host**, not the public API Worker. The durable
Workflow re-fetches artifact bytes independently of the public API Worker's
own request-scoped R2 access — confirmed by reading the call graph before
editing anything. `wrangler.paid-continuation-runtime.toml` had no
`[[r2_buckets]]` block prior to this checkpoint (R1 finding
`WORKFLOW_HOST_R2_BINDING=NO`, reconfirmed independently here). Binding is
therefore genuinely required, not cargo-culted from the public config.

## 2. Repo-only R2 binding addition

Added to `wrangler.paid-continuation-runtime.toml`:

```toml
[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "siteborne-artifacts"
```

Reuses the existing bucket (created SUN-1222C-R1, already bound on the
public API Worker) — no new bucket, no rename, no object mutation.
`wrangler deploy --config wrangler.paid-continuation-runtime.toml --dry-run`
confirmed clean, `env.ARTIFACTS (siteborne-artifacts)` listed as a binding.
Committed separately from external mutations: `bb2b37e`.

## 3. Orphaned token deletion + readback

```
modal workspace proxy-tokens delete wk-6LcEUTuEzcQBsQ7oIPSmMj -y --profile siteborne
✓ Deleted proxy token 'wk-6LcEUTuEzcQBsQ7oIPSmMj'
```

Authoritative post-delete `modal workspace proxy-tokens list --json` shows
exactly the two untouched tokens (`wk-lSGM4IuoAogKV3CTZX5xHj`,
`wk-jozfRBPfBFAJbWbQoXV88z`) and confirms `wk-6LcEUTuEzcQBsQ7oIPSmMj` is
absent.

## 4. New dedicated token creation + secret injection

`modal workspace proxy-tokens create --json --profile siteborne` — staged
directly to a `chmod 600` file under this session's scratchpad (never
printed to the transcript; verified structurally by listing its JSON key
names only: `Authorization`, `Modal-Key`, `Modal-Secret`).

Injected via `wrangler secret put` (values piped through stdin, never echoed)
onto `siteborne-paid-continuation-runtime` — exactly the three names
`production-dependencies.ts` proves required:

- `MODAL_DOCWORKER_ENDPOINT_URL` — value used is the already-public,
  previously-committed endpoint
  (`https://siteborne--siteborne-document-worker-process-document-http.modal.run`,
  first recorded `SUN-1222C-document-heavy-worker-unblock.md`; this is a
  public HTTPS endpoint URL, not credential material — the proxy-auth
  key/secret pair is what actually gates it, confirmed 401 without them).
- `MODAL_DOCWORKER_PROXY_KEY`
- `MODAL_DOCWORKER_PROXY_SECRET`

Authoritative post-injection `wrangler secret list --config
wrangler.paid-continuation-runtime.toml` shows all three names present
(alongside the eight secrets already provisioned pre-checkpoint) —
no other secret names touched.

Staged token file securely overwritten with random bytes and removed
immediately after successful injection; confirmed absent by `ls` failing
against the path post-wipe.

## 5. Host deployment + readback

```
wrangler deploy --config wrangler.paid-continuation-runtime.toml
```

Succeeded. `Current Version ID: f17acb0c-6400-47f7-a203-5c97b44dcb9d`
(replaces prior `1641fac4-0cf6-4bf0-b182-33b3d1c608ec`, which predated the
SUN-1222D-PRE dispatch-registry fix by two days — this deploy also picks up
that fix on this host for the first time). Binding table confirms
`env.ARTIFACTS (siteborne-artifacts)` live alongside the pre-existing `DB`
and Workflow bindings. "Deployed siteborne-paid-continuation-runtime
triggers" confirms the Workflow trigger/DAG was re-registered. No public
routes exist on this script (`workers_dev = false`, no `routes`) — it is
not independently HTTP-probable; readback is the binding table plus secret
list above.

Public API Worker, its traffic split (`db7054c9` @ 100%, `3a74686d` @ 0%),
and the live candidate token were not touched — confirmed no other
`wrangler`/`modal` mutation command was run against them this checkpoint.

## Final packet

```
SUN1222D_R2=PASS
D_R2_START_HEAD=62e7974fc160a244221967822aeaaee6766b4e98
D_R2_END_HEAD=6060494
R2_BINDING_ADDED=YES
R2_BUCKET_REUSED=siteborne-artifacts
ORPHANED_TOKEN_DELETED=wk-6LcEUTuEzcQBsQ7oIPSmMj
ORPHANED_TOKEN_POST_DELETE_ABSENT=YES
LIVE_CANDIDATE_TOKEN_UNTOUCHED=wk-lSGM4IuoAogKV3CTZX5xHj
THIRD_PRE_EXISTING_TOKEN_UNTOUCHED=wk-jozfRBPfBFAJbWbQoXV88z
NEW_TOKEN_CREATED=YES
NEW_TOKEN_SECRET_PRINTED_LOGGED_OR_COMMITTED=NO
STAGED_FILE_SECURELY_WIPED=YES
MODAL_DOCWORKER_SECRETS_INJECTED=MODAL_DOCWORKER_ENDPOINT_URL,MODAL_DOCWORKER_PROXY_KEY,MODAL_DOCWORKER_PROXY_SECRET
MODAL_DOCWORKER_SECRETS_POST_INJECTION_PRESENT=YES
UNRELATED_SECRETS_MODIFIED=0
WORKFLOW_HOST_DEPLOYED=YES
WORKFLOW_HOST_NEW_VERSION_ID=f17acb0c-6400-47f7-a203-5c97b44dcb9d
WORKFLOW_HOST_PRIOR_VERSION_ID=1641fac4-0cf6-4bf0-b182-33b3d1c608ec
WORKFLOW_TRIGGERS_REDEPLOYED=YES
PUBLIC_API_TOUCHED=NO
PUBLIC_API_TRAFFIC_SPLIT_CHANGED=NO
CANDIDATE_3a74686d_PROMOTED=NO
PAYMENT_MATERIAL_CREATED=NO
REAL_402=NO
SETTLEMENT=NO
ECONOMIC_TRANSACTIONS=0
EVIDENCE_COMMIT_SHA=6060494
WORKING_TREE=clean
SUN1222B_S3=AUTHORIZATION_ABSENT (bare runbook, no standalone authorization message; not acted on)
NEXT_REQUIRED_CHECKPOINT=SUN-1222D-CANDIDATE-QUALIFICATION (document-worker/R2 dependency now fully closed on the Workflow host; public API candidate 3a74686d still requires its own separately authorized promotion/traffic-mutation checkpoint before real buyer qualification)
```
