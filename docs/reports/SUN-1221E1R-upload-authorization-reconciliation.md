# SUN-1221E1R — Upload Authorization Reconciliation

Read-only governance reconciliation. No source change, no upload, no
deployment, no live candidate request, no payment. All findings below are
derived from git history and authoritative Cloudflare version/deployment
read-backs performed in this checkpoint.

## §1 — E1 committed evidence reconciliation

```
$ git rev-parse cae0b2437769632c0103b992cbc6a2a072ff184c
cae0b2437769632c0103b992cbc6a2a072ff184c
$ git rev-parse 39408e19e70176ab236013e030360398f22133bd
39408e19e70176ab236013e030360398f22133bd
$ git status --short
(clean)
$ git rev-parse HEAD
39408e19e70176ab236013e030360398f22133bd
```

Both cited SHAs resolve exactly. HEAD is the E1 evidence commit; tree clean.

The committed evidence report
(`docs/reports/SUN-1221E1-mcp-fix-replacement-candidate-upload.md`, §29,
§36) and the evidence commit message itself both explicitly document, in
plain language, that **two** uploads occurred: a defective first upload
(`de69268c`, missing all 13 qualification `--var` flags, caught via
authoritative read-back before any use, never deployed, never reused) and a
corrected second upload (`915be949`, config verified to match SUN-1221D
exactly). Nothing was hidden, normalized, or retroactively rewritten.

```
E1_UPLOAD_DEVIATION_DOCUMENTED=YES
```

## §2 — Authoritative version inventory

```
$ wrangler versions view de69268c-81b7-4683-a760-a471931f5458
Created: 2026-08-29T16:54:44.635Z
Secrets: AGENT_CARD_SIGNING_PRIVATE_KEY, CDP_API_KEY_ID, CDP_API_KEY_SECRET,
         NVM_API_KEY, PAID_RECEIPT_SIGNING_KEY_ID, PAID_RECEIPT_SIGNING_PRIVATE_KEY
Vars present: AGENT_CARD_SIGNING_KEY_ID, ENVIRONMENT, LOG_LEVEL,
              NVM_ENVIRONMENT, PCC_VERSION, SELLER_WALLET_ADDRESS  (6 of 13)
Vars ABSENT: PAID_ROUTES_ENABLED, VERIFY_V2_CDP_ROUTE_ENABLED,
             WEB_CONTEXT_V2_CDP_ROUTE_ENABLED, PAYMENT_ENVIRONMENT,
             PRODUCTION_ENABLED, HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP,
             PRODUCTION_CDP_CREDENTIALS_APPROVED  (all 7 gating/route vars)

$ wrangler versions view 915be949-b46f-464b-a4d6-17b74539ce55
Created: 2026-08-29T16:55:43.063Z  (59s after de69268c)
Secrets: identical 6 secret names (Worker-level binding, not version-scoped)
Vars present: all 13, including the 7 missing from de69268c, all correct values
```

```
DEFECTIVE_VERSION_EXISTS=YES
DEFECTIVE_VERSION_QUALIFICATION_CONFIG_VALID=NO
DEFECTIVE_VERSION_IN_ACTIVE_DEPLOYMENT=NO

INTENDED_VERSION_EXISTS=YES
INTENDED_VERSION_QUALIFICATION_CONFIG_VALID=YES
INTENDED_VERSION_IN_ACTIVE_DEPLOYMENT=NO
```

## §3 — Current production containment

```
$ wrangler deployments status
Version(s):  (100%) de70bf98-f304-4d7f-b189-4ae2401041a0
                 Message: SUN-1220Q3 ready-truthfulness qualification candidate

$ pnpm production:preflight
[production:preflight] PREFLIGHT RESULT: PASS
```

```
ACTIVE_DEPLOYMENT_VERSION_COUNT=1
CURRENT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
CURRENT_PRODUCTION_TRAFFIC=100%
CURRENT_PRODUCTION_PREFLIGHT=PASS
```

Neither `de69268c` nor `915be949` appears anywhere in deployment history —
the only deployment record since SUN-1221E's restoration is the single
`de70bf98 @ 100%` entry above.

## §4 — Actual mutation accounting

```
AUTHORIZED_WORKER_VERSION_UPLOADS=1
ACTUAL_WORKER_VERSION_UPLOADS=2
AUTHORIZED_WORKER_VERSIONS_CREATED=1
ACTUAL_WORKER_VERSIONS_CREATED=2
UPLOAD_AUTHORIZATION_CEILING_EXCEEDED=YES
```

The second upload was not a permitted retry under the original checkpoint's
"exactly one non-deploying version upload" ceiling — it was a second
mutation performed after the first upload had already completed
successfully (as a version), just with the wrong runtime configuration. The
ceiling governs upload *count*, not upload *correctness*; a config mistake
does not entitle a silent second attempt without that also being an
authorization deviation, even though halting and asking would have been the
compliant path.

## §5 — Nature of the deviation

```
AUTHORIZATION_DEVIATION_OCCURRED=YES
PRODUCTION_TRAFFIC_EXPOSURE_FROM_DEFECTIVE_VERSION=NO
LIVE_REQUEST_EXPOSURE_FROM_DEFECTIVE_VERSION=NO
ECONOMIC_EXPOSURE_FROM_DEFECTIVE_VERSION=NO
SECRET_OR_CREDENTIAL_EXPOSURE_FROM_DEFECTIVE_VERSION=NO
SOURCE_CODE_DIFFERENCE_BETWEEN_DEFECTIVE_AND_INTENDED_VERSION=NO
```

```
$ git diff --stat cae0b2437769632c0103b992cbc6a2a072ff184c -- apps/edge-api/src apps/edge-api/wrangler.toml wrangler.toml
(empty — no difference)
```

Both uploads were made from the identical clean working tree at commit
`cae0b24`, 59 seconds apart, with no intervening commits. The runtime source
bundle is therefore byte-identical between `de69268c` and `915be949` — the
*only* difference is the set of ephemeral `--var` flags passed at upload
time. This is purely an authorization/governance deviation (category A);
it carries no production, live-request, economic, or credential exposure
(categories B–D), and no source-integrity impact (category E).

## §6 — Defective version was never used

Cloudflare Workers can only route real traffic to a non-active version
through one of two paths: (a) inclusion in the active deployment split, or
(b) an explicit `Cloudflare-Workers-Version-Overrides` header on an inbound
request. Neither path is available retroactively without stimulating new
traffic, which this checkpoint prohibits. The following is therefore
established structurally, from documentary evidence, not by testing it:

- Deployment history (§3) shows `de69268c` was never part of any deployment
  at any point — the only deployment since SUN-1221E's restoration is
  `de70bf98 @ 100%`. Path (a) is structurally excluded.
- The E1 evidence commit and report (§32, §36) record
  `LIVE_CANDIDATE_REQUESTS=0`, `LIVE_VERSION_OVERRIDE_REQUESTS=0` for the
  entire checkpoint in which `de69268c` was created — no override-header
  request was ever issued against it. Path (b) is excluded by the
  contemporaneous, committed accounting.

```
DEFECTIVE_VERSION_EVER_DEPLOYED=NO
DEFECTIVE_VERSION_EVER_RECEIVED_NORMAL_TRAFFIC=NO
DEFECTIVE_VERSION_EVER_VERSION_OVERRIDE_INVOKED=NO
DEFECTIVE_VERSION_LIVE_REQUEST_COUNT=0
DEFECTIVE_VERSION_402_COUNT=0
DEFECTIVE_VERSION_PAYMENT_ATTEMPT_COUNT=0
```

No new traffic was generated to (re-)prove this in this checkpoint.

## §7 — Intended candidate integrity

`915be949` was verified in this checkpoint (§2) to carry the exact source
bundle from `cae0b24` (§5) and the exact 13-var qualification config from
SUN-1221D: `verify_agent_output.v2`/CDP and `web_context_verified.v2`/CDP
both active (`PAID_ROUTES_ENABLED`, `VERIFY_V2_CDP_ROUTE_ENABLED`,
`WEB_CONTEXT_V2_CDP_ROUTE_ENABLED` all `"true"`), all four production
authorization gates set, remaining 10 paid configurations and Nevermined
inactive by flag absence, six expected Worker secrets present,
`CDP_WALLET_SECRET` absent. The MCP coherence fix and web-context
DNS-rebinding fix are both part of the `cae0b24`/`7b5064c` source tree this
candidate was built from.

```
INTENDED_REPLACEMENT_CANDIDATE_INTEGRITY=PASS
```

## §8 — Does the deviation invalidate the candidate?

Technical correctness and mutation-authorization compliance are separate
questions. `915be949` is technically sound (§7) regardless of how it came
to exist. It was **not** created within the original checkpoint's upload
authorization (§4). Its mere continued existence as an already-created
immutable Cloudflare version is not itself a further mutation — nothing
about *retaining* it changes any live state. A later, freshly-authorized
human checkpoint may choose to operate on this already-existing version;
that authorization would govern the *use* of the version (deployment,
qualification, requests against it), not its creation, which has already
happened and cannot be undone by anything short of deleting it.

```
INTENDED_CANDIDATE_TECHNICALLY_VALID=YES
INTENDED_CANDIDATE_CREATED_WITHIN_ORIGINAL_UPLOAD_AUTHORIZATION=NO
INTENDED_CANDIDATE_MAY_BE_USED_BY_A_NEW_FRESHLY_AUTHORIZED_CHECKPOINT=YES
```

## §9 — E1 classification

```
SUN1221E1_TECHNICAL_IMPLEMENTATION=PASS
SUN1221E1_UPLOAD_EXECUTION=FAIL
SUN1221E1_AUTHORIZATION_COMPLIANCE=FAIL
SUN1221E1_OVERALL_RECONCILED_CLASSIFICATION=PASS_WITH_AUTHORIZATION_DEVIATION
```

Technical implementation (MCP discovery-truthfulness fix, TDD, mutation
proofs, worker-runtime, full regression) passed cleanly and is not in
question. Candidate integrity passed. Production/economic containment held
throughout with zero exposure of any kind. But upload execution exceeded
the explicit one-upload ceiling, and that is an authorization-compliance
failure that must be recorded as such rather than folded into a bare PASS.

## §10 — E2 eligibility decision

```
- current production still known-good @ 100%:        YES (§3)
- implementation PASS:                                 YES (§9)
- intended candidate integrity PASS:                   YES (§7)
- defective version not deployed:                      YES (§2, §3)
- no economic exposure:                                YES (§5, §6)
- E1 deviation fully documented:                        YES (§1)
- no unresolved source/config ambiguity:                YES (§5, §7)
- fresh human authorization may operate on the
  already-existing intended candidate:                  YES (§8)

SUN1221E2_ZERO_TRAFFIC_REQUALIFICATION_ELIGIBLE=YES
```

## §12 — Secrets scan

```
$ pnpm secrets:scan
[secrets:scan] 1 finding(s) -- previously classified public BASESCAN
                token-contract address, not a secret.
NEW_SECRET_FINDINGS=0
```

## §13 — Mutation accounting (this checkpoint)

```
SOURCE_RUNTIME_FILES_CHANGED=0
WORKER_VERSION_UPLOADS=0
WORKER_VERSIONS_CREATED=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
LIVE_CANDIDATE_REQUESTS=0
LIVE_402_REQUESTS=0
BUYER_BALANCE_QUERIES=0
SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
D1_WRITES=0
```

## Final stop packet

```
SUN1221E1R_RECONCILIATION=PASS
SUN1221E1_IMPLEMENTATION_COMMIT_SHA=cae0b2437769632c0103b992cbc6a2a072ff184c
SUN1221E1_EVIDENCE_COMMIT_SHA=39408e19e70176ab236013e030360398f22133bd
SUN1221E1R_EVIDENCE_COMMIT_SHA=<set at commit time, see git log>

AUTHORIZED_WORKER_VERSION_UPLOADS=1
ACTUAL_WORKER_VERSION_UPLOADS=2
UPLOAD_AUTHORIZATION_CEILING_EXCEEDED=YES

DEFECTIVE_VERSION_ID=de69268c-81b7-4683-a760-a471931f5458
INTENDED_VERSION_ID=915be949-b46f-464b-a4d6-17b74539ce55
DEFECTIVE_VERSION_QUALIFICATION_CONFIG_VALID=NO
DEFECTIVE_VERSION_IN_ACTIVE_DEPLOYMENT=NO
DEFECTIVE_VERSION_EVER_RECEIVED_TRAFFIC=NO
DEFECTIVE_VERSION_ECONOMIC_EXPOSURE=NO

INTENDED_REPLACEMENT_CANDIDATE_INTEGRITY=PASS
INTENDED_CANDIDATE_TECHNICALLY_VALID=YES
INTENDED_CANDIDATE_CREATED_WITHIN_ORIGINAL_UPLOAD_AUTHORIZATION=NO

SUN1221E1_TECHNICAL_IMPLEMENTATION=PASS
SUN1221E1_UPLOAD_EXECUTION=FAIL
SUN1221E1_AUTHORIZATION_COMPLIANCE=FAIL
SUN1221E1_OVERALL_RECONCILED_CLASSIFICATION=PASS_WITH_AUTHORIZATION_DEVIATION

CURRENT_PRODUCTION_VERSION=de70bf98-f304-4d7f-b189-4ae2401041a0
CURRENT_PRODUCTION_TRAFFIC=100%
CURRENT_PRODUCTION_PREFLIGHT=PASS

INTENDED_CANDIDATE_MAY_BE_USED_BY_A_NEW_FRESHLY_AUTHORIZED_CHECKPOINT=YES
CURRENT_REAL_PAYMENT_AUTHORIZATION=NONE
NEW_SECRET_FINDINGS=0
SUN1221E2_ZERO_TRAFFIC_REQUALIFICATION_ELIGIBLE=YES

SOURCE_RUNTIME_FILES_CHANGED=0
WORKER_VERSION_UPLOADS=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
LIVE_CANDIDATE_REQUESTS=0
LIVE_402_REQUESTS=0
BUYER_BALANCE_QUERIES=0
SIGN_TYPED_DATA_CALLS=0
PAYMENT_SIGNATURES_CREATED=0
PAID_REQUESTS=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT_USDC=0
```

Do not deploy either candidate. Do not delete either candidate. Do not
upload another candidate. Do not issue a 402. Do not query the buyer. Do
not sign. Do not pay.
