# SUN-1220P4 — Discovery-Fixed Candidate Live Qualification

Live qualification only. No paid request, no signing, no settlement, no public traffic.

## Evidence chain

```
SOURCE_HEAD_SHA (unchanged throughout)      = a14910ec001afcadcb7d9b329561c786950e5726
CANDIDATE_VERSION_ID                        = 8a1cdfe1-2e68-4dd9-b604-07dc3a666963
CANDIDATE_UPLOAD_EVIDENCE                   = docs/reports/SUN-1220P3-discovery-fixed-candidate-upload.md
KNOWN_GOOD_PRODUCTION_VERSION_ID            = f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
WORKER_ORIGIN                               = https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev
TARGET_PATH                                 = /v2/verify/agent-output
```

## Attempt 1 (this checkpoint, first sub-attempt) — discovery + route isolation

Result: **PASS** (reported to user in chat at the time; not repeated in detail here since
no repository state changed). Temporary `f4f20676@100% + 8a1cdfe1@0%` split deployed,
`/catalog`, `/services/verify_agent_output.v2`, and the agent card were read under the
candidate override and confirmed truthful (`production_enabled: false`,
`protocol_status` reflecting inactive), with route isolation confirmed (only
`verify_agent_output.v2` affected, no other route/service perturbed).

## Attempt 1 (this checkpoint, second sub-attempt) — unpaid 402 challenge, FAILED (non-defect)

A probe body `{"agent_output":"probe","criteria":"probe"}` was sent against the candidate
override. Result: **HTTP 400** (schema validation failure — the request never reached the
payment-required gate; the body was missing `verification_contract`, `candidate_output`,
etc.). This was a probe-construction error, not a candidate defect. Per the user's
restoration trigger ("payment challenge mismatch"), production was restored immediately to
`f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%` and confirmed via read-back before reporting
the failure to the user.

## Attempt 2 (this checkpoint, follow-up) — unpaid 402 challenge, PASSED

Per the user's explicit re-authorization, the request body was derived from committed
repository evidence rather than guessed:

```
$ sed -n '/CANONICAL_REQUEST_BODY = Object.freeze/,/});/p' \
    apps/edge-api/tests/live/first-paid-e2e-local.test.ts
```

```json
{
  "verification_contract": {
    "claims": [{ "claim_id": "total", "predicate": "equals", "expected_value": 42 }],
    "deterministic_requirements": []
  },
  "candidate_output": { "total": 42 },
  "required_schema": {},
  "verification_mode": "standard"
}
```

### Deployment (temporary, 100/0 split)

```
$ pnpm exec wrangler versions deploy \
    f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
    8a1cdfe1-2e68-4dd9-b604-07dc3a666963@0 \
    --message "SUN-1220P4 follow-up: temp 0% qualification of discovery-fixed candidate" --yes

SUCCESS  Deployed siteborne-utility-edge version f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
         at 100% and version 8a1cdfe1-2e68-4dd9-b604-07dc3a666963 at 0% (1.42 sec)
```

Read-back confirmation:

```
$ pnpm exec wrangler deployments status
Version(s):  (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
             (0%)   8a1cdfe1-2e68-4dd9-b604-07dc3a666963
```

### The one authorized request

```
$ curl -sS -i -X POST \
    "https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/v2/verify/agent-output" \
    -H 'Content-Type: application/json' \
    -H 'Cloudflare-Workers-Version-Overrides: siteborne-utility-edge="8a1cdfe1-2e68-4dd9-b604-07dc3a666963"' \
    -d '<CANONICAL_REQUEST_BODY above>'

HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbiI6Mi... (base64, decoded below)
{"error":"payment_required","x402_version":2,"quote_id":"qte_a664eb640589b3d919f3f5b0","requirement_id":"req_b71ca14335d88d1ae9ce3449"}
```

Result: **HTTP 402**, as required. Exactly one live request was sent; no second request
was made.

### Canonical decode

Decoded with the repository's own `decodePaymentRequiredHeaderSafe`
(`packages/protocol-x402/src/codec/headers.ts`), not by hand-parsing:

```json
{
  "ok": true,
  "value": {
    "x402Version": 2,
    "resource": {
      "url": "https://siteborne-utility-edge.siteborneutilitynetwork.workers.dev/v2/verify/agent-output"
    },
    "accepts": [
      {
        "scheme": "exact",
        "network": "eip155:8453",
        "amount": "19000",
        "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "payTo": "0x7f44a2dd237938F18632d4CcA40f4c690295E6E1",
        "maxTimeoutSeconds": 60,
        "extra": { "name": "USD Coin", "version": "2", "quote_id": "qte_a664eb640589b3d919f3f5b0" }
      }
    ],
    "extensions": {
      "payment-identifier": {
        "info": { "required": true },
        "schema": { "...": "..." }
      }
    }
  }
}
```

Findings:
- `extra.name` = `"USD Coin"`, `extra.version` = `"2"` — the EIP-712 domain-metadata fix
  (SUN-1220L root cause) is present and well-formed on this candidate, carrying forward
  correctly alongside the SUN-1220P2 discovery-truthfulness fix.
- `network` = `eip155:8453` (Base mainnet), `asset` = the correct USDC contract, `amount` =
  `19000` (0.019 USDC at 6 decimals) — consistent with the same $0.019 price point used in
  the real paid E2E (SUN-1220O3).
- `payTo` matches the known seller wallet address used throughout.

No `signTypedData`, EIP-3009 authorization, `PaymentPayload`, or `PAYMENT-SIGNATURE` was
constructed. No payment was made.

### Restoration (immediate, regardless of outcome)

```
$ pnpm exec wrangler versions deploy f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce@100 \
    --message "SUN-1220P4 follow-up: restore production after one-shot unpaid 402 qualification" --yes

SUCCESS  Deployed siteborne-utility-edge version f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce at 100% (1.31 sec)
```

Read-back confirmation:

```
$ pnpm exec wrangler deployments status
Version(s):  (100%) f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce
```

Single version, 100%, candidate removed from the active deployment — confirmed.

## Summary

Candidate `8a1cdfe1-2e68-4dd9-b604-07dc3a666963` has now passed all SUN-1220P4
qualification checks, across two sub-checkpoints:

1. Discovery truthfulness under the candidate override — PASS (`production_enabled: false`
   served correctly while gates are off; route isolation confirmed).
2. Unpaid 402 payment challenge under the candidate override — PASS (well-formed payment
   requirements carrying the domain-metadata fix).

No promotion, public canary, or paid request is authorized by this checkpoint. Production
remains at the known-good `f4f20676-bbd0-4717-8e90-9cc2c3c9b2ce @ 100%`. Any further step
(a new bounded public canary, promotion, or a paid E2E against this candidate) requires
fresh, explicit user authorization.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
