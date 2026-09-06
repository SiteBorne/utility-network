# SUN-1222C2-Q1 — company_evidence_graph.v2 real paid qualification attempt

Date: 2026-09-06

Candidate: `efc5a287-d807-4b07-957f-ebbdf471e439` (0% traffic, unchanged)

Production: `db7054c9-76ee-4830-aabe-8a4542261b6a` (100% traffic, unchanged)

## Result

**REJECTED_NO_SETTLEMENT.** The one authorized real paid attempt ran the
*entire* production pipeline for the first time on `company_evidence_graph.v2`
— real 402, real human-signed EIP-3009 authorization (CDP-managed buyer),
real payment verification, real Workflow dispatch, and a **real SEC EDGAR
call** through the real Modal safe-egress executor — but SEC EDGAR itself
returned a policy-blocked response for the requested CIK, the executor
correctly classified this as a `partial` result, and the paid-continuation
Workflow's own quality gate rejected the job **before ever attempting
settlement**. Confirmed by direct dual-RPC on-chain balance readback:
**zero atomic USDC moved.** No retry was performed, per the authorization's
explicit no-retry law.

## 1. What the operator ran

Exactly once, in their own terminal, with `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`/
`CDP_WALLET_SECRET` already set:

```
pnpm company-evidence-first-paid-e2e
```

Reported result:

```json
{"ok":false,"stage":"RESULT_OBSERVED","challenge_received":true,"challenge_validated":true,"payment_material_created":true,"paid_request_submitted":true,"submission_result":"ambiguous","http_status":502}
```

All 14 always-run/live tests in
`apps/edge-api/tests/live/company-evidence-first-paid-e2e-local.test.ts`
passed (13 unit + 1 live), confirming: exactly one unpaid 402, exactly one
signature, exactly one paid POST, no retry, no payment material leaked in
the returned result.

Per the runbook's no-retry law, `http_status: 502` with
`submission_result: "ambiguous"` triggers mandatory read-only
reconciliation before any conclusion — never a second attempt. Everything
below is that reconciliation, built entirely from independent, authoritative
sources (D1, the Workflow's own instance trace, and live chain reads) —
never from the client's own self-report alone.

## 2. Note on the "two 402s"

Gate 12 of the pre-payment investigation (this session, earlier) fetched
one economics-verification 402 directly (`quote_id
qte_bc123faf9c0d1f7ee116d261`) to prove the candidate's live economics
matched the frozen 31200 atomic before any payment material was
constructed. That quote's 60-second validity window expired long before
the operator ran anything — it was never signed, never submitted, and
plays no further role. The one-shot client fetches its **own** fresh 402
atomically inside its single run (mirroring this repository's only-ever-used
pattern from `SUN-1220J`/`SUN-1221E2`), eliminating any hand-off expiry
race. The 402 inside that one run — `quote_id qte_a0a61a26031193c90d46bc62`
— is "the one fresh 402" the authorization covers.

## 3. D1 payment_attempts (authoritative, queried directly)

Exactly one row for `company_evidence_graph.v2`, ever:

```
id:                                3706d9a9-789e-4e07-bab5-7b3174e11f24
payment_identifier:                pay_a750ea6da8ea479fa7660c2cf92a4378
quote_id:                          qte_a0a61a26031193c90d46bc62
requirement_id:                    req_ca141fdf0870c0f95fce9c73
request_input_hash:                sha256:7a3ac15ede58431e15eb97c27af80d1bb9f96a182f70017d1df0d7b18184a6cd
resource_id:                       https://utility.siteborne.net/v2/company/evidence-graph
scheme/network/asset:              exact / eip155:8453 / 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
amount / payee:                    31200 / 0x7f44a2dd237938F18632d4CcA40f4c690295E6E1
lifecycle_stage:                   verified
job_id:                            null (at the payment_attempts row itself; a job WAS created — see below)
settlement_transaction_reference:  null
settlement_outcome_kind:           null
cdp_facilitator_settle_attempt_count:     0
cdp_successful_economic_settlement_count: 0
```

`request_input_hash` matches the canonical body's own precomputed SHA-256
(`sha256:7a3ac15e...`) exactly — the buyer's real signed request was
provably the frozen Apple Inc./CIK 0000320193 body, nothing else. Network,
asset, amount, and payee all match the frozen economics exactly.
`cdp_facilitator_settle_attempt_count=0` is the first, strongest signal:
**settlement was never even attempted.**

## 4. D1 job state trail (authoritative, queried directly)

Job `cdc7b707-cb2c-41c5-a503-360bd95621d8`, `current_state: REJECTED`,
`input_hash` matching the same canonical body hash:

```
RECEIVED            -> VALIDATED           (VALIDATION_PASSED)          05:06:51.798Z
VALIDATED           -> QUOTED              (QUOTE_GENERATED)            05:06:51.850Z
QUOTED              -> PAYMENT_CHALLENGED  (PAYMENT_REQUIRED)           05:06:51.906Z
PAYMENT_CHALLENGED  -> PAYMENT_VERIFIED    (PAYMENT_VERIFIED)           05:06:52.119Z
PAYMENT_VERIFIED    -> LOCKED              (RESOURCE_LOCKED)            05:06:52.218Z
LOCKED              -> ROUTED              (ROUTED_TO_WORKER)           05:06:55.511Z
ROUTED              -> EXECUTING           (EXECUTION_STARTED)          05:06:55.700Z
EXECUTING           -> QUARANTINED         (EXECUTION_FAILED)           05:06:55.927Z
QUARANTINED         -> REJECTED            (QUARANTINE_POLICY)          05:06:56.058Z
```

No `PAYMENT_SETTLED`/settlement-attempt state appears anywhere in this
trail — confirming, independently of the `payment_attempts` row, that
settlement was never reached. `job_attempts`, `x402_service_results`,
`security_events`, and `audit_events` have zero rows for this job — the
detailed executor result lives in the Workflow's own instance trace
(§5), not in D1.

## 5. Workflow instance trace (authoritative, queried directly)

`wrangler workflows instances describe` against
`siteborne-paid-continuation` / `siteborne-wf-4cbc0df301ef220cbff6d219e6f8d6c7e71dc210b2e008ec`:

```
Status:   Completed (the Workflow's own control flow finished cleanly —
          this was not a crash or an infrastructure error)
Start:    9/6/2026, 12:06:54 AM   End: 9/6/2026, 12:06:56 AM   Duration: 1s
Last Successful Step: invoke-executor-1
```

Three steps ran, all succeeded:

1. `open-envelope-1` — decrypted the continuation envelope; output confirms
   the exact `executorInput` (Apple Inc./CIK 0000320193/identity+sec_submissions)
   and `settlementContext` (same network/asset/amount/payee/quote_id/
   requirement_id/payment_identifier as the D1 row above).
2. `check-authorization-expiry-1` — `{"expired":false}`.
3. `invoke-executor-1` — **the real executor ran**. Output (verbatim,
   only the receipt ID cut short by the CLI's own display truncation):

```json
{
  "result": {
    "result_class": "partial",
    "service_id": "company_evidence_graph.v2",
    "service_version": "v2",
    "contract_release": "1.0.0",
    "request_id": "ead60a20-c5f5-486f-a380-04420684f0c0",
    "job_id": "job_3f7625f617f317994a9011a4",
    "input_hash": "sha256:7a3ac15ede58431e15eb97c27af80d1bb9f96a182f70017d1df0d7b18184a6cd",
    "output": {
      "canonical_identity": { "common_name": "Apple Inc.", "resolved_identifiers": { "cik": "0000320193" } },
      "resolved_identifiers": { "cik": "0000320193" },
      "field_groups": {
        "identity": { "status": "complete", "source_count": 0 },
        "sec_submissions": { "status": "unavailable", "source_count": 0 },
        "recent_filings": { "status": "unavailable", "source_count": 0 }
      },
      "limitations": ["sec-edgar company_submissions returned policy_blocked for CIK 0000320193"],
      "source_coverage_summary": { "sec": true, "website": false, "regulatory": false, "repositories": false }
    },
    "output_hash": "sha256:155afaa4e98126bc2d33ea8e03371f297280b4cc8857a1fb14004899d3982d56",
    "pcc_hash": "sha256:155afaa4e98126bc2d33ea8e03371f297280b4cc8857a1fb14004899d3982d56",
    "receipt_id": "rcpt_4c95d..." (truncated by wrangler's own CLI display)
  }
}
```

**No further step ran.** There is no settlement step in this trace at
all — the Workflow's own logic evaluated `result_class: "partial"`,
declined to proceed toward settlement, and completed. This is the
governance/quality gate working exactly as designed: the real executor
made a real, live call to SEC EDGAR for CIK 0000320193's
`company_submissions`, SEC EDGAR's own policy blocked that specific call
(most likely a compliance-header/rate-limit/bot-policy response on
SITEBORNE's Modal safe-egress path — not investigated further, out of
this checkpoint's authorized scope), the executor honestly reported this
as a `partial` result rather than fabricating or hiding the gap, and the
system correctly refused to charge the buyer for an incomplete evidence
graph.

`http_status: 502` in the client's own report is the same, already-reviewed
`executor_rejected` -> 502 `service_execution_failed` mapping in
`x402-service.ts` (traced during this session's pre-payment gates) — a
deliberate, documented response code for exactly this outcome, not an
infrastructure fault.

## 6. Candidate attribution (structural proof, stronger than Ray-ID matching)

No `wrangler tail` was connected during the operator's run (it was
intentionally stopped during the hand-off pause). Attribution here does
not depend on a live tail: production version `db7054c9` has **no**
`COMPANY_EVIDENCE_GRAPH_V2_CDP_ROUTE_ENABLED` var at all (confirmed via a
fresh `wrangler versions view` readback, zero matches) — its route handler
`return c.notFound()`s unconditionally for this path. Since the real
request in fact reached a 402, a stored quote, a job, and a completed
Workflow invocation, it is structurally impossible for production to have
served it. Only the candidate has this flag set. `PAID_REQUEST_HANDLED_BY_CANDIDATE=YES`.

## 7. On-chain settlement proof (dual-RPC, before and after)

| | Before (session start) | After this attempt |
|---|---|---|
| Buyer `0x516F...ecB99` | 79727 atomic (confirmed dual-RPC) | **79727 atomic** (confirmed dual-RPC: `mainnet.base.org` + `base.publicnode.com`, identical) |
| Seller `0x7f44...E6E1` | 28000 atomic (confirmed dual-RPC) | **28000 atomic** (confirmed dual-RPC, identical) |

Zero atomic USDC moved. `SETTLEMENT_OCCURRED=NO`. `USDC_TRANSFERRED_ATOMIC=0`.

## 8. Deployment/repo containment

`wrangler deployments list` immediately after: unchanged —
`db7054c9`@100% / `efc5a287`@0%, same deployment id as before this
checkpoint began. `git status`: clean. Zero Cloudflare mutations, zero
D1 migrations, zero secret/var changes, zero traffic changes during this
checkpoint's real-payment phase.

## 9. Absolute economic guardrail

```
REAL_402_REQUESTS_TOWARD_PAYMENT=1 (inside the one-shot client's own atomic run)
EIP3009_AUTHORIZATIONS_CREATED=1
HUMAN_SIGNING_ACTIONS=1 (operator-run CDP signTypedData, exactly once)
PAID_POSTS=1
SETTLEMENT_ATTEMPTS=0
SETTLEMENTS_SUCCEEDED=0
USDC_TRANSFERRED_ATOMIC=0
RETRIES=0
```

## 10. Verdict

```
SUN1222C2_Q1_COMPANY_EVIDENCE_GRAPH=REJECTED_NO_SETTLEMENT
PAYMENT_VERIFIED=YES
EXECUTOR_INVOKED=YES (real SEC EDGAR call, real Modal safe-egress path)
EXECUTOR_RESULT_CLASS=partial
REJECTION_CAUSE=sec-edgar company_submissions policy_blocked for CIK 0000320193
SETTLEMENT_ATTEMPTED=NO
SETTLEMENT_OCCURRED=NO
BUYER_FUNDS_AT_RISK=NO (balance unchanged, confirmed dual-RPC)
CANDIDATE_ATTRIBUTION=STRUCTURALLY_PROVEN (production lacks the route flag entirely)
RETRY_PERFORMED=NO (per the authorization's own no-retry law)
```

This attempt genuinely, live-proved the entire real production pipeline
for `company_evidence_graph.v2` for the first time — 402, human signing,
payment verification, Workflow dispatch, and a real external SEC EDGAR
call — end to end, with the buyer correctly protected from being charged
for a degraded result. It did not produce a completed, settled purchase.

Per this checkpoint's own terms, **no retry was performed and none is
authorized by this checkpoint.** A future real attempt at
`company_evidence_graph.v2` — whether with the same CIK after
investigating the SEC EDGAR policy-block cause, or a different company —
requires its own fresh, standalone, first-person authorization, the same
as this one did. Q2 (`web_context_verified.v2`), Q3
(`document_evidence_json.v2`), and Q4 (`verify_agent_output.v2`) remain
not started; each still requires its own fresh authorization per the C2
coordinator's own standing rule.

```
NEXT_REQUIRED_CHECKPOINT=SUN-1222C2-Q1-RETRY (if desired, after a fresh
  authorization and, ideally, an out-of-band investigation into the
  SEC EDGAR policy-block cause) OR SUN-1222C2-Q2-WEB-CONTEXT-VERIFIED
  (if the human chooses to move on to the next service instead)
```

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
