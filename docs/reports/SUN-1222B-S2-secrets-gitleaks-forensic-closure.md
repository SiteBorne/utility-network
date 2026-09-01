# SUN-1222B-S2 — Secrets / Gitleaks forensic closure

Date: 2026-09-01
Starting source authority: `d64511dec924acbefdda8e5d8f471c37640153ba`

## Outcome

The nine findings reported during SUN-1222B are fully classified. All nine are
exact occurrences of public data: four occurrences of Circle's canonical Base
mainnet USDC contract address and five occurrences of two SITEBORNE payment
correlation identifiers. None is a credential, private key, authorization,
payment signature, bearer token, or wallet secret.

```text
TOTAL_ORIGINAL_FINDINGS=9
PUBLIC_NON_SECRET_FINDINGS=9
REAL_SECRET_FINDINGS=0
UNKNOWN_FINDINGS=0
SECRETS_INCIDENT_FOUND=NO
```

The SUN-1222B evidence report was committed after that nine-finding scan and
quoted the same public Base USDC address. Consequently, a scan of the current
`d64511d` history with the prior configuration yields six history records rather
than the five present at the original scan boundary. This is an additional
occurrence of an already-classified public constant, not a tenth original
finding or a new value class.

## Scanner authority before correction

```text
SECRETS_SCAN_COMMAND=
pnpm secrets:scope:verify &&
gitleaks git . --config=.gitleaks.toml --redact --verbose &&
gitleaks dir . --config=.gitleaks.toml --redact --verbose

GITLEAKS_VERSION=8.30.1
GITLEAKS_CONFIG_PATH=.gitleaks.toml
BASELINE_FILE=NONE
GITLEAKSIGNORE_FILE=NONE
SCANS_GIT_HISTORY=YES
SCANS_UNTRACKED_FILES=YES
SCANS_IGNORED_FILES=YES
```

The command uses shell `&&`: a nonzero history finding stops the command before
the direct-filesystem phase. For forensic enumeration the two phases were run
separately with full redaction and JSON output whose `Secret` and `Match` fields
were never printed. At `d64511d`, the committed prior configuration produced six
history records. The raw filesystem phase also duplicated findings through
ignored nested worktrees, inspected the intentionally ignored local `.dev.vars`,
and scanned the synthetic regression file added during this checkpoint. Those
are scan-scope categories, not additional members of the original nine-finding
set.

## Original nine-finding ledger

All fingerprints below are safe scanner metadata. `Current tree` describes the
original SUN-1222B scan boundary; the final row became historical only when the
SUN-1222B report commit was written.

|   # | Rule              | Description / match class         | File and line                                                                      | Commit / fingerprint                                                                               | Classification                  |                               Tracked |                   Historical | Current tree |
| --: | ----------------- | --------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------: | ---------------------------: | -----------: |
|   1 | `generic-api-key` | Base USDC contract assignment     | `docs/reports/SUN-1220O-first-real-paid-e2e.md:159`                                | `6f8e64714d44f8391ca8a7e474a0ac01fe8e12af:...:generic-api-key:159`                                 | `PUBLIC_BLOCKCHAIN_ADDRESS`     |                                   yes |                          yes |          yes |
|   2 | `generic-api-key` | Base USDC contract assignment     | same file/line                                                                     | `322852a78e032f3d06a43ead8102517af2cdecdf:...:generic-api-key:159`                                 | `PUBLIC_BLOCKCHAIN_ADDRESS`     |                                   yes |                          yes |          yes |
|   3 | `generic-api-key` | payment-attempt identifier        | `docs/reports/SUN-1221E2R-settlement-502-forensic-reconciliation.md:30`            | `2e3615b1bc6f699253a8f75e0abcd8f221be0789:...:generic-api-key:30`                                  | `PUBLIC_TRANSACTION_IDENTIFIER` |                                   yes |                          yes |          yes |
|   4 | `generic-api-key` | payment-attempt identifier        | same file/line                                                                     | `a75562084c47fb07fd17a8533eefc5e7650a70fa:...:generic-api-key:30`                                  | `PUBLIC_TRANSACTION_IDENTIFIER` |                                   yes |                          yes |          yes |
|   5 | `generic-api-key` | idempotency/payment identifier    | `docs/reports/SUN-1221E6R-H2B2-first-real-payment-cross-script-architecture.md:48` | `3984aff5d540be382c85e16026c27fdf0d707393:...:generic-api-key:48`                                  | `PUBLIC_TRANSACTION_IDENTIFIER` |                                   yes |                          yes |          yes |
|   6 | `generic-api-key` | Base USDC contract assignment     | `docs/reports/SUN-1220O-first-real-paid-e2e.md:159`                                | `docs/reports/SUN-1220O-first-real-paid-e2e.md:generic-api-key:159`                                | `PUBLIC_BLOCKCHAIN_ADDRESS`     |                                   yes |                          yes |          yes |
|   7 | `generic-api-key` | payment-attempt identifier        | `docs/reports/SUN-1221E2R-settlement-502-forensic-reconciliation.md:30`            | `docs/reports/SUN-1221E2R-settlement-502-forensic-reconciliation.md:generic-api-key:30`            | `PUBLIC_TRANSACTION_IDENTIFIER` |                                   yes |                          yes |          yes |
|   8 | `generic-api-key` | idempotency/payment identifier    | `docs/reports/SUN-1221E6R-H2B2-first-real-payment-cross-script-architecture.md:48` | `docs/reports/SUN-1221E6R-H2B2-first-real-payment-cross-script-architecture.md:generic-api-key:48` | `PUBLIC_TRANSACTION_IDENTIFIER` |                                   yes |                          yes |          yes |
|   9 | `generic-api-key` | quoted Base USDC contract address | `docs/reports/SUN-1222B-agent-card-skill-normalization.md:229`                     | `docs/reports/SUN-1222B-agent-card-skill-normalization.md:generic-api-key:229`                     | `PUBLIC_BLOCKCHAIN_ADDRESS`     | no at scan boundary; yes after commit | no at scan boundary; yes now |          yes |

No entire report, documentation tree, rule, hexadecimal class, entropy class, or
blockchain-like pattern is exempted.

## Public-value proof

### Base USDC

The exact address is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Circle's
official
[USDC contract-address reference](https://developers.circle.com/stablecoins/usdc-contract-addresses)
lists it as the Base mainnet USDC smart-contract address. SITEBORNE
independently asserts the same value as `EXPECTED_ASSET` in both production CDP
composition test authorities:

- `apps/edge-api/src/control-plane/production/verify-agent-output-v2-cdp-composition.domain-metadata.test.ts`
- `apps/edge-api/src/control-plane/production/web-context-v2-cdp-composition.test.ts`

It is therefore the public token contract SITEBORNE intentionally accepts on
`eip155:8453`, not key material, a nonce, or an authorization.

```text
BASE_USDC_FINDINGS=4
BASE_USDC_VALUE_PUBLIC=YES
BASE_USDC_VALUE_CANONICAL=YES
```

### Payment correlation identifiers

The two exact `pay_...` values occur as forensic identifiers used to query and
correlate payment-attempt, idempotency, result, and receipt records. Production
code treats `paymentIdentifier` as a lookup/idempotency identity in
`apps/edge-api/src/control-plane/continuation/idempotency-keys.ts` and the D1
payment-attempt repository. It is not sufficient to authorize or settle a
payment; the EIP-3009 signed authorization is a separate input. Exact-value
classification is therefore `PUBLIC_TRANSACTION_IDENTIFIER`.

## `.dev.vars` hygiene

Only Git metadata was inspected; its contents were never read or printed.

```text
DEV_VARS_IGNORED=YES
DEV_VARS_TRACKED=NO
DEV_VARS_EVER_COMMITTED=NO
DEV_VARS_VALUES_PRINTED=NO
RELATED_TRACKED_TEMPLATE=.dev.vars.example
```

Evidence:

- `git check-ignore -v .dev.vars` resolves to `.gitignore:29`.
- `git ls-files --error-unmatch .dev.vars` exits nonzero.
- `git log --all -- .dev.vars` returns no commits.
- the only related tracked file is `.dev.vars.example`.

The final working-tree scanner intentionally uses Git's tracked plus
non-ignored-untracked set. This is a repository-leak gate rather than a local
credential inventory: ignored local credential stores do not fail it, but a
force-added/tracked `.dev.vars` immediately enters the mirrored scan, and any
committed occurrence is also covered by the all-ref history phase.

## Minimal scanner correction

`.gitleaks.toml` adds only three exact public values: the canonical Base USDC
contract and the two classified payment identifiers. The interrupted draft's
global `.claude/worktrees/` path allowlist was rejected and removed because it
hid a synthetic one-digit-different value in an uncommitted nested worktree. The
repository's pre-existing scope verifier independently rejects all path-wide
Gitleaks allowlists.

`pnpm secrets:scan` now executes:

```text
pnpm secrets:scope:verify &&
gitleaks git . --log-opts=--all --config=.gitleaks.toml --redact --verbose &&
tsx scripts/scan-working-tree-secrets.ts
```

The final phase mirrors `git ls-files --cached --others --exclude-standard` to a
temporary directory and runs Gitleaks there. It scans tracked files and
non-ignored untracked files, excludes ignored nested worktree duplicates and
local credential stores without weakening the history configuration, refuses to
follow symlinks, and always removes the temporary mirror.

```text
FINAL_SCANS_ALL_GIT_REFS=YES
FINAL_SCANS_TRACKED_FILES=YES
FINAL_SCANS_UNTRACKED_NONIGNORED_FILES=YES
FINAL_SCANS_IGNORED_FILES=NO
FINAL_GITLEAKS_PATH_ALLOWLISTS=0
```

## RED, GREEN, negative controls, and mutation proof

Observed RED evidence:

- committed pre-fix configuration against current history: 6 findings;
- original checkpoint boundary: 5 history + 4 current-tree records = 9;
- interrupted path-exclusion regression: 1/3 tests failed because the
  worktree-contained near miss was hidden;
- first corrected end-to-end attempt: 2 findings, both deliberate near-miss
  literals embedded directly in the regression test source.

The fixtures were then constructed at runtime, preserving detector coverage
without planting detector-shaped values in repository source.

Final precision tests:

```text
GITLEAKS_ALLOWLIST_PRECISION_TESTS=3/3 PASS
SECRET_SCAN_SCOPE_REGRESSION_TESTS=6/6 PASS
PUBLIC_EXACT_VALUES_SUPPRESSED=YES
UNKNOWN_BLOCKCHAIN_LIKE_NEAR_MISS_DETECTED=YES
WORKTREE_CONTAINED_NEAR_MISS_DETECTED=YES
SYNTHETIC_PRIVATE_KEY_DETECTED=YES
SYNTHETIC_BEARER_TOKEN_DETECTED=YES
SYNTHETIC_DOCS_SECRET_DETECTED=YES
SYNTHETIC_SOURCE_SECRET_DETECTED=YES
```

Final repository gate:

```text
GIT_HISTORY_COMMITS_SCANNED=638
GIT_HISTORY_FINDINGS=0
WORKING_TREE_FILES_SCANNED=1288
WORKING_TREE_FINDINGS=0
SECRETS_SCAN_GREEN_UNEXPLAINED_FINDINGS=0
```

Mutation proof used the exact committed pre-fix `.gitleaks.toml` from `d64511d`
in a temporary directory: the six current history records returned. The
canonical corrected config immediately returned zero against the same 638
commits. No canonical file was reset or overwritten during this proof.

```text
SECRETS_SCAN_RED_FINDINGS_AT_ORIGINAL_BOUNDARY=9
SECRETS_SCAN_RED_FINDINGS_CURRENT_HISTORY_WITH_PRIOR_CONFIG=6
SECRETS_SCAN_MUTATION_PROOF=PASS
```

## Containment accounting

```text
SECRET_ROTATIONS=0
SECRET_CREATIONS=0
GIT_HISTORY_REWRITES=0
CLOUDFLARE_MUTATIONS=0
DEPLOYMENTS=0
TRAFFIC_SHIFTS=0
PRODUCTION_D1_WRITES=0
LIVE_402_REQUESTS=0
PAYMENT_SIGNATURES=0
SETTLEMENTS=0
TRANSACTIONS=0
REAL_ECONOMIC_EFFECT=0
```
