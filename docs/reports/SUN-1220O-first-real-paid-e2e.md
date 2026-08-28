# SUN-1220O — First Real Paid E2E (Attempt Log)

## Attempt 1 — CLOSED_PRE_ECONOMIC

Invoked by the human operator via `pnpm first-paid-e2e` under a fresh,
standalone, explicit authorization for exactly one real paid transaction
against candidate `a0055146-d358-40d4-b0af-52eccc56c8ef`.

```json
{"ok":false,"stage":"PRE_CHALLENGE","failure_reason":"expected HTTP 402, got 404","challenge_received":false,"challenge_validated":false,"payment_material_created":false,"paid_request_submitted":false,"http_status":404}
```

```
SUN1220O_ATTEMPT_1                    = CLOSED_PRE_ECONOMIC
ATTEMPT_1_STAGE                       = PRE_CHALLENGE
ATTEMPT_1_HTTP_STATUS                 = 404
ATTEMPT_1_CHALLENGE_RECEIVED          = NO
ATTEMPT_1_PAYMENT_MATERIAL_CREATED    = NO
ATTEMPT_1_PAID_REQUEST_SUBMITTED      = NO
ATTEMPT_1_SETTLEMENT                  = NO
ATTEMPT_1_REAL_ECONOMIC_EFFECT        = 0
ATTEMPT_1_AUTHORIZATION_CONSUMED      = YES
ATTEMPT_1_RETRY_AUTHORIZED            = NO
```

The vitest suite in `first-paid-e2e-local.test.ts` reported 28/28 tests
passed for the always-run unit matrix; the live `describe.skipIf` block ran
once, produced the JSON line above, and exited. No retry occurred.

## Root cause — corrected from the SUN-1220O1 checkpoint's stated premise

The checkpoint prompt that opened SUN-1220O1 asserted the root cause as:

> "The committed SUN-1220J local one-shot client sends its challenge and
> paid submission to the ordinary production URL **without** the
> established Cloudflare candidate-version override."

Independent source inspection (`apps/edge-api/tests/live/first-paid-e2e-local.test.ts`,
committed at `09d41ef`, unchanged since) shows this premise is **false**:
the `Cloudflare-Workers-Version-Overrides` header was already attached to
both the unpaid-challenge request (then line 344) and the paid-submission
request (then line 453), via a module constant `VERSION_OVERRIDE_HEADER_VALUE`.

The actual defect is narrower — a **value-format mismatch**, not a missing
header:

```
# what SUN-1220J sent (pre-fix):
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge=a0055146-d358-40d4-b0af-52eccc56c8ef

# the proven-working format (SUN-1210/1211/1219C/1220N, grepped from every
# report file in docs/reports/ that exercises this header — 8/8 occurrences,
# 0 exceptions):
Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="a0055146-d358-40d4-b0af-52eccc56c8ef"
```

The pre-fix value omitted the double quotes around the version-id token.
Cloudflare's version-override header is parsed as a Structured Field Value
dictionary (RFC 8941): an unquoted value is not a valid `sf-string` member
and is dropped by the parser, so the request fell through to ordinary
100%-traffic routing — landing on known-good production
(`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce`), which correctly returns 404 for
`/v2/verify/agent-output` because paid routes are disabled there. This is
consistent with, and fully explains, the observed `expected HTTP 402, got 404`
without needing to invoke a "header entirely absent" theory.

```
CHECKPOINT_STATED_ROOT_CAUSE_VERIFIED = NO (header was present, not absent)
ACTUAL_ROOT_CAUSE_VERIFIED            = YES (unquoted structured-field value)
```

## Proven override mechanism (§2)

```
VERSION_OVERRIDE_HEADER_NAME        = Cloudflare-Workers-Version-Overrides
VERSION_OVERRIDE_HEADER_VALUE_SHAPE = <script-name>="<version-id>"
VERSION_OVERRIDE_CONSTRUCTION_HELPER = none (no shared TS helper exists anywhere
                                        in the repo; every prior proof — SUN-1210
                                        P/P2/P3/P4, SUN-1211 Q, SUN-1219C,
                                        SUN-1220N — constructed this header value
                                        as a literal curl -H string)
```

Source: `grep -h "Version-Overrides" docs/reports/*.md` — 8 occurrences
across 6 independent checkpoints, 8/8 quoted, 0/8 unquoted.
