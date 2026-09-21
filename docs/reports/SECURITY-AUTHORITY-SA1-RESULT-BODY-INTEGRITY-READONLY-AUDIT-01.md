# SECURITY-AUTHORITY-SA1-RESULT-BODY-INTEGRITY-READONLY-AUDIT-01

Status: `PASS_WITH_FINDINGS` — **Outcome B (partially sufficient)**. Mode:
source-backed, read-only audit. Tests and this report only. No production
behavior, contract, schema, migration, secret, or cloud change.

Follows `REPLAY-CALLER-BINDING-SHADOW-AUDIT-01`,
`SECURITY-AUTHORITY-SA1-RESULT-SHADOW-ENVELOPE-DESIGN-01`, and
`SECURITY-AUTHORITY-SA1-RESULT-CONTENT-DIGEST-DESIGN-01` (`cf45daa`). Every
claim below was re-read from source at `cf45daa`. Where source contradicted a
previous report, source won and the correction is recorded (§11).

## Core question, answered first

> Can SITEBORNE prove, using cryptographic material it already persists today,
> that a result body being released later is exactly the body originally
> committed — without another production write path?

**Yes, for the only production-enabled release path (the durable Workflow), with
two honest limits.**

- `payment_service_link_evidence.buyer_receipt_hash` is `sha256:` of the
  governed canonical form of the **exact object that is persisted as
  `x402_service_results.result_json.body` and released**.
  `verification_receipt_hash` (a second column, also inside the link) is the
  same value. A future read-time check is
  `hashPaymentObject(JSON.parse(result_json).body) === buyer_receipt_hash`. This
  was proven by driving the real Workflow, real production executor and signer,
  real `D1ResultReceiptPersistence` and real `persistLinkEvidence`, and
  comparing against an **independent** canonicalizer + `node:crypto` (test 2).
- **Limit 1 — unkeyed.** The anchor is a bare SHA-256 in a different table. It
  detects drift, corruption, and logic bugs; it cannot resist a party able to
  write both tables. The only asymmetric protection is the Ed25519 `signature`
  inside the body, which covers every other body field.
- **Limit 2 — never checked.** Nothing reads `buyer_receipt_hash` at release
  time. It is written, and compared only against itself on a conflicting
  re-persist.

It does **not** hold for the Nevermined recovery path (class C, not
production-enabled) or for unknown-population legacy rows (class B).

## 0. Result block

```
SECURITY_AUTHORITY_SA1_RESULT_BODY_INTEGRITY_READONLY_AUDIT_01=PASS_WITH_FINDINGS (OUTCOME B)

STARTING_HEAD=cf45daaacef5c942c9b469468b178d4927a826aa
FINAL_LOCAL_HEAD=<the commit that contains this report; a commit cannot embed its own SHA -- see `git log -1` / the checkpoint summary>
WORKING_TREE=clean before this checkpoint (0 status lines); clean after the local commit
BRANCH=metadata-vcm-qualification
CF45DAA_REACHABLE=YES (it is HEAD)
COMMITS_AFTER_CF45DAA=0

RESULT_RELEASE_PATH_COUNT=8 enumerated; 6 production-reachable (P1-P5, P7); P1-P4 and P7 share ONE release function
RESULT_RELEASE_PATHS=workflow_first_caller, workflow_join, replay_duplicate_same, replay_already_consumed, legacy_row_reconstruct, nevermined_recovery, mcp_transport, in_process_test_binding
AUTHORITATIVE_RELEASE_BODY=JSON.parse(x402_service_results.result_json).body, released via c.json(cached.body, cached.status) in reconstructFromJob (x402-service.ts:821-846); in the Workflow path this is the flat signed VerificationReceipt (section 3)

BUYER_RECEIPT_HASH_INPUT=hashPaymentObject(pccResult.pcc) = contentHash(canonicalize(pcc)); pcc is the same object as cachedResult.body
BUYER_RECEIPT_HASH_PERSISTED=payment_service_link_evidence.buyer_receipt_hash (migration 0010, NOT NULL), written in workflow step 6 by persistLinkEvidence, ON CONFLICT DO NOTHING plus a re-read conflict check
BUYER_RECEIPT_HASH_REPRODUCIBLE_AT_READ=YES (Workflow path): hashPaymentObject(released body); proven against an independent canonicalizer

VERIFICATION_RECEIPT_HASH_INPUT=hashPaymentObject(verificationReceipt) where verificationReceipt = pccResult.pcc (workflow line 1155); identical value to buyer_receipt_hash on this path
VERIFICATION_RECEIPT_HASH_PERSISTED=payment_service_link_evidence.verification_receipt_hash AND inside payment_service_link_json, covered by link_hash (migration 0010 NOT NULL)
VERIFICATION_RECEIPT_HASH_REPRODUCIBLE_AT_READ=YES (Workflow path); redundant with buyer_receipt_hash

SERVICE_OUTPUT_HASH_INPUT=contentHash(canonicalize(candidate.output)) = the receipt's own output_hash; hash of the SERVICE output, not of the body
SERVICE_OUTPUT_HASH_RELATION_TO_RELEASED_BODY=appears inside the body only as the signed output_hash field; it is NOT a hash of the released body and the service output itself is not in the body (test 4)

WORKFLOW_BODY_INTEGRITY_STATUS=A
REPLAY_BODY_INTEGRITY_STATUS=A (same row, same reader, same representation as workflow)
CONTINUATION_BODY_INTEGRITY_STATUS=A (join resolves to reconstructFromJob)
NEVERMINED_BODY_INTEGRITY_STATUS=C (not production-enabled; no writer of its drafts exists)
LEGACY_BODY_INTEGRITY_STATUS=B (population UNKNOWN: no production read permitted or performed)
OVERALL_BODY_INTEGRITY_STATUS=B

BODY_MUTABLE_AFTER_RELEVANT_DIGEST=NO for body via repository code (persistReceipt spreads existing and never touches body); YES in principle for any writer of the D1 row
TOCTOU_GAP=YES, bounded: the row is written in step 5 and the anchor in step 6; between them a body is releasable with no anchor
READ_TIME_RECONSTRUCTION_REQUIRED=NO (the body is stored verbatim; no reconstruction)

EXISTING_DIGEST_FORMATS=sha256:<64 lowercase hex> for every persisted receipt/output/link hash; bare 64-hex only for the new unwired subject digest; result_content_digest.v1:sha256:<hex> for the new unwired content digest
READ_CHECK_ADAPTER_REQUIRED=NO for the existing anchor (same function, same format); YES only if compared against the unwired ResultContentDigest, which hashes {content, domain} and is intentionally a different value

PROTO_FINDING_AFFECTS_CANDIDATE_INTEGRITY_ANCHOR=NO for the Workflow body (flat, fixed-key, no attacker-keyed maps); UNKNOWN for legacy/Nevermined bodies that carry a free-form output
PROTO_FINDING_BLOCKS_SHADOW_READ_CHECK=NO
PROTO_FINDING_BLOCKS_FUTURE_ENFORCEMENT=NO for the Workflow path; open for any path whose signed/hashed body embeds free-form JSON

CONTENT_INTEGRITY_PROVES_CALLER_IDENTITY=NO
CONTENT_INTEGRITY_PROVES_RESULT_AUTHORIZATION=NO
CONTENT_INTEGRITY_PROVES_PAYMENT_AUTHORIZATION=NO
CONTENT_INTEGRITY_PROVES_SETTLEMENT_AUTHORITY=NO

NEW_PERSISTED_RESULT_DIGEST_REQUIRED=PARTIAL (NO for every production-enabled path; only if Nevermined recovery is re-enabled or legacy rows must be covered)
READ_TIME_INTEGRITY_CHECK_FEASIBLE=PARTIAL (YES for workflow/replay/join)

RESULT_CONTENT_P2_STATUS=RESOLVED-AS-REDUNDANT for the production Workflow path (an anchor exists; a new persisted digest would be redundant). Residual: never verified at release (P3); Nevermined recovery has no anchor (P2, disabled, downgraded to latent)
RESULT_AUTHORIZATION_P1_STATUS=OPEN, unchanged (release authorized by possession of the request tuple)

NEW_P0_FINDINGS=0
NEW_P1_FINDINGS=0
NEW_P2_FINDINGS=0 security findings (see the separate non-security finding below)
NEW_NON_SECURITY_FINDINGS=1 (NS-1: released 200 body is the flat signed receipt, not the PCC document the wire governance decision assumed, and carries no service output; severity UNRATED pending live confirmation; section 10)
TOTAL_RELEVANT_P0_FINDINGS=0
TOTAL_RELEVANT_P1_FINDINGS=1 (carried)
TOTAL_RELEVANT_P2_FINDINGS=4 (2 carried from the replay audit + R4 replacing the narrowed result-content P2 + R5 canonicalizer, carried); see section 10

CHARACTERIZATION_TESTS=11/11 (apps/edge-api/tests/result-body-integrity-readonly-audit.test.ts)
```

The remaining fields of the result block (wider tests, gates, mutation counts,
review result, next checkpoint) are recorded in §13 after the review and gates
ran.

## 1. State

At start: `HEAD=cf45daaacef5c942c9b469468b178d4927a826aa`, branch
`metadata-vcm-qualification`, `git status` empty, `cf45daa` is HEAD (0 commits
after it). Deployed public source `182bfb5` is an ancestor of HEAD. A diff of
the release-critical files (`paid-continuation-workflow.ts`,
`production-dependencies.ts`, `payment-finalization.ts`, `x402-quotes.ts`,
`packages/verification/src/receipt`, `packages/service-runtime/src/pcc`) between
`182bfb5` and HEAD is **empty**, and both the PCC wire-result commit (`ac642cb`,
2026-09-09) and migration 0010 (`74290db`, 2026-09-11) are ancestors of
`182bfb5`. So this analysis describes the deployed behavior. It is source
analysis; no production system was read.

## 2. Release-path matrix

There is one reader of `x402_service_results` for a 200 release:
`reconstructFromJob` (`x402-service.ts:821`), plus the Nevermined recovery read
(`:888`) and the persistence class itself.

| Path                           | Production enabled                                          | Body source                                                                                                                           | Body persisted at                 | Mutated after initial write                                                                                                       | Reconstructed                                  | Hash available                                                                  | Hash persisted                                    | Hash input                | Checked on read | Reproducible on read |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------- | --------------- | -------------------- |
| **P1** workflow_first_caller   | YES (four CDP `production-*-v2-cdp-route.ts`)               | `pccResult.pcc` = `outcome.result.receipt`                                                                                            | step 5 `persistResult` (`INSERT`) | rewritten by `persistReceipt` (adds `receipt_persisted`, `receipt_id`, `pcc`, `durableEvidence.pcc`); **body unchanged** (test 5) | NO (verbatim JSON)                             | YES                                                                             | `buyer_receipt_hash`, `verification_receipt_hash` | `hashPaymentObject(body)` | **NO**          | YES                  |
| **P2** workflow_join           | YES                                                         | same row via `reconstructFromJob` after `respondFromWorkflowResult('settled')`                                                        | same                              | same                                                                                                                              | NO                                             | same                                                                            | same                                              | same                      | NO              | YES                  |
| **P3** replay_duplicate_same   | YES                                                         | `reconstructFromJob()` (`requireDelivered:true`)                                                                                      | same                              | same                                                                                                                              | NO                                             | same                                                                            | same                                              | same                      | NO              | YES                  |
| **P4** replay_already_consumed | YES                                                         | `reconstructFromJob({requireDelivered:false})`                                                                                        | same                              | same                                                                                                                              | NO                                             | same                                                                            | same                                              | same                      | NO              | YES                  |
| **P5** legacy_row_reconstruct  | YES (record class)                                          | rows written before `ac642cb`: envelope `{service_id,result_class,output,receipt_id,link_id,link_hash}`; before 0010: no evidence row | at original write                 | as above                                                                                                                          | NO                                             | envelope rows: anchor covers the PCC, **not** the envelope body; pre-0010: none | partial/none                                      | n/a                       | NO              | NO for envelope body |
| **P6** nevermined_recovery     | **NO** (§6)                                                 | in-memory `responseBody` built from a draft, then `finalize`d as `{status,body,settleResponse}`                                       | `finalize` (overwrites the draft) | the draft is replaced wholesale                                                                                                   | NO, but the returned object is built, not read | NO (draft hashes are lost by `finalize`)                                        | none (no link-evidence write in this branch)      | n/a                       | NO              | NO                   |
| **P7** mcp_transport           | YES                                                         | calls the same route handler; returns `response.json()`                                                                               | same                              | same                                                                                                                              | NO                                             | same                                                                            | same                                              | same                      | NO              | YES                  |
| **P8** in_process_test_binding | NO (test only; `validatePcc` returns `result.verification`) | test double                                                                                                                           | n/a                               | n/a                                                                                                                               | n/a                                            | n/a                                                                             | n/a                                               | n/a                       | n/a             | n/a                  |

No A2A adapter exists in production source (only comments mention it). P1–P4 and
P7 are proven identical by construction: every 200 goes through
`reconstructFromJob`.

## 3. The exact released representation

```
executeLocalService -> ServiceExecutionResult.receipt = signed.receipt   (VerificationReceipt, flat)
  -> validateExecutorPcc: { valid:true, pcc: outcome.result.receipt }     (production-dependencies.ts:216)
  -> verificationReceipt = pccResult.pcc                                   (workflow :1093)
  -> cachedResult.body = verificationReceipt                               (workflow :1188)
  -> persistResult: results.create(JSON.stringify(cachedResult))           (step 5)
  -> persistReceipt: finalize({...existing, receipt_persisted, receipt_id, pcc, durableEvidence:{...,pcc}})  (step 6)
  -> persistLinkEvidence: buyer_receipt_hash = hashPaymentObject(pccResult.pcc)                              (step 6)
  -> release: c.json(JSON.parse(result_json).body, 200)
```

The body is the **flat signed `VerificationReceipt`**: exactly the keys
`canonicalization_algorithm, completeness, contract_release, decision, evidence_hash, input_hash, issued_at, job_id, limitations, output_hash, pcc_schema_hash, pcc_schema_release, policy_hash, receipt_id, receipt_version, request_id, service_id, service_version, signature, signature_algorithm, signing_key_id, verification_mode, verifier_set_hash`
(probed on the real production executor; asserted by test 3). It has no
`contract`, `pcc_version`, `claims`, `evidence`, `extensions`, and **no service
`output`**. It is signed: `issueReceipt` signs `canonicalize(preimage)` where
the preimage is every field except `receipt_id` and `signature`, and
`receipt_id` is derived from that preimage. So the Ed25519 signature covers the
whole body.

This contradicts the SUN-1222C governance decision, which assumed
`verificationReceipt` was "the real PCC document `verify-and-sign.ts` already
builds". It is not: the PCC document (`signed.document`) is never surfaced by
the service. See NS-1 (§10). It does **not** change the integrity answer: the
hashed object and the released object are the same object.

## 4. Every relevant digest

| NAME                               | PRODUCER                  | INPUT                                  | CANONICALIZER / ALG / FORMAT                                     | PERSISTED                                                 | BEFORE/AFTER FINAL BODY                                        | CONSUMERS                        | IDEMPOTENCY          | INTEGRITY       | AUTHORIZATION    | REPRODUCIBLE FROM RELEASED BODY               |
| ---------------------------------- | ------------------------- | -------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------- | -------------------- | --------------- | ---------------- | --------------------------------------------- |
| `buyer_receipt_hash`               | `persistLinkEvidence`     | `pccResult.pcc` (== body)              | `canonical-json`+`validateJCSNumbers` / SHA-256 / `sha256:<hex>` | `payment_service_link_evidence` col                       | computed from the in-memory object, written AFTER the body row | re-read conflict check only      | YES (conflict guard) | **NO consumer** | NO               | **YES**                                       |
| `verification_receipt_hash`        | workflow line 1155        | `verificationReceipt` (== body)        | same                                                             | column + `payment_service_link_json` (inside `link_hash`) | before step 5                                                  | `verifyPaymentServiceLink`, link | link integrity       | link only       | NO               | **YES**                                       |
| `service_output_hash`              | `issueReceipt`            | `candidate.output`                     | same                                                             | column + link                                             | before                                                         | link                             | –                    | link only       | NO               | NO (hash of the service output, not the body) |
| `output_hash` (PCC/receipt)        | `issueReceipt`            | `candidate.output`                     | same                                                             | inside body (signed)                                      | before                                                         | signature preimage               | –                    | via signature   | NO               | NO (same value as `service_output_hash`)      |
| `pcc_hash`                         | service                   | `signed.outputHash`                    | same                                                             | not persisted                                             | –                                                              | –                                | –                    | –               | NO               | n/a (equals `output_hash`, verified by probe) |
| `link_hash`                        | `buildPaymentServiceLink` | link fields incl. the two hashes above | same                                                             | column                                                    | before                                                         | reconciliation                   | YES                  | link            | NO               | NO (hash of the link)                         |
| payment-binding digest             | replay predicate          | 21 fields                              | same                                                             | `payment_attempts`                                        | before                                                         | replay                           | YES                  | –               | tuple possession | NO                                            |
| `pcc_hash`-like cached-result hash | –                         | –                                      | –                                                                | **none exists**                                           | –                                                              | –                                | –                    | –               | –                | –                                             |

Names are not evidence: `service_output_hash` sounds like a body hash and is
not. `buyer_receipt_hash` and `verification_receipt_hash` are the same value
here and neither is "authoritative" over the other. Recommended primary anchor:
`buyer_receipt_hash` (its own column, guarded by a conflict check);
`verification_receipt_hash` as corroboration inside the link.

## 5. Mutability and TOCTOU

```
BODY_MUTABLE_AFTER_HASH=no via any repository code path; persistReceipt spreads `existing`
FIELDS_MUTATED_AFTER_HASH=none in body; the row gains receipt_persisted, receipt_id, pcc, durableEvidence.pcc
DIGEST_COMPUTED_PRE_FINALIZATION=n/a: the hash is computed from the in-memory object, not from any row
DIGEST_COMPUTED_POST_FINALIZATION=n/a (same reason)
READ_BODY_IDENTICAL_TO_HASHED_BODY=YES (tests 2, 5, 7)
TOCTOU_GAP=YES, bounded (see below)
```

- Steps: `persistResult` (INSERT, step 5) → `persistReceipt` (UPDATE) →
  `persistLinkEvidence` (INSERT of the anchor) → `finalizeSettled`, the latter
  three inside step 6. Between step 5 and the anchor insert a body is stored and
  releasable with **no** anchor. A read-time check must therefore treat a
  missing anchor as `ABSENT`, never as a mismatch (and never as "verified").
- `persistReceipt` writes `{kind:'workflow_receipt',…}` **without**
  `status/body` if `existing` is null. The Workflow always runs `persistResult`
  first, so this is unreachable there; a check must still tolerate a row without
  `body`.
- A digest of a pre-final body is not evidence for a different post-final body;
  none exists here, because the anchor is over the body that is later rewritten
  around, not over the row.

## 6. Nevermined (re-verified from source; not carried from the reviewer)

```
NEVERMINED_PRODUCTION_ENABLED=NO
NEVERMINED_RELEASE_BODY=in-memory responseBody {service_id,result_class,output,receipt_id,link_id,link_hash[,authorized_maximum,actual_amount]}
NEVERMINED_BODY_SIGNED=NO (no signature; the flat receipt is not included)
NEVERMINED_BODY_PERSISTED=YES, as {status,body,settleResponse} via results.finalize (x402-service.ts:1001)
NEVERMINED_EXISTING_BODY_DIGEST=NONE independent of the body
NEVERMINED_DIGEST_INPUT=n/a
NEVERMINED_DIGEST_REPRODUCIBLE_ON_READ=NO
NEVERMINED_RESULT_INTEGRITY_CLASS=C
```

- **Not enabled.** `index.ts` returns 404 for `/v1|/v2/nevermined/*` unless
  `NEVERMINED_ROUTES_ENABLED === 'true'`, and then a 503 stub
  (`productionServiceExecutorUnavailable`). `NEVERMINED_ROUTES_ENABLED` appears
  in no `wrangler*.toml`. The four production route files contain no Nevermined
  reference. `paid-services.ts` (which carries the Nevermined config) is
  imported only by the two test entrypoints. `NVM_ENVIRONMENT="sandbox"`.
- **No writer.** `nevermined_settlement_pending_draft` is never written by
  production code (only the type, a discriminant check, and the recovery read).
  The route comment says the pipeline "no longer writes" that draft. So
  `attemptNeverminedRecovery` can act only on a pre-existing row.
- **Anchor lost.** `finalize` replaces the whole `result_json`. The draft's
  `output_hash` and `receipt_hash` are destroyed, the recovery branch writes no
  `payment_service_link_evidence` row, and the body's `link_hash` cannot be
  recomputed (its `verification_receipt_hash` input is gone). Test 9 pins the
  replacement semantics. "Disabled" is not "irrelevant": if this rail is ever
  re-enabled, it would need its own anchor before any integrity claim.

## 7. Legacy records

| Class (git ordering: `ac642cb` 2026-09-09 precedes migration 0010 / `74290db` 2026-09-11)       | Anchor present             | Recomputable from persisted content | Classification                    |
| ----------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------- | --------------------------------- |
| Before `ac642cb`: envelope body `{service_id,result_class,output,receipt_id,link_id,link_hash}` | none                       | –                                   | `LEGACY_UNBOUND`                  |
| Between `ac642cb` and 0010: flat receipt body, no evidence table                                | none                       | –                                   | `LEGACY_UNBOUND`                  |
| After 0010 (deployed source): flat receipt body                                                 | YES (`buyer_receipt_hash`) | YES                                 | `BOUND` (unchecked)               |
| Nevermined-recovery rows                                                                        | none                       | –                                   | `INSUFFICIENT_INTEGRITY_EVIDENCE` |
| Rows with `receipt_persisted` unset                                                             | body only                  | –                                   | `INSUFFICIENT_INTEGRITY_EVIDENCE` |

The independent review caught an earlier row here ("after 0010 but before
`ac642cb`") that cannot exist, because `ac642cb` is an ancestor of `74290db`.

The population of each class in production is **UNKNOWN** (no production read
was permitted or performed; a census would be a separate read-only checkpoint).
No migration is invented here. Existing envelope vocabulary (`LEGACY_UNBOUND`,
`NOT_APPLICABLE`) fits; `BOUND` is used descriptively only.

## 8. Sufficiency

| Path                  | Class | Why                                                                                                                                     |
| --------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow first caller | **A** | anchor covers the exact released body; deterministic; recomputable; survives the only rewrite; unambiguous; exists for the record class |
| Replay                | **A** | same reader, row, representation                                                                                                        |
| Continuation join     | **A** | resolves to the same reader                                                                                                             |
| Nevermined            | **C** | no anchor survives `finalize`; not production-enabled                                                                                   |
| Legacy                | **B** | depends on record class; population unknown                                                                                             |
| **Overall**           | **B** | the production-enabled path is A; the deficiency is confined to a disabled rail and pre-fix rows                                        |

## 9. Smallest future read-time verification (design only; not implemented)

```
row: x402_service_results(job_id).result_json  --JSON.parse-->  .body
  -> hashPaymentObject(body)            (canonical-json + validateJCSNumbers; SHA-256; "sha256:<hex>")
  -> compare, constant-time, with payment_service_link_evidence.buyer_receipt_hash
     joined via jobs.idempotency_key = payment_identifier -> payment_attempts.id
```

| Case                      | Meaning (semantic only; never authorization)                                |
| ------------------------- | --------------------------------------------------------------------------- |
| anchor absent             | `ABSENT` / `LEGACY_UNBOUND`; includes the step-5→6 window. Never "verified" |
| formats differ            | `INCOMPARABLE` (only a non-`sha256:` prefix; not expected)                  |
| canonicalization throws   | `INCOMPARABLE`; log the code only                                           |
| digest mismatch           | `BOUND_MISMATCH` — an integrity signal, **not** a denial                    |
| body missing / draft kind | `NOT_APPLICABLE`                                                            |

No adapter is needed for the existing anchor. The unwired `ResultContentDigest`
hashes `{content, domain}` and is deliberately a different value (pinned by
"cannot be confused with a payment digest…" in `result-content-digest.test.ts`);
it must not be compared with `buyer_receipt_hash`. The existing anchor is the
right primitive here; the new digest is not needed for the Workflow path.

Constant-time comparison is a hygiene choice, not a security requirement: both
values are non-secret hashes.

## 10. Findings

Integrity is not authority (below) and the severity tally is for security
findings.

**No new P0/P1 security finding. No production behavior change.**

- **R1 (P3, existing, unchanged) — anchor written but never verified at
  release.** `buyer_receipt_hash` has no read-side consumer. Impact is
  detection-only.
- **R2 (P3) — unkeyed anchor in a separate table.** Resists drift, not a writer
  of both tables. The Ed25519 `signature` inside the body is the only asymmetric
  protection.
- **R3 (P3) — anchor lands after the body (step 5→6).** A body is briefly
  releasable without an anchor.
- **R4 (P2, latent) — Nevermined recovery has no surviving anchor.** Disabled,
  and unreachable without a pre-existing draft; recorded so re-enabling it
  forces a design decision.
- **R5 (P2, unchanged) — canonicalizer collapses an own `__proto__` key.** Test
  10 re-proves it. For the flat Workflow body it is unreachable (no
  attacker-keyed maps); it stays open for any body that embeds free-form JSON.
- **NS-1 (non-security; product/contract conformance) — the released 200 body is
  the flat signed receipt and carries no service output.**
  `DurableCachedResult`'s doc, the SUN-1222C decision, and the MCP adapter
  comment all say the body is the full PCC document; source and a probe of the
  real production executor say it is `outcome.result.receipt`. All four services
  set `receipt: signed.receipt` (`agent-verification/service.ts:250`,
  `web-context/service.ts:254`, `document-evidence/service.ts:276`,
  `company-evidence/service.ts:493`); the service output is never persisted in
  the Workflow path (`durableEvidence` holds pcc, receipt, settlement evidence
  and link only), so it cannot be recovered later. The test double
  (`in-process-workflow-binding.ts:174`) returns `result.verification`, which is
  why the acceptance test reports a "fixture-fidelity gap" and moves on. The MCP
  adapter comment claims schema validation of the whole body, but
  `routes/mcp.ts` validates tool definitions only, not outputs. **Severity:**
  the independent reviewer rated it P1 for product/contract conformance (buyers
  pay for output and receive a receipt); I record it as **P1-equivalent,
  non-security, unconfirmed live**. It is not a confidentiality or authorization
  issue. `FIRST-PAID-WEB-DIRECT-REAL-PAYMENT-AUTHORIZATION-01-closure.md:84`
  says the live result carried "a governed receipt body" — consistent with NS-1
  but not a raw capture. Not confirmed live: no production system was read.
  Escalated for a separate checkpoint; not changed here.
- **Coupling (P2, contingent):** the "new persisted digest is redundant"
  conclusion holds **only while the released body is the receipt**. If NS-1 is
  fixed by releasing a PCC document or the service output as the body, then
  `hashPaymentObject(body)` no longer equals `buyer_receipt_hash`, and a digest
  of the new body becomes necessary. Sequence NS-1's fix before any read-time
  check.
- **R6 (P3) — `persistResult` returns `already_written` without comparing the
  existing body** and the Workflow discards the status (`void resultStatus`).
  The anchor conflict guard would catch a differing receipt only when the anchor
  row already exists. No path producing a differing `pcc` was found (step
  outputs are memoized per instance).

**Tally (security).** New P0 = 0, new P1 = 0, new P2 = 0. Relevant totals: P0 =
0; P1 = 1 (tuple-possession authorization, carried); P2 = 4 = two carried from
the replay audit + R4 (which **replaces** the narrowed result-content P2 — that
finding is re-expressed, not closed) + R5 (canonicalizer, carried). P3 items
(R1–R3, R6) and NS-1 are not in the security tally.

## 11. Corrections to earlier reports (source wins)

`SECURITY-AUTHORITY-SA1-RESULT-CONTENT-DIGEST-DESIGN-01` states that the
Workflow body is "the already-signed PCC" and that the content digest may be
redundant. Two corrections:

1. The body is the **flat signed receipt**, not a PCC document (§3, NS-1).
2. "May be redundant" is now proven for the Workflow path (§8), and the design's
   `ResultContentDigest` is **not** the function that reproduces the existing
   anchor.

## 12. Non-interference boundary

The change set is one new test file and this report. `git status` before: empty.
No file under `apps/edge-api/src`, `packages/*/src` (production), `migrations`,
or any `wrangler*.toml` is modified.

## 13. Independent review, gates, and next step

### Independent review (read-only agent, then verified by me)

Result: `PASS_WITH_FINDINGS`; `REVIEW_RECOMMENDS_RUNTIME_CHANGE=NO`. The
reviewer could not refute Outcome B or NS-1 and found no P0/P1 security issue.

| Reviewer claim                                                            | My verification                                                             | Applied         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------- |
| Legacy row "after 0010 but before `ac642cb`" cannot exist                 | `git merge-base --is-ancestor ac642cb 74290db` = yes; 09-09 vs 09-11        | §7 rewritten    |
| Redundancy depends on NS-1 (a body change breaks the anchor)              | follows from `hashPaymentObject(body)` = anchor only while body = receipt   | §10 coupling    |
| `routes/mcp.ts` does not validate outputs                                 | grep: only `validatePrimary: assertValidSiteborneMcpToolDefinitions`        | §10 NS-1        |
| Closure report line 84 is circumstantial live evidence                    | read line 84                                                                | §10 NS-1        |
| Conflict-guard test was a tautology (fake returned what it just captured) | true; the fake now models `ON CONFLICT DO NOTHING`                          | test added      |
| Signature coverage was counted, not verified                              | true; now calls real `verifyServiceReceipt` (genuine valid, forged invalid) | test added      |
| Test 4 / test 6 weak                                                      | true; reduced to independent assertions and labelled as sanity              | tests rewritten |
| `persistResult` `already_written` does not compare bodies                 | read `production-dependencies.ts:273`                                       | R6              |

Remaining test limits, stated rather than hidden: the route handler
(`reconstructFromJob`) is not driven, so "released" is `JSON.parse(row).body`
plus source reading of `x402-service.ts:848`; only `verify_agent_output.v2` runs
the real chain (the other three services share `executeLocalService` and
`signed.receipt` by source reading); the Nevermined finalize test exercises
`finalize` on a fake with a hand-built draft, not `attemptNeverminedRecovery`;
the D1 fakes do not model primary-key uniqueness. Deployed-versus-source is
analysis of `182bfb5` (identical to HEAD for the release-critical files); the
live flag values (e.g. `NEVERMINED_ROUTES_ENABLED` set as a dashboard var) are
not visible to me.

### Gates (observed)

```
CHARACTERIZATION_TESTS=11/11
AFFECTED_WIDER_TESTS=176 passed, 2 skipped, 11 files (paid-continuation-workflow*, workflows/, x402-service-route, nevermined-service-route, lifecycle-model-c); packages/vcm/src/security 160/160 (includes the non-interference gate)
TYPECHECK=edge-api tsc rc=0
ESLINT=rc=0 on the new test
PRETTIER=pass on the test and this report
SECRET_SCAN=working-tree scan OK (1714 files), no leaks
FULL_REPO_SUITE=NOT_RUN
SOURCE_BEHAVIOR_CHANGES=0
PUBLIC_CONTRACT_CHANGES=0
PUBLIC_SECURITY_METADATA_CHANGED=NO
SCHEMA_CHANGES=0
MIGRATIONS=0
WORKER_UPLOADS=0
WORKER_DEPLOYMENT_MUTATIONS=0
PUBLIC_TRAFFIC_MUTATIONS=0
CONTINUATION_HOST_DEPLOYMENTS=0
ALERT_WORKER_DEPLOYMENTS=0
CLOUD_SECRET_MUTATIONS=0
PRODUCTION_D1_WRITES=0
REAL_PAYMENT_ATTEMPTS=0
REVIEW_RESULT=PASS_WITH_FINDINGS
REVIEW_RECOMMENDS_RUNTIME_CHANGE=NO
REPORT_PATH=docs/reports/SECURITY-AUTHORITY-SA1-RESULT-BODY-INTEGRITY-READONLY-AUDIT-01.md
```

### Next step

`NEXT_RECOMMENDED_CHECKPOINT=RESULT-WIRE-BODY-CONFORMANCE-READONLY-AUDIT-01`: a
local, read-only checkpoint that confirms or refutes NS-1 against the real
executors for all four services (and, only if the owner separately authorizes a
read, against one real paid response), and decides what the released body should
be. It must come **before** any shadow read-time integrity check, because the
anchor's meaning depends on the body. The `__proto__` canonicalizer finding
needs its own separate hardening checkpoint.

## 14. Correction (added by RESULT-WIRE-BODY-CONFORMANCE-READONLY-AUDIT-01)

NS-1 is resolved and no longer "UNRATED / not confirmed". The released body is
the flat receipt for all four production executors, and the governed contract is
the full PCC document (SUN-1222C). NS-1 is a runtime body defect with HIGH
product, public- contract, and data-loss severity (not a security P0/P1). The
"no new persisted digest is needed" conclusion above is scoped to the currently
persisted flat body and does not hold if the body becomes the governed PCC
document. Details and the next checkpoint:
`RESULT-WIRE-BODY-CONFORMANCE-READONLY-AUDIT-01.md`.
