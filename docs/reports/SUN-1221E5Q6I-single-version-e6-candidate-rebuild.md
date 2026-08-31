# SUN-1221E5Q6I — Single-Version E6 Candidate Rebuild

## Human authorization

Standalone human authorization for this checkpoint was given explicitly in
chat: one new non-deployed Worker version, rebuilt from current Q6G source,
attaching the already-authorized Modal credentials, restoring the seven
governed vars, zero deployment/traffic/economic action. A prior turn's
follow-up question (what value to use for `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED`,
since production itself does not set it) was resolved by this checkpoint's
own §5, which explicitly requires `web_context_verified.v2 / CDP: ACTIVE` —
i.e. `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED=true` on the candidate, a deliberate,
authorized divergence from production's current (route-disabled) state.

## Lineage correction

The spec's cited "Q6G implementation commit"
(`d89b855899ef077fbd1cc42373b14958c3cbc597`) no longer exists on any branch —
it was superseded by the intervening git-identity rewrite (`git filter-branch`,
prior turn) that re-authored all 281 commits. The dangling object is still
present (kept alive by filter-branch's own backup refs) but is not an
ancestor of HEAD, so `git merge-base --is-ancestor` correctly returned false
on the stale SHA.

Verified equivalent: commit `bfb2c45` (message `SUN-1221E5Q6G: add secure
off-edge web executor`) has **identical tree hash**
(`060890d738d64dfdca579f32673068abf2e0fd01`) to the stale `d89b855`, proving
byte-identical content under the corrected author. `bfb2c45` **is** an
ancestor of HEAD. `git log bfb2c45..HEAD -- apps/ packages/ services/
wrangler.toml` returned empty — zero source deltas since Q6G, only
docs/reports commits. `CANDIDATE_SOURCE_COMMIT` = current HEAD
(`ca1f157aa6890e2cecbe6b35aa15239e1649ba6f` at start of this checkpoint),
working tree clean.

The spec's cited `ADR-0055` also does not exist — the repo has only
ADRs 0001–0005 (`docs/adrs/`). Economics were instead verified directly
against the authoritative source: `packages/pricing/src/service-prices.ts`
(embedded pricing, governance-validated) and
`packages/protocol-x402/src/network/preproduction.ts`
(`PRODUCTION_NETWORK = 'eip155:8453'`, hardcoded). Both are source-code
constants, not wrangler vars — invariant across this rebuild since no source
changed.

## Wrangler semantics

- `WRANGLER_VERSION=4.119.0`
- `VERSIONS_UPLOAD_KEEP_VARS_SUPPORTED=YES`
- `VERSIONS_UPLOAD_SECRETS_FILE_SUPPORTED=YES`
- `VERSIONS_UPLOAD_VAR_SUPPORTED=YES`

Per §3, `--keep-vars` was used as defense-in-depth but not relied on alone —
all seven governed vars were passed explicitly via `--var`.

## Pre-upload manifest (independently derived, not copied from the prompt)

| Var | Value | Source |
|---|---|---|
| `PAYMENT_ENVIRONMENT` | `production` | matches production de70bf98 |
| `PRODUCTION_ENABLED` | `true` | matches production |
| `HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` | `true` | matches production |
| `PRODUCTION_CDP_CREDENTIALS_APPROVED` | `true` | matches production |
| `PAID_ROUTES_ENABLED` | `true` | matches production |
| `VERIFY_V2_CDP_ROUTE_ENABLED` | `true` | matches production; required ACTIVE per §5 |
| `WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` | `true` | **diverges from production** (absent there); required ACTIVE per §5 — this is the whole point of the candidate |

`GOVERNED_VAR_MANIFEST_READBACK=PASS`.

Service activation intent (§5): `verify_agent_output.v2/CDP=ACTIVE`,
`web_context_verified.v2/CDP=ACTIVE`, no other governed-service flag set,
no Nevermined flag set → `CANDIDATE_EFFECTIVE_SERVICE_ACTIVATION_MANIFEST=PASS`.

Economics (§6): `network=eip155:8453` (hardcoded constant, confirmed),
`web_context_verified_direct=0.009` USD / `verify_agent_output_standard=0.019`
USD (confirmed in `packages/pricing/src/service-prices.ts`, matching
9000/19000 atomic at 6-decimal USDC), `payTo=SELLER_WALLET_ADDRESS` var
(`0x7f44a2dd237938F18632d4CcA40f4c690295E6E1`, preserved via `--keep-vars`) →
`CANDIDATE_ECONOMICS_PREUPLOAD=PASS`.

## Modal runtime read-back

`modal app list` (read-only): `siteborne-webctx-safe-egress` state=`deployed`.
Unauthenticated `curl` to the deployed endpoint still returns `401` (proxy
auth still enforced). `MODAL_RUNTIME_READY=YES`.

## Secret name manifest

From `730c15f8`'s bindings (read-only, names only):
`MODAL_ENDPOINT_BINDING_NAME=MODAL_WEBCTX_ENDPOINT_URL`,
`MODAL_PROXY_KEY_SECRET_NAME=MODAL_WEBCTX_PROXY_KEY`,
`MODAL_PROXY_SECRET_SECRET_NAME=MODAL_WEBCTX_PROXY_SECRET`. All 9 expected
secret names (6 legacy + 3 Modal) present. `LEGACY_SECRET_NAME_MANIFEST=PASS`.

## Secure secrets file

Created `.dev.vars.q6i-upload-secrets` (matches `.gitignore`'s `.dev.vars.*`
pattern), mode `0600`, containing only the three already-provisioned Modal
values (no rotation, no new token, no export of existing Cloudflare
secrets). Deleted immediately after the upload completed.
`SECRET_VALUE_STDOUT_COUNT=0`, `SECRET_VALUE_GIT_COUNT=0`,
`EXISTING_CLOUDFLARE_SECRET_EXPORT_COUNT=0`.

## Dry-run + bundle proof (before mutation)

`wrangler versions upload --dry-run --outdir <tmp>` with the exact intended
flags. Bindings preview showed all 6 legacy vars + 7 governed vars + 3 Modal
bindings, correctly typed, no errors. Bundle inspection of the dry-run
output confirmed: `ModalSafeEgressClient` present; `SafeSocketHttpClient`
**absent entirely** (0 occurrences — fully tree-shaken, production no longer
references it at all post-Q6G); zero diagnostic-seam markers
(`diagnostic_seam_enabled`, `webctx-remote-diagnostic`, `__diag/health`);
zero secret-literal leakage into the bundle. `PREUPLOAD_SOURCE_BUNDLE_PROOF=PASS`.

## Production containment precheck

`wrangler deployments list` (before upload): single active deployment,
`de70bf98-f304-4d7f-b189-4ae2401041a0 @ 100%`. `wrangler secret list`: 9
names. `pnpm production:preflight`: `PREFLIGHT RESULT: PASS`.
`PRE_REBUILD_PRODUCTION_PREFLIGHT=PASS`.

## The single upload

```
wrangler versions upload
  --keep-vars
  --secrets-file .dev.vars.q6i-upload-secrets
  --var PAYMENT_ENVIRONMENT:production
  --var PRODUCTION_ENABLED:true
  --var HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP:true
  --var PRODUCTION_CDP_CREDENTIALS_APPROVED:true
  --var PAID_ROUTES_ENABLED:true
  --var VERIFY_V2_CDP_ROUTE_ENABLED:true
  --var WEB_CONTEXT_V2_CDP_ROUTE_ENABLED:true
  --message "SUN-1221E5Q6I: corrected E6 candidate (Modal safe-egress + all 7 governed vars)"
```

`UPLOAD_COMMAND_STRUCTURAL_REVIEW=PASS`. Executed exactly once.

**`CORRECTED_E6_CANDIDATE_VERSION_ID = d3d68351-b8a8-4eb0-be74-21d0eba36f57`**

No secret-put command was run after the upload. `POST_UPLOAD_SECRET_MUTATION_COMMANDS=0`.

## Post-upload read-back (authoritative `wrangler versions view --json`)

- `CORRECTED_CANDIDATE_SCRIPT_ETAG = e9cf867e07d6ac5371dd96b52c67820cce87883906bc5e6380ecd2260bbbda76`
  — **identical** to the known-good Q6G source etag reported in Q6HR for
  `de4b9130`. `CORRECTED_CANDIDATE_SOURCE_MATCHES_Q6G=YES`.
- All 7 governed vars present with exact intended values (read back
  independently, not assumed): `GOVERNED_VAR_COUNT_PRESENT=7/7`,
  `GOVERNED_VAR_READBACK=PASS`.
- All 9 secrets present by name: `MODAL_ENDPOINT_CONFIG_PRESENT=YES`,
  `MODAL_PROXY_KEY_SECRET_PRESENT=YES`,
  `MODAL_PROXY_SECRET_SECRET_PRESENT=YES`,
  `EXISTING_REQUIRED_WORKER_SECRETS_PRESERVED=YES`,
  `CDP_WALLET_SECRET_PRESENT=NO`. No secret values were retrieved
  (`SECRET_VALUE_EXPOSURE_ATTEMPTS=0`).
- `CANDIDATE_EFFECTIVE_ACTIVATION_READBACK=PASS`,
  `CANDIDATE_ECONOMICS_READBACK=PASS` (source-invariant, unchanged).

## Deployment containment (after upload)

`wrangler deployments list`: unchanged — still only `de70bf98 @ 100%`.
`CORRECTED_E6_CANDIDATE_IN_ACTIVE_DEPLOYMENT=NO`,
`CORRECTED_E6_CANDIDATE_TRAFFIC=0%`. `730c15f8` and all Q6H intermediates
left untouched (`WORKER_VERSION_DELETE_ATTEMPTS=0`).

## Regression

`TESTS=PASS` (turbo: 16/16 tasks). `WORKER_RUNTIME=PASS` (93/93 scenarios).
`LINT=PASS`. `TYPECHECK`: 2 pre-existing failures in
`tests/live/web-context-first-paid-e2e-local.test.ts`, unchanged from the
established baseline (first noted at Q6D) — not caused by this checkpoint
(zero source files changed). `NEW_Q6I_SECRETS_FINDINGS=0`: `secrets:scan`
now reports 4 findings instead of the previously-known 2, but all 4 resolve
to the *same two* pre-existing findings, each duplicated once under the old
commit SHA and once under the new SHA produced by the earlier git-identity
rewrite (`a755620`/`2e3615b1` and `322852a`/`6f8e6471`, same file, same line,
same date) — a side effect of that rewrite, not a new leak from this
checkpoint.

## Economic zero

`LIVE_402_REQUESTS=0`, `FACILITATOR_VERIFY_CALLS=0`,
`FACILITATOR_SETTLE_CALLS=0`, `SIGN_TYPED_DATA_PAYMENT_CALLS=0`,
`PAYMENT_SIGNATURES_CREATED=0`, `PAID_REQUESTS=0`, `SETTLEMENTS=0`,
`TRANSACTIONS=0`, `REAL_ECONOMIC_EFFECT_USDC=0`.

## Cleanup

`.dev.vars.q6i-upload-secrets` deleted after read-back.
`TEMP_SECRET_FILE_REMOVED=YES`. Modal proxy token was not touched/revoked:
`MODAL_PROXY_TOKEN_REMAINS_PROVISIONED=YES`.

## Eligibility decision

`CORRECTED_E6_CANDIDATE_TECHNICALLY_VALID=YES` — all §20 conditions met.
`SUN1221E6_REAL_PAID_RETRY_ELIGIBLE=YES`,
`E6_ELIGIBILITY_QUALIFIER=CORRECTED_SINGLE_UPLOAD_CANDIDATE_READBACK_PASS`.
`CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE` — E6 itself is not executed by
this checkpoint and requires its own fresh, standalone human authorization
covering the real 402, the EIP-3009 signature, and the paid submission.
