# SUN-1215 Checkpoint U — Verify v2/CDP Production Signing Provisioning, Atomic Candidate Creation, Identity Qualification & Freeze

## Summary

```
SUN1215_PROVISIONING_GATE = PASS

NEW_CANDIDATE_CREATED = YES
NEW_CANDIDATE_VERSION_ID = ab9376a9-0c91-4d6a-91b3-4dc31b6181f6

NEW_CANDIDATE_TRAFFIC_PERCENT = 0

CANDIDATE_SOURCE_IDENTITY = PASS
CANDIDATE_CONFIG_IDENTITY = PASS

PAID_RECEIPT_SIGNING_PRIVATE_KEY_BOUND = YES
PAID_RECEIPT_SIGNING_KEY_ID_BOUND = YES

EXISTING_REQUIRED_SECRETS_PRESERVED = YES

CANDIDATE_ACTIVATION_VARS_PRESENT = 0

PAID_ROUTE_ACTIVATION_EXECUTED = NO

CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC = 100%

NEW_CANDIDATE_READY_FOR_ZERO_TRAFFIC_SMOKE = YES

PAID_ROUTE_ACTIVATION_ELIGIBLE = NO
```

Exactly one new, undeployed Worker version was created, containing the qualified
SUN-1214 runtime code, all existing production secrets preserved by name, and
two new secrets: a freshly generated, dedicated Ed25519 paid-receipt private key
and its key ID. Neither the private key nor any intermediate representation of
it was ever written to a regular file, printed to chat, or left in shell
history. Production remains unchanged at `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`,
100% traffic, all 12 paid routes still 404, zero requests sent to the new
candidate.

## 1. Starting production state

```
START_HEAD = aa5702e43509c69c81285aeb5d6a52a389f1fa44 (full SHA, confirms
             the reported short aa5702e)
WORKING_TREE = CLEAN

CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
CURRENT_PRODUCTION_TRAFFIC = 100%
SUN1215_START_PREFLIGHT = PASS
GET /health = 200, GET /ready = 200, GET /mcp = 405
12/12 paid REST routes = 404
```

## 2. SUN-1214 authority

Verified against current source, not report prose (§3 of the governing
checkpoint). `packages/service-runtime/src/pcc/production-signer.ts` was read
fresh and confirmed:

```
SIGNING_CONFIGURATION_CONTRACT_RESOLVED = YES

private key encoding:        lowercase/uppercase hex string
exact byte length:            32 bytes (64 hex characters)
key-ID pattern:                ^kid_[a-z0-9]{24}$
public-key derivation:         ed.getPublicKeyAsync(privateKey), @noble/ed25519
signature algorithm:           Ed25519
Agent Card key reuse:          NO (confirmed: no AGENT_CARD import anywhere
                                 in this module)
fixture fallback:              NONE (every failure path throws
                                 ProductionSignerConfigurationError)
```

## 3. Pinned Wrangler version and command semantics

```
pnpm exec wrangler --version = 4.119.0
```

`wrangler versions upload --help` confirms `--secrets-file <path>`: "Path to a
file containing secrets to upload with the version (JSON or .env format).
Applies additively with secrets from previous deployments - omitted secrets will
not be deleted." This is the exact atomic, single-operation mechanism the
governing checkpoint required -- `versions upload` alone (no `deploy`, no
`secret put`) creates a version and uploads secrets in one step, without
affecting traffic. Confirmed via the same command's own output on both a dry run
and the real run: "To deploy this version to production traffic use the command
`wrangler versions deploy`" -- explicit confirmation that upload alone never
routes traffic.

`wrangler versions secret --help` was also checked and confirmed as an available
but unnecessary alternative (`versions secret bulk` attaches secrets to an
already-existing version, which would require a secret-only predecessor version
-- explicitly avoided per §8 of the governing checkpoint).

## 4. Key-ID classification

```
KEY_ID_CONFIDENTIALITY_REQUIRED = NO
KEY_ID_STORAGE_MECHANISM = Cloudflare secret (uploaded via the same
  --secrets-file JSON payload as the private key)
```

The current implementation (`verify-agent-output-v2-cdp-composition.ts`'s
`VerifyAgentOutputV2CdpProductionEnv`) defines both fields as plain optional
strings with no var/secret distinction encoded at the type level, and no
`wrangler.toml` `[vars]` entry exists for either. Storing the key ID as a secret
alongside the private key avoids any config/runtime edit this checkpoint --
consistent with §27's evidence-report-only repository-change boundary -- and was
explicitly permitted by §4 of the governing checkpoint ("SUN-1215 may preserve
that design to avoid an unrelated runtime/config refactor").

## 5. Secure key generation

Generated via `@noble/ed25519`'s `utils.randomPrivateKey()` (internally backed
by `crypto.getRandomValues`, the same repository-standard CSPRNG-backed method
`production-signer.ts`'s own doc comments cite) -- never `Math.random`, never
UUID-derived entropy, never a test vector or fixture key. The key ID was
generated from `node:crypto`'s `randomBytes` mapped onto the required `[a-z0-9]`
alphabet, also CSPRNG-backed. Public key derivation used the exact same
`ed.getPublicKeyAsync` call `production-signer.ts` itself uses -- proving format
compatibility before upload, not merely assuming it.

```
LOCAL_CONTRACT_VALIDATION = PASS (key-ID pattern match confirmed, private
  key byte length confirmed, both checked programmatically before any
  handoff to wrangler)
```

## 6. Secret-handling method

The private key never appeared in: chat output, this report, any regular
repository file, shell command arguments (passed to `wrangler` only via
`--secrets-file <path>`, never as an argv value), or shell history beyond the
generating script's own source (which contains no key material -- generation
happens at runtime). Handoff used a mode-0600 named pipe (`mkfifo`) created in
`/private/tmp`, written to in-process by the same script that generated the key,
read once by `wrangler versions upload --secrets-file`, and removed immediately
after in a way that ran regardless of upload success or failure. The plaintext
mechanism was smoke-tested first with throwaway dummy values against `--dry-run`
before any real key material was generated, to prove the pipeline before
exposing real secrets to it.

The one-shot generator/uploader script itself lived only transiently inside
`packages/service-runtime/scripts/` (required for `@noble/ed25519`'s workspace
module resolution -- a bare script outside the pnpm workspace cannot resolve it,
the same limitation this project has hit and worked around in every prior
checkpoint needing a workspace-package import from a standalone script) and was
deleted immediately after the real upload completed, confirmed removed before
any further action.

As defense in depth beyond wrangler's own confirmed "(hidden)" value masking
(verified live, both in the dry-run smoke test and the real upload:
`env.PAID_RECEIPT_SIGNING_PRIVATE_KEY ("(hidden)")`), the script also redacted
any 64-hex-character substring from its own captured stdout before printing --
belt-and-suspenders, not relied upon as the sole protection.

## 7. Candidate creation operation

```bash
wrangler versions upload \
  --name siteborne-utility-edge \
  --message "SUN-1215 verify v2 CDP production composition candidate" \
  --secrets-file <mode-600 FIFO, destroyed immediately after use>
```

Executed exactly once, after explicit human authorization received in chat.
Result: `Uploaded siteborne-utility-edge (3.11 sec)`,
`Worker Version ID: ab9376a9-0c91-4d6a-91b3-4dc31b6181f6`, explicitly not
deployed ("To deploy this version to production traffic use the command
`wrangler versions deploy`").

## 8. Candidate identity

```
NEW_CANDIDATE_VERSION_ID = ab9376a9-0c91-4d6a-91b3-4dc31b6181f6
NEW_CANDIDATE_VERSION_NUMBER = (not separately surfaced by this Wrangler's
  `versions view`; Version ID is the authoritative identifier this
  project has used throughout)
NEW_CANDIDATE_CREATED_AT = 2026-08-23T02:54:46.560Z
NEW_CANDIDATE_MESSAGE = "SUN-1215 verify v2 CDP production composition candidate"

NEW_CANDIDATE_TRAFFIC = 0
NEW_CANDIDATE_IN_ACTIVE_DEPLOYMENT = NO
```

`wrangler versions list` confirmed this version is the newest entry, with no
unexpected additional version created before or after it.

## 9. Binding/secret-name inventory

`wrangler versions view ab9376a9-... --name siteborne-utility-edge` (read-only,
names only, zero values read):

```
Compatibility Date:   2026-08-05
Compatibility Flags:  nodejs_compat

Secrets (6):
  AGENT_CARD_SIGNING_PRIVATE_KEY   (preserved)
  CDP_API_KEY_ID                    (preserved)
  CDP_API_KEY_SECRET                (preserved)
  NVM_API_KEY                       (preserved)
  PAID_RECEIPT_SIGNING_KEY_ID       (NEW)
  PAID_RECEIPT_SIGNING_PRIVATE_KEY  (NEW)

Bindings:
  env.CATALOG (KV), env.EVENTS (Queue), env.JOBS (Queue), env.DB (D1),
  env.BROWSER, env.AI

Vars:
  AGENT_CARD_SIGNING_KEY_ID, ENVIRONMENT=production, LOG_LEVEL=info,
  NVM_ENVIRONMENT=sandbox, PCC_VERSION=1.0.0, SELLER_WALLET_ADDRESS
```

```
EXISTING_REQUIRED_SECRET_NAMES_PRESERVED = YES
NEW_PAID_SIGNING_SECRET_NAMES_PRESENT = YES
```

## 10. Activation-var negative proof

The candidate's bound environment (§9 above, read directly, not assumed)
contains no `PAID_ROUTES_ENABLED`, `PRODUCTION_ENABLED`, `PAYMENT_ENVIRONMENT`,
`PRODUCTION_CDP_CREDENTIALS_APPROVED`, or
`HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP` anywhere in its var or secret list.

```
CANDIDATE_ACTIVATION_VARS_PRESENT = 0
PAID_ACTIVATION_STATE = DISABLED
```

Source-level confirmation: `apps/edge-api/src/index.ts`'s only paid-
route-related import remains `productionServiceExecutorUnavailable` from
`production-paid-services.ts` -- none of SUN-1214's new production composition
modules (`verify-agent-output-v2-cdp-composition.ts`,
`verify-agent-output-v2-production-executor.ts`, `production-signer.ts`) are
imported by `index.ts`.

## 11. Source/bundle/config hashes

```
RUNTIME_CANDIDATE_SHA (git)  = aa5702e43509c69c81285aeb5d6a52a389f1fa44
GIT_TREE_SHA                  = 5b54e1504643567dbc7e7ac84a1fb0eb921a38c7
BUNDLE_SHA256                 = 5d969493edd11f4127643ae5af3adc961f2ffce15a97a726b9c98524ca10844b
WRANGLER_CONFIG_SHA256        = 10328cd55ae007d10c2a775c15a31ab8a7fe7acff12fbe17ecc9f5a3983e0387
LOCKFILE_SHA256                = b95d04c58768f6e047edc5717cc03ccd82865240083767984683eda7eb1d923d
CLOUDFLARE_VERSION_ID          = ab9376a9-0c91-4d6a-91b3-4dc31b6181f6
```

`BUNDLE_SHA256` is byte-identical to a pre-upload dry-run bundle hash taken
before key generation, and to a second, fresh post-upload dry-run bundle hash
taken after the real upload -- both matches confirmed, not assumed. It is also
identical to the bundle hash recorded in every checkpoint since SUN-1206,
confirming SUN-1214's new production composition code, while present in the
repository, is not reachable from `index.ts`'s bundle graph and therefore never
changes the actual deployed runtime bytes.

```
CANDIDATE_SOURCE_IDENTITY = PASS
CANDIDATE_CONFIG_IDENTITY = PASS
CANDIDATE_LOCKFILE_IDENTITY = PASS
```

## 12. Preview containment

```
preview_urls = false (wrangler.toml, confirmed before upload)
PREUPLOAD_PREVIEW_CONTAINMENT = PASS
```

## 13. Current production containment

Verified immediately before and after the upload:

```
GET /health = 200
GET /ready  = 200
GET /mcp    = 405
12/12 paid REST routes = 404
CURRENT_PRODUCTION_VERSION = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce (unchanged)
CURRENT_PRODUCTION_TRAFFIC = 100% (unchanged)

POSTUPLOAD_CURRENT_PRODUCTION_PREFLIGHT = PASS
```

`pnpm production:preflight` now reports 6 secret names present (up from 4) --
expected and correct: `wrangler secret list` reflects the account/Worker-scoped
secret store, not any specific version, so the two newly uploaded secrets appear
immediately even though only the new, undeployed version references them.

```
CANDIDATE_REQUESTS_SENT = 0
```

No request of any kind (ordinary or version-override) was sent to the new
candidate version -- reserved for SUN-1216 as directed.

## 14. Preupload regression/freeze gates (§9 of the governing checkpoint)

Run fresh before candidate creation, all against `HEAD=aa5702e`:

```
pnpm lint (full monorepo)             PASS
pnpm typecheck (full monorepo)         PASS (23/23 tasks)
pnpm test (full monorepo)              PASS (2094 passed, 35 skipped, 0 failed)
pnpm pricing:check                     PASS
pnpm x402:check                        PASS
pnpm verification:check                PASS
pnpm services-runtime:check            PASS
pnpm mcp:check                         PASS
pnpm a2a:check                         PASS
pnpm nevermined:check                  PASS
pnpm contracts:baseline:verify         PASS
pnpm contracts:compat:check            PASS
pnpm contracts:release:verify          PASS
pnpm migrations:verify                 PASS
pnpm test:worker-runtime               PASS (72/72)
fixture-reintroduction mutation proof  PASS (both A and B, tree confirmed
                                         clean afterward)
pnpm production:preflight              PASS
pnpm secrets:scan                      PASS (180-commit history, working
                                         directory, 0 leaks)
```

One documented, pre-existing, unrelated exception: `pnpm format:check` (part of
`pnpm check`) fails on two untouched files
(`docs/reports/SUN-1210-checkpoint-p3...md`, `...p4...md`) -- confirmed via
`git log`/`git diff` against `main` that this drift predates SUN-1214/1215 and
neither branch ever touched either file. Not fixed here, per this checkpoint's
own evidence-report-only repository-change boundary. Every other
functionally-relevant check listed above was run individually and passed.

```
PREUPLOAD_RELEASE_GATE = PASS
```

## 15. Cleanup

```
SECRET_FIFO_REMOVED = YES (confirmed via post-removal `ls` failure)
TEMP_SECRET_FILE_REMOVED = NOT_CREATED (a named pipe was used throughout;
  no regular file ever held the key material)
SECRET_ENV_VARIABLES_UNSET = YES (none were ever set in this shell's
  environment -- the key lived only inside the one Node process that
  generated and piped it)
SECRET_HELPER_PROCESS_TERMINATED = YES (the one-shot script process exited
  naturally on completion; the generator script file itself was deleted
  immediately after)
```

The two newly provisioned Cloudflare secrets
(`PAID_RECEIPT_SIGNING_PRIVATE_KEY`, `PAID_RECEIPT_SIGNING_KEY_ID`) were **not**
deleted or revoked -- they belong to the frozen candidate, per §23 of the
governing checkpoint.

## 16. Secret scans

```
Git history scan (180 commits):  0 leaks
Working-directory scan:           0 leaks
git status --short (post-cleanup): clean
```

An additional structural check searched the entire tracked+untracked working
tree for the generated key ID and public key (both non-secret, recorded only in
this agent's own transient tool output, never written to any file) -- zero
matches, confirming no incidental persistence occurred anywhere.

```
PAID_SIGNING_PRIVATE_KEY_LEAKS = 0
SECRET_LEAKS = 0
```

## 17. Public verification/key-discovery readiness

```
PAID_RECEIPT_PUBLIC_KEY_DISCOVERY_READY = NO
```

No JWKS-equivalent endpoint exists for the new paid-receipt signer's public key
(an explicit non-goal of SUN-1214's approved design). This does **not** block
candidate freeze or a future controlled internal paid E2E qualification
(SITEBORNE's own systems already hold the `KeyRegistry` needed to verify a
receipt it produced itself). It **does** block genuine public paid-route
activation, since an external buyer would have no governed way to independently
verify a receipt's signature. Carried forward as an explicit R1 risk (§18
below), not an R0 for this checkpoint or SUN-1216.

## 18. Mutation accounting

```
WORKER_VERSIONS_CREATED = 1
CANDIDATE_UPLOADS = 1

DEPLOYMENTS = 0
TRAFFIC_SHIFTS = 0

NEW_PRODUCTION_SECRET_VALUES = 2
EXISTING_SECRET_ROTATIONS = 0
SECRET_DELETIONS = 0

PAID_ROUTE_ACTIVATIONS = 0
ACTIVATION_VAR_CHANGES = 0
PREVIEW_CHANGES = 0
BINDING_CHANGES = 0
MIGRATIONS = 0

PRODUCTION_D1_WRITES = 0
PRODUCTION_KV_WRITES = 0
PRODUCTION_R2_WRITES = 0
PRODUCTION_QUEUE_WRITES = 0

PAYMENT_SIGNATURES = 0
SETTLEMENTS = 0
TRANSACTIONS = 0
REAL_ECONOMIC_EFFECTS = 0
LIVE_PROVIDER_CALLS = 0

CANDIDATE_REQUESTS_SENT = 0
```

Matches the governing checkpoint's expected accounting exactly.

## 19. Remaining blockers

```
R0_BLOCKERS_REMAINING = [
  none newly introduced by this checkpoint -- the candidate is code- and
  secret-complete for verify_agent_output.v2/CDP; no route/service
  execution R0 remains for this one service/rail combination
]

R1_RELEASE_RISKS = [
  PAID_RECEIPT_PUBLIC_KEY_DISCOVERY_READY=NO -- no external verifier
    endpoint yet; blocks public paid activation, not candidate freeze or
    internal qualification (see §17),
  the pre-existing, unrelated format:check drift in two SUN-1210 report
    files (see §14) -- cosmetic, no runtime bearing, not fixed here per
    scope discipline,
  full runtime proof of the bound production secret (does the real
    uploaded PAID_RECEIPT_SIGNING_PRIVATE_KEY actually sign correctly when
    the candidate is live) remains unproven -- explicitly deferred to
    SUN-1216's zero-traffic smoke, per §19 of the governing checkpoint
    ("do not retrieve secret values from Cloudflare... full runtime proof
    ... belongs to the subsequent zero-traffic candidate-smoke checkpoint")
]
```

## 20. Next checkpoint

```
SUN-1216 -- New Verify v2/CDP Candidate Zero-Traffic Edge Smoke + Bound
Production-Signer Qualification
```

Scoped per §30 of the governing checkpoint: place this exact candidate
(`ab9376a9-0c91-4d6a-91b3-4dc31b6181f6`) into a deployment at 0%, establish
attribution via version override, prove the bound
`PAID_RECEIPT_SIGNING_PRIVATE_KEY` produces a genuine, verifiable signature
under real production conditions, prove the disabled paid route remains safe,
restore known-good-only afterward. No real settlement. Not combined with
SUN-1215.
