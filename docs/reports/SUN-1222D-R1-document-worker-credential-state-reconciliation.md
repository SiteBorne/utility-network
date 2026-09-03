# SUN-1222D-R1 — Document-Worker Proxy Credential + R2 State Reconciliation

**Status:** Read-only reconciliation. No token created/deleted, no Cloudflare secret changed, no R2 binding changed, no deploy, no candidate upload, no traffic change, no payment material, no 402, no settlement.

**HEAD:** `8732b65` (unchanged before/after this session). Working tree clean before and after.

## 0. Conflict resolution

The prior checkpoint (`8732b65`) claimed Modal Proxy Auth Tokens have "no CLI or documented REST path" and require the web dashboard. **That claim was wrong.** It checked `modal token --help` and `modal secret --help` (the CLI's own login credential and container-injected secrets, respectively) but never checked `modal workspace --help`, which is a separate top-level namespace:

```
$ modal workspace --help
Commands:
  members       View the members of the current Workspace.
  proxy-tokens  Manage the proxy tokens of the current Workspace.
  settings      Manage workspace settings.

$ modal workspace proxy-tokens --help
Commands:
  create  Create a proxy token in the current Workspace.
  list    List the proxy tokens of the current Workspace.
  allow   Allow a proxy token to authenticate to an environment.
  revoke  Revoke a proxy token's access to an environment.
  delete  Delete a proxy token from the current Workspace.
```

Reading the actual repository history (below) shows this CLI path was in fact already used, twice, by earlier checkpoints — `8732b65` simply failed to rediscover it and incorrectly declared the credential path blocked.

## 1. Repository lineage

```
CURRENT_HEAD=8732b657fb6d2f11e2d47abc284fadbaedff4363
EVIDENCE_1E891B6_REACHABLE=YES
EVIDENCE_8732B65_REACHABLE=YES (8732b65 IS current HEAD)
DOCUMENT_WORKER_PROVISIONING_REPORT=docs/reports/SUN-1222C-R1-document-infra-and-buyer-upload-remediation.md
CURRENT_D_RUNBOOK_REPORT=docs/reports/SUN-1222D-resume-credential-candidate-qualification.md
```

## 2. Installed Modal CLI contract

```
MODAL_CLI_VERSION=1.5.5
PROXY_TOKEN_CLI_PRESENT=YES
PROXY_TOKEN_CREATE_CLI_PRESENT=YES
PROXY_TOKEN_LIST_CLI_PRESENT=YES
PROXY_TOKEN_DELETE_CLI_PRESENT=YES
```
(`allow`/`revoke` also present; unused — workspace has no RBAC environments.)

## 3. Modal workspace proxy-token inventory

`modal workspace proxy-tokens list --json` (metadata only, no secret values ever requested or displayed):

| Safe identifier | Created | Possible identity | Basis |
|---|---|---|---|
| `wk-jozfRBPfBFAJbWbQoXV88z` | 2026-08-30 22:28:20 | `POSSIBLE_WEBCTX_TOKEN=YES` | created 13 min after `siteborne-webctx-safe-egress` app deploy (22:15:07); Modal API exposes no name/purpose field to confirm directly |
| `wk-6LcEUTuEzcQBsQ7oIPSmMj` | 2026-09-01 21:02:34 | `POSSIBLE_SITEBORNE_DOCWORKER_TOKEN=YES` | matches `1e891b6`'s reported creation exactly (4 min before that commit) |
| `wk-lSGM4IuoAogKV3CTZX5xHj` | 2026-09-02 07:53:20 | `POSSIBLE_SITEBORNE_DOCWORKER_TOKEN=YES` | matches `796f6cb`'s reported creation exactly (within 1 sec of the `8de9fc3` config commit it built on) |

```
PROXY_TOKEN_COUNT=3
DOCWORKER_DEDICATED_TOKEN_OBJECT_PRESENT=YES
WEBCTX_PROXY_TOKEN_OBJECT_PRESENT=UNPROVEN (plausible by timing only)
```

## 4. Reconciling `1e891b6`

Read in full. `1e891b6` (SUN-1222C-R1) created **`wk-6LcEUTuEzcQBsQ7oIPSmMj`**, redirected `proxy-tokens create --json` straight to a `chmod 600` file outside the repo, used it for exactly one authenticated smoke test against the document worker, then **securely deleted the local staging file** — and explicitly recorded `WORKER_SECRET_MUTATIONS=0` throughout. It was **never** wired into any Cloudflare Worker.

```
COMMAND_USED_TO_CREATE_PROXY_TOKEN=modal workspace proxy-tokens create --json
TOKEN_RESOURCE_ID_SAFE=wk-6LcEUTuEzcQBsQ7oIPSmMj
TOKEN_CREATED=YES
TOKEN_DELETED_AFTER_TEST=NO (the Modal resource itself was never deleted — only the local scratch file was wiped)
ONLY_LOCAL_SECRET_FILE_WIPED=YES
CLOUDFLARE_SECRET_INJECTION_PERFORMED=NO
WHICH_CLOUDFLARE_SCRIPT_RECEIVED_IT=NONE
WHICH_SECRET_NAMES(source-required, not actually injected here)=MODAL_DOCWORKER_ENDPOINT_URL, MODAL_DOCWORKER_PROXY_KEY, MODAL_DOCWORKER_PROXY_SECRET
```

This token is a genuine **orphan**: it exists as a live workspace resource, but its secret value was captured nowhere durable (Cloudflare secrets are write-only at creation time, so it cannot be recovered after the fact). It is currently unusable for provisioning anything.

## 5. Current document worker

```
$ modal app list --json
{"app_id":"ap-XGJZ4rFDRghT8pARYFl3EA","description":"siteborne-document-worker","state":"deployed", ...}
$ modal app history ap-XGJZ4rFDRghT8pARYFl3EA
v1 | 2026-09-01 20:34 CDT | client 1.5.3 | commit f35df82
```
Endpoint is exactly the historical one — no redeploy has occurred since `f35df82`.

```
APP_DEPLOYED=YES
ENDPOINT_PRESENT=YES
REQUIRES_PROXY_AUTH=YES
DOCUMENT_WORKER_ENDPOINT=https://siteborne--siteborne-document-worker-process-document-http.modal.run
```

## 6. Safe unauthenticated probe

```
$ curl -sS -X POST <endpoint> -H "Content-Type: application/json" -d '{}'
HTTP_STATUS=401
```
```
DOCWORKER_UNAUTH_HTTP_STATUS=401
DOCWORKER_FAILS_CLOSED_WITHOUT_AUTH=YES
```

## 7. Dedicated credential boundary — by design, not incidental

`document-evidence-json-v2-cdp-composition.ts`'s own doc comment: *"A dedicated credential set, deliberately NOT reusing `MODAL_WEBCTX_*` — this is a different Modal App (`siteborne-document-worker`, not `siteborne-webctx-safe-egress`)."* Confirmed by distinct env-var names (`MODAL_DOCWORKER_*` vs `MODAL_WEBCTX_*`) throughout `env.ts`, `paid-continuation-workflow.ts`, and both composition files. No source anywhere treats the two as interchangeable.

```
DOCWORKER_DEDICATED_PROXY_IDENTITY_REQUIRED=YES
WEBCTX_CREDENTIAL_REUSE_DESIGNED=NO
```
(Modal proxy tokens are workspace-scoped and *would* technically authenticate to either endpoint, but SITEBORNE's own source contract intentionally keeps the identities separate. This checkpoint does not defeat that.)

## 8. Exact source contract

```
DOCWORKER_ENDPOINT_ENV_NAME=MODAL_DOCWORKER_ENDPOINT_URL
DOCWORKER_PROXY_KEY_ENV_NAME=MODAL_DOCWORKER_PROXY_KEY
DOCWORKER_PROXY_SECRET_ENV_NAME=MODAL_DOCWORKER_PROXY_SECRET
R2_BINDING_NAME=ARTIFACTS
```

| Config field | Required by | Phase | Failure if absent |
|---|---|---|---|
| `MODAL_DOCWORKER_*` (3 fields) | Public API (`production-document-evidence-v2-cdp-route.ts`), Workflow host (`production-dependencies.ts` → `document-evidence-json-v2-cdp-composition.ts`) | executor invocation | `unavailable: true` (fail-closed, never a fixture fallback) |
| `ARTIFACTS` (R2) | Public API (direct route + upload route), Workflow host (`R2ArtifactStoreAdapter` built from the host's own `env.ARTIFACTS` inside `production-dependencies.ts:167`) | artifact fetch, both at request-time and during durable Workflow execution | `unavailable: true` / route 404s |

## 9. Cloudflare secret-name inventory (names only)

Public API script (`siteborne-utility-edge`) secrets are **version-scoped**, not uniform across versions — verified directly rather than assumed:

| Version | Traffic | `MODAL_DOCWORKER_*` present |
|---|---|---|
| `db7054c9` (currently serving 100% of real traffic) | 100% | **NO** |
| `3a74686d` (`sun1222c1-remediation-candidate`) | 0% | **YES** (all 3) |

```
PUBLIC_WORKER_DOCWORKER_ENDPOINT_PRESENT=YES (candidate only; NO on the live 100% version)
PUBLIC_WORKER_DOCWORKER_PROXY_KEY_PRESENT=YES (candidate only; NO on the live 100% version)
PUBLIC_WORKER_DOCWORKER_PROXY_SECRET_PRESENT=YES (candidate only; NO on the live 100% version)
```

Workflow host (`siteborne-paid-continuation-runtime`), single deployed version `1641fac4` (created 2026-09-01T15:16:59 — predates the `5f87a05` source fix by two days):

```
HOST_DOCWORKER_ENDPOINT_PRESENT=NO
HOST_DOCWORKER_PROXY_KEY_PRESENT=NO
HOST_DOCWORKER_PROXY_SECRET_PRESENT=NO
```
(`MODAL_DOCWORKER_ENDPOINT_URL` is a plain var candidate per source typing, but classified here under "secret-name state" since it travels with the same provisioning action as the two real secrets.)

## 10. R2 account state

```
$ wrangler r2 bucket list
siteborne-artifacts   created 2026-09-02T01:59:27.265Z
```
```
R2_ENABLED=YES
SITEBORNE_ARTIFACTS_BUCKET_PRESENT=YES
```

## 11. R2 binding state

```
$ wrangler versions view db7054c9 --name siteborne-utility-edge   → no ARTIFACTS binding
$ wrangler versions view 3a74686d --name siteborne-utility-edge   → env.ARTIFACTS (siteborne-artifacts) R2 Bucket
$ grep r2_buckets wrangler.paid-continuation-runtime.toml         → no match (no R2 block at all)
```
```
PUBLIC_WORKER_R2_BOUND=YES on the 0%-traffic candidate only; NO on the live 100% version
WORKFLOW_HOST_R2_BOUND=NO
SOURCE_EXPECTS_PUBLIC_R2=YES
SOURCE_EXPECTS_HOST_R2=YES
```
The host expectation is not assumed — it is proven by `production-dependencies.ts:167` (`env.ARTIFACTS ? new R2ArtifactStoreAdapter(env.ARTIFACTS) : undefined`), where `env` there is the **Workflow host's own** `Pick<Env, ...>` (widened in `5f87a05` to include `ARTIFACTS`). The Workflow runs durably on the dedicated host process, independent of the originating request, so it must be able to re-fetch the artifact bytes itself — it cannot rely on the public API's own R2 binding.

## 12. Document data flow

| Stage | Component | R2 access required | Docworker proxy required |
|---|---|---|---|
| Buyer uploads bytes | Public API (`document-artifact-upload-route.ts`) | YES (write) | NO |
| Buyer pays, references `artifact_id` | Public API (payment/402 route) | NO (only stores the reference) | NO |
| Durable orchestration | Workflow host (`PaidContinuationWorkflow` via `production-dependencies.ts`) | **YES (read)** | **YES** |
| Extraction | Modal `siteborne-document-worker` | NO | N/A (is the target) |
| Receipt/settlement | Workflow host | NO | NO |

Confirms the host binding gap in §11 is genuine, not incidental — the host is the one component that both trace paths (source grep and call-graph) agree needs the bucket directly.

## 13. Buyer input reality (current source)

```
$ grep artifact_reference/upload_reference/document_url packages/service-runtime/.../document-evidence/service.ts
"only artifact_reference input mode is implemented in this increment"
```
```
ARTIFACT_ID_INPUT_IMPLEMENTED=YES
BUYER_UPLOAD_ROUTE_IMPLEMENTED=YES  (POST /v2/artifacts/documents, added b3878f5; returns an `upload_id` that is the same D1-artifacts-repository id space the artifact_reference lookup reads — i.e. this route is how a buyer obtains a usable artifact_id today)
UPLOAD_REFERENCE_IMPLEMENTED=NO  (the frozen schema's separate `upload_reference` input MODE — as opposed to the upload ROUTE above, which is a different thing with a confusingly similar name — is still declared-but-unbuilt)
DOCUMENT_URL_IMPLEMENTED=NO
EXTERNAL_BUYER_CAN_CURRENTLY_COMPLETE_DOCUMENT_FLOW=NO
```
The last line is **NO** specifically because none of the pieces the flow needs are live at 100% traffic today (§9, §11): `DOCUMENT_ARTIFACT_UPLOAD_ROUTE_ENABLED` and `DOCUMENT_EVIDENCE_JSON_V2_CDP_ROUTE_ENABLED` are both absent from the production version `db7054c9`'s var table, and `ARTIFACTS` is unbound there. The flow is fully implemented in source and already proven end-to-end on the 0%-traffic candidate (`3a74686d`) — it has simply never been promoted to real traffic. Confirmed live: a healthy Modal worker does not, by itself, make `document_evidence_json.v2` commercially buyable — nor, by the identical gap, does it make `company_evidence_graph.v2` buyable (`COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` is likewise absent from `db7054c9`).

## 14. Authenticated endpoint test options (not exercised)

| Option | Technically possible | Uses existing secret | Proves production credential | Least privilege | Requires mutation | Requires fresh authorization |
|---|---|---|---|---|---|---|
| A. Dedicated docworker key/secret already in an approved store | NO — no plaintext copy of any docworker secret exists anywhere outside Cloudflare's write-only store | — | — | — | — | — |
| B. `modal curl` (local Modal identity) | YES | N/A (Modal session auth, not a proxy token) | NO — proves the endpoint works for the developer's own Modal identity, not the Cloudflare production credential | YES | NO | NO (diagnostic only) |
| C. Reuse `MODAL_WEBCTX_*` | YES (would authenticate) | YES | Misleadingly — would prove *a* credential works, not the dedicated one the architecture calls for | NO (violates §7) | NO | Would still need review — contradicts documented design intent |
| D. Create a replacement dedicated token | YES | NO | YES, once wired | YES | YES (token create + 2 secret injections + host deploy) | YES |

## 15. Credential recoverability

```
DOCWORKER_TOKEN_OBJECT_EXISTS=YES (wk-lSGM4IuoAogKV3CTZX5xHj — the one actually wired in, not the orphan)
DOCWORKER_TOKEN_SECRET_RECOVERABLE=NO
RECOVERABLE_SOURCE_CLASS=NONE
```
Nuance the runbook's YES/NO doesn't fully capture: `wk-lSGM4IuoAogKV3CTZX5xHj`'s secret **is** already correctly live inside Cloudflare's secret store — but only bound to the **public API** script's candidate version. Cloudflare secrets are write-only after creation (no API/CLI ever reads a value back), so that same plaintext value cannot be extracted to also provision the **Workflow host**. The public-API side genuinely needs no new credential action. The host side does, and — because Modal proxy tokens are workspace-scoped, not endpoint-scoped — the correct minimal action is minting one additional dedicated token for the host, not attempting to "recover" this one.

`wk-6LcEUTuEzcQBsQ7oIPSmMj` (§4):
```
ORPHANED_UNUSABLE_PROXY_TOKEN=YES
```

## 16. Minimum required mutation manifest

| Action | Target | Why required | External mutation | Secret mutation | Deployment mutation | Authorization required |
|---|---|---|---|---|---|---|
| ADD_HOST_R2_BINDING | `wrangler.paid-continuation-runtime.toml` (repo) | §11/§12: host's own `env.ARTIFACTS` construction has no binding to read | NO (repo-only) | NO | NO (config, pre-deploy) | YES |
| CREATE_ONE_DEDICATED_PROXY_TOKEN | Modal workspace | §15: host needs its own docworker credential; existing live one is unrecoverable, existing orphan is unusable | YES | NO (token creation itself) | NO | YES |
| INJECT_DOCWORKER_PROXY_SECRETS_HOST | `siteborne-paid-continuation-runtime` | §9: host has none of the 3 fields today | YES | YES | NO | YES |
| DEPLOY_WORKFLOW_HOST | `siteborne-paid-continuation-runtime` | §9/§11: running version `1641fac4` predates `5f87a05`'s dispatch fix and lacks the binding above | YES | NO | YES | YES |
| DELETE_ORPHAN_PROXY_TOKEN (`wk-6LcEUTuEzcQBsQ7oIPSmMj`) | Modal workspace | §17 hygiene: avoid an abandoned, permanently-unusable credential accumulating | YES | NO | NO | YES |
| UPLOAD_API_CANDIDATE_0_PERCENT | — | **Not required** — `3a74686d` already exists, fully provisioned, at 0% traffic | — | — | — | — |
| Promote a candidate to real traffic | `siteborne-utility-edge` | §13/§19: required for either new service to be *externally* buyable, but this is a traffic mutation, explicitly out of scope for R1 and for the manifest above | YES | NO | NO (traffic split, not code) | YES (separate, later checkpoint) |

## 17. Token count safety

Preferred final state is exactly one dedicated `siteborne-document-worker` proxy identity. Current state has two candidates for that role: one orphaned and permanently unusable (`wk-6LcEUTuEzcQBsQ7oIPSmMj`), one live and correctly wired into the public API only (`wk-lSGM4IuoAogKV3CTZX5xHj`). Recommend deleting the orphan **before** minting a third token for the host, so the architecture converges on two total (one per script) rather than accumulating three. Not performed here per R1's explicit no-create/no-delete constraint.

## 18. Candidate consequences

```
HOST_DEPLOY_REQUIRED=YES
PUBLIC_CANDIDATE_REQUIRED=NO (already exists, fully provisioned, at 0%)
SOURCE_CHANGE_REQUIRED=YES (host wrangler config only — r2_buckets block)
D1_MIGRATION_REQUIRED=NO
R2_MUTATION_REQUIRED=NO (bucket exists; only a binding/config addition is needed)
```
Redeploying the Workflow host is additive only — it would extend dispatch to `company_evidence_graph.v2` and `document_evidence_json.v2` without touching the registry entries `web_context_verified.v2` and `verify_agent_output.v2` already use (registry-derived `SUPPORTED_SERVICES`, `5f87a05`). Both of those continue working unaffected. `company_evidence_graph.v2` is affected by the *same* gap as `document_evidence_json.v2` — it likewise has no live-traffic route flag and would need the same host redeploy before real settlement is reachable, even though it does not need R2/Modal-docworker at all.

## 19. Live worker ≠ externally buyable

```
DOCUMENT_WORKER_LIVE=YES
DOCUMENT_EVIDENCE_JSON_V2_EXTERNALLY_BUYABLE=NO
```
Buyability additionally requires: the host redeployed with dispatch support, the host's own R2 binding and docworker secrets, and the already-built public-API candidate promoted to real traffic. None of those four are true today.

## 20. Zero mutation confirmation

```
PRODUCTION_MUTATIONS=0
SECRET_MUTATIONS=0
MODAL_TOKEN_MUTATIONS=0
R2_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0
```

## 21. Final packet

```
SUN1222D_R1=PASS
CURRENT_HEAD=8732b657fb6d2f11e2d47abc284fadbaedff4363
MODAL_CLI_VERSION=1.5.5
PROXY_TOKEN_CLI_PRESENT=YES
DOCWORKER_DEDICATED_TOKEN_OBJECT_PRESENT=YES
TOKEN_CREATED_IN_1E891B6=YES
TOKEN_DELETED_IN_1E891B6=NO
ONLY_LOCAL_SECRET_FILE_WIPED_IN_1E891B6=YES
ORPHANED_UNUSABLE_PROXY_TOKEN=YES
DOCWORKER_TOKEN_SECRET_RECOVERABLE=NO
DOCUMENT_WORKER_ENDPOINT=https://siteborne--siteborne-document-worker-process-document-http.modal.run
DOCWORKER_FAILS_CLOSED_WITHOUT_AUTH=YES
DOCWORKER_DEDICATED_PROXY_IDENTITY_REQUIRED=YES
PUBLIC_WORKER_DOCWORKER_PROXY_KEY_PRESENT=YES (0%-candidate only; NO on live 100% version)
PUBLIC_WORKER_DOCWORKER_PROXY_SECRET_PRESENT=YES (0%-candidate only; NO on live 100% version)
HOST_DOCWORKER_PROXY_KEY_PRESENT=NO
HOST_DOCWORKER_PROXY_SECRET_PRESENT=NO
R2_ENABLED=YES
SITEBORNE_ARTIFACTS_BUCKET_PRESENT=YES
PUBLIC_WORKER_R2_BOUND=YES (0%-candidate only; NO on live 100% version)
WORKFLOW_HOST_R2_BOUND=NO
SOURCE_EXPECTS_HOST_R2=YES
ARTIFACT_ID_INPUT_IMPLEMENTED=YES
BUYER_UPLOAD_ROUTE_IMPLEMENTED=YES
UPLOAD_REFERENCE_IMPLEMENTED=NO
DOCUMENT_URL_IMPLEMENTED=NO
EXTERNAL_BUYER_CAN_CURRENTLY_COMPLETE_DOCUMENT_FLOW=NO
HOST_DEPLOY_REQUIRED=YES
PUBLIC_CANDIDATE_REQUIRED=NO
SOURCE_CHANGE_REQUIRED=YES
D1_MIGRATION_REQUIRED=NO
R2_MUTATION_REQUIRED=NO
MINIMUM_REQUIRED_MUTATIONS=ADD_HOST_R2_BINDING (repo), DELETE_ORPHAN_PROXY_TOKEN, CREATE_ONE_DEDICATED_PROXY_TOKEN (host-scoped), INJECT_DOCWORKER_PROXY_SECRETS_HOST, DEPLOY_WORKFLOW_HOST — then, as a separate later step, promote a public-API candidate to real traffic
PRODUCTION_MUTATIONS=0
SECRET_MUTATIONS=0
MODAL_TOKEN_MUTATIONS=0
R2_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0
EVIDENCE_COMMIT_SHA=cc73311
NEXT_REQUIRED_CHECKPOINT=SUN-1222D-R2-CREDENTIAL-CONFIGURATION
```

DO NOT DEPLOY. DO NOT CREATE CREDENTIALS. DO NOT UPLOAD A CANDIDATE. DO NOT CREATE PAYMENT MATERIAL.
