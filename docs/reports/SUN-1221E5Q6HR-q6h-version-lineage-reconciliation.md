# SUN-1221E5Q6HR — Q6H Version-Lineage Reconciliation

Read-only forensic reconciliation of the Cloudflare Worker versions created during
SUN-1221E5Q6H's Modal safe-egress provisioning. No external mutation was performed.

## 1. Local source

- `CURRENT_REPO_HEAD` = `bfb2c452dbecdd61f3f468edf0df6dda3870d707`
- The original `d89b855899ef077fbd1cc42373b14958c3cbc597` SHA is no longer reachable —
  it was rewritten by the subsequent full-history author-identity `git filter-branch`.
  `bfb2c45` is the content-identical rewritten equivalent (same tree, same commit
  message `SUN-1221E5Q6G: add secure off-edge web executor`, different author metadata).
- `Q6G_IMPLEMENTATION_COMMIT_PRESENT` = YES (as `bfb2c45`)
- `WORKING_TREE_CLEAN` = YES — no source drift since Q6G.

## 2. Cloudflare command semantics (installed Wrangler 4.119.0)

- `VERSIONS_UPLOAD_CREATES_VERSION` = YES
- `VERSIONS_SECRET_PUT_CREATES_VERSION` = YES (`wrangler versions secret put` — "Create or
  update a secret variable for a Worker", confirmed via `--help` and via the version list
  itself: every secret update produced a new `create_version_api` version)
- `VERSIONS_SECRET_BULK_CREATES_VERSION` = YES (same subsystem as `put`)
- `VERSIONS_UPLOAD_SUPPORTS_SECRETS_FILE` = YES (`--secrets-file` flag exists on
  `wrangler versions upload`, applies additively, does not delete omitted secrets)

## 3. Complete version window (`wrangler versions list` / `versions view --json`)

| # | Version ID | Created | Source | Message |
|---|---|---|---|---|
| 1 | `090a4bc4-64e4-4152-8ce9-d41977238162` | 2026-08-30T00:53:59Z | version_upload | SUN-1221E4P protocol-forensics candidate (**last pre-Q6H version**) |
| 2 | `4c528982-fdf1-4875-917a-a71b45dca477` | 2026-08-31T03:44:12Z | create_version_api | Updated secret "MODAL_WEBCTX_ENDPOINT_URL" |
| 3 | `b9c4662e-f01d-4016-83dd-39e357b87b47` | 2026-08-31T03:44:30Z | create_version_api | Updated secret "MODAL_WEBCTX_PROXY_KEY" |
| 4 | `48fa45dd-64e2-4130-a7c1-13a27c2be6eb` | 2026-08-31T03:44:48Z | create_version_api | Updated secret "MODAL_WEBCTX_PROXY_SECRET" |
| 5 | `de4b9130-940e-4358-8158-37ccee6ae555` | 2026-08-31T03:46:45Z | version_upload | SUN-1221E5Q6H Modal safe-egress executor candidate |
| 6 | `ba214bc2-967a-406c-b8a8-340da42d9a92` | 2026-08-31T03:46:54Z | create_version_api | Updated secret "MODAL_WEBCTX_ENDPOINT_URL" |
| 7 | `56724e64-a83a-458f-92a5-ccb70719407c` | 2026-08-31T03:46:58Z | create_version_api | Updated secret "MODAL_WEBCTX_PROXY_KEY" |
| 8 | `730c15f8-96a7-42bc-88c3-84bc2d287cc8` | 2026-08-31T03:47:01Z | create_version_api | Updated secret "MODAL_WEBCTX_PROXY_SECRET" (**final candidate**) |

`Q6H_CREATED_WORKER_VERSION_COUNT` = 7 (rows 2–8; row 1 predates Q6H).

## 4. Stale-code secret versions

Script etag for rows 1–4 (`090a4bc4`, `4c528982`, `b9c4662e`, `48fa45dd`):
`2de061e503fb0dd2059b72e613274cf6bedfdd1d5bc18ca5ce63dee4c9272b81` — **identical across
all four**, confirming the first three secret-put operations were applied on top of
stale pre-Q6 code before the current-source upload landed.

- `STALE_PRE_Q6_INTERMEDIATE_VERSION_COUNT` = 3 (`4c528982`, `b9c4662e`, `48fa45dd`)
- Deployment history (`wrangler deployments list`) shows `090a4bc4` was paired at 0%
  with `de70bf98` @100% for one zero-traffic diagnostic window (2026-08-30T01:05–01:24Z),
  then restored — it was never given normal traffic, and none of rows 2–4 appear in any
  deployment at all.
- `STALE_PRE_Q6_VERSION_EVER_DEPLOYED` = NO (0% split only)
- `STALE_PRE_Q6_VERSION_EVER_RECEIVED_NORMAL_TRAFFIC` = NO

## 5/6. Current-source upload identity

- `Q6G_SOURCE_UPLOAD_VERSION_ID` = `de4b9130-940e-4358-8158-37ccee6ae555`
- `Q6G_SOURCE_UPLOAD_SCRIPT_ETAG` = `e9cf867e07d6ac5371dd96b52c67820cce87883906bc5e6380ecd2260bbbda76`
- Message is self-declared (`SUN-1221E5Q6H: Modal safe-egress executor candidate`),
  created immediately after this session's Modal app deployment (chronologically
  consistent), and its declared secret names (`MODAL_WEBCTX_ENDPOINT_URL`,
  `MODAL_WEBCTX_PROXY_KEY`, `MODAL_WEBCTX_PROXY_SECRET`) match exactly what Q6G's
  `ModalSafeEgressClient` reads.
- `Q6G_SOURCE_UPLOAD_MATCHES_D89B855` = YES (content-equivalent local tree confirmed
  clean/unchanged since Q6G; distinct script etag from the stale chain proves new code
  was actually uploaded, not merely re-tagged)

## 7. Secret-derived descendant chain

Script etag for rows 5–8 (`de4b9130`, `ba214bc2`, `56724e64`, `730c15f8`):
`e9cf867e07d6ac5371dd96b52c67820cce87883906bc5e6380ecd2260bbbda76` — **identical across
all four**.

- `POST_Q6G_SECRET_DERIVED_VERSION_COUNT` = 3 (`ba214bc2`, `56724e64`, `730c15f8`)
- `ALL_POST_Q6G_SECRET_VERSIONS_PRESERVE_Q6G_SCRIPT_ETAG` = YES
- `MODAL_PROXY_KEY_SECRET_PRESENT` / `MODAL_PROXY_SECRET_SECRET_PRESENT` /
  `MODAL_ENDPOINT_BINDING_PRESENT` = YES at `730c15f8` (all three present; they
  accumulate progressively across rows 6–8, all present by the final row)

## 8/9. Final candidate detail — **CRITICAL DEFECT FOUND**

- `FINAL_CANDIDATE_SCRIPT_ETAG` = `e9cf867e07d6ac5371dd96b52c67820cce87883906bc5e6380ecd2260bbbda76`
- `FINAL_CANDIDATE_SCRIPT_MATCHES_Q6G` = YES
- `FINAL_CANDIDATE_HAS_PREVIEW` = YES
- `FINAL_CANDIDATE_DEPLOYED_PERCENTAGE` = 0%
- `FINAL_CANDIDATE_IN_ACTIVE_DEPLOYMENT` = NO

**However**, comparing the `env.*` plain-text variable bindings between the stale
chain and the Q6G chain via `wrangler versions view --json` finds the Q6G-source
upload (`de4b9130`, and therefore its entire descendant chain through `730c15f8`) is
**missing 7 plain-text vars** that were present on every prior production-representative
version, including the currently-active `090a4bc4`/production baseline shape:

| Var | Present on stale chain (`090a4bc4`…`48fa45dd`) | Present on `de4b9130`…`730c15f8` |
|---|---|---|
| `PAYMENT_ENVIRONMENT` = "production" | YES | **NO** |
| `PRODUCTION_ENABLED` = "true" | YES | **NO** |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` = "true" | YES | **NO** |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED` = "true" | YES | **NO** |
| `PAID_ROUTES_ENABLED` = "true" | YES | **NO** |
| `VERIFY_V2_CDP_ROUTE_ENABLED` = "true" | YES | **NO** |
| `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` = "true" | YES | **NO** |

Root cause: `wrangler.toml`'s `[vars]` block deliberately does **not** declare these
seven values (the file's own comments state they are intentionally kept out of the
committed config as a production-bootstrap safeguard). `wrangler versions upload`
without `--keep-vars` (and without matching `--var` flags) replaces the live var set
with exactly what's declared in `[vars]` — silently dropping any var that was
previously present only via an out-of-band `--var` flag or dashboard edit. The prior
E-series diagnostic candidates (`090a4bc4` etc.) were evidently uploaded with the
matching `--var` flags reproducing full production config; the Q6H `de4b9130` upload
was not.

Practically: `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` gates whether the web-context route is
even registered, and the other five gate payment/production-bootstrap logic. This
candidate cannot correctly serve `web_context_verified.v2` as configured — its
route/payment gating shape does not match production intent, independent of the Modal
wiring being otherwise correct.

- `FINAL_CANDIDATE_MANIFEST_READBACK` = **FAIL**

## 10/11. Production deployment read-back

- `ACTIVE_DEPLOYMENT_VERSION_COUNT` = 1
- `ACTIVE_PRODUCTION_VERSION` = `de70bf98-f304-4d7f-b189-4ae2401041a0`
- `ACTIVE_PRODUCTION_TRAFFIC` = 100%
- `FINAL_CANDIDATE_TRAFFIC` = 0%
- `ALL_Q6H_INTERMEDIATE_VERSION_TRAFFIC` = 0% (none of rows 2–8 appear in any deployment)

## 12. Modal state read-back

- `MODAL_APP_STILL_DEPLOYED` = YES (`ap-Fpf9jp27SCcWMV533bUCsz`, state `deployed`)
- `MODAL_ENDPOINT_PROXY_AUTH_REQUIRED` = YES (unauthenticated `POST` to the live
  endpoint returns `HTTP 401` before application code runs)
- `MODAL_PROXY_TOKEN_PRESENT` = YES (local `.dev.vars` holds all three
  `MODAL_WEBCTX_*` values; not printed or re-read)

## 13/14. Live proof + economic reconciliation (from Q6H evidence, not re-run)

- `Q6H_LIVE_ARCHITECTURE_PROOF` = PASS (Cloudflare-hosted + non-Cloudflare targets both
  returned HTTP 200 through the Modal executor in Q6H; not repeated here)
- All economic counters remain 0 for this checkpoint: `LIVE_402_REQUESTS`,
  `FACILITATOR_VERIFY_CALLS`, `FACILITATOR_SETTLE_CALLS`,
  `SIGN_TYPED_DATA_PAYMENT_CALLS`, `PAYMENT_SIGNATURES_CREATED`, `PAID_REQUESTS`,
  `SETTLEMENTS`, `TRANSACTIONS`, `REAL_ECONOMIC_EFFECT_USDC` = 0.
  `CURRENT_REAL_PAYMENT_AUTHORIZATION` = NONE.

## 15. Authorization deviation

- `Q6H_EXACTLY_ONE_VERSION_INVARIANT_MET` = NO (7 versions created, not 1)
- `Q6H_AUTHORIZATION_SCOPE_ALLOWED_NONDEPLOYED_VERSION_CREATION` = AMBIGUOUS (Q6H's
  text authorized "exactly one non-deployed E6 candidate"; it did not explicitly bound
  the number of intermediate corrective versions used to get there)
- `UNAUTHORIZED_PRODUCTION_DEPLOYMENT_OCCURRED` = NO
- `UNAUTHORIZED_ECONOMIC_ACTION_OCCURRED` = NO
- `SECRET_EXPOSURE_OCCURRED` = NO
- All 7 versions remained at 0% and none received traffic.

`Q6H_GOVERNANCE_CLASS` = `PASS_WITH_AUTHORIZATION_DEVIATION` on the version-count axis,
independent of the manifest defect found in §8/9.

## 16. No cleanup performed

`INTERMEDIATE_VERSION_DELETE_ATTEMPTS` = 0. No versions were deleted. If cleanup is
desired later, the 7 intermediate/candidate IDs are listed in §3 above — deletion
requires separate explicit human authorization.

## 17/18. Technical gate and eligibility

`FINAL_E6_CANDIDATE_TECHNICALLY_VALID` = **NO** — the script/secret lineage proof
(§4–§9) passes cleanly, but `FINAL_CANDIDATE_MANIFEST_READBACK` = FAIL is a
disqualifying condition under this checkpoint's own §17 gate list. The candidate is
missing 7 required production-shape vars, including the flag that enables the
`web_context_verified.v2` route itself.

`SUN1221E6_REAL_PAID_RETRY_ELIGIBLE` = **NO**

`NEXT_REQUIRED_CHECKPOINT` = `E6_CANDIDATE_REBUILD_AUTHORIZATION` (rebuild the
candidate with `wrangler versions upload --keep-vars` — or explicit matching `--var`
flags — so the Q6G source carries the same production var shape as `090a4bc4`,
combined with `--secrets-file` per §19 to attach all three Modal secrets in the same
upload instead of three follow-on `versions secret put` calls).

## 19. Future single-version upload method

`FUTURE_SINGLE_VERSION_UPLOAD_METHOD` = `VERSIONS_UPLOAD_WITH_SECRETS_FILE` — confirmed
available (`--secrets-file`, applies additively) and, critically, must be paired with
`--keep-vars` (or explicit `--var` flags matching current production shape) to avoid
reproducing this checkpoint's manifest defect.
