# SUN-1222C-R3 — Remaining Three-Service Commercial Freeze + Document Buyer-Ingress Reconciliation + Four-Service Candidate Freeze

Repo-only checkpoint. Zero deployment, zero Cloudflare mutation, zero production
D1 mutation, zero secret creation/rotation, zero Modal credential creation, zero
R2 mutation, zero payment material, zero signing, zero paid POST, zero
settlement, zero economic transaction.

## 0. Reconciled state

- `R3_START_HEAD` = `36e6cae` (SUN-1222B-S3 company price freeze), working tree
  clean.
- `R3_END_HEAD` = `c81b737` (this checkpoint's price-freeze commit; this
  evidence report is a follow-up commit on top of it).
- `COMPANY_PRICE_FREEZE_COMMIT_REACHABLE` = YES.

## 1. Company price is protected

`company_evidence_graph.v2` = **0.0312 USDC / 31200 atomic** (unchanged from
36e6cae). `company_evidence_graph.v1` = **0.039 USDC / 39000 atomic**
(unchanged). This checkpoint made zero edits to the company pricing key or its
call sites. `COMPANY_V1_PRICE_UNCHANGED=YES`,
`COMPANY_PRICE_GOVERNANCE_CAP_RESPECTED=YES`.

## 2. Document buyer-ingress — reconciliation, not a rebuild

The runbook's own §4-20 assumed buyer ingress was incomplete. **It is not.**
Current source (confirmed at this checkpoint's start) already has:

- `POST /v2/artifacts/documents`
  (`apps/edge-api/src/control-plane/routes/document-artifact-upload-route.ts`,
  mounted at `index.ts:221`), implemented in SUN-1222B-S3-R2 (`b3878f5`).
- Content-addressed storage in the private `siteborne-artifacts` R2 bucket
  (`document-upload.ts`): server-generated opaque `upload_id` (UUIDv4), SHA-256
  content addressing, magic-byte MIME validation, streaming byte-limit
  enforcement, TTL/expiry (enforced at read-time in the production executor,
  `document-evidence-json-v2-production-executor.ts:193-194`), race-safe
  deduplication, path/key safety (server-generated keys only, caller filename
  never used), fail-closed on missing R2/config bindings.
- The real-app reachability defect (a global `Content-Type: application/json`
  middleware silently blocking document bytes before the route ever received
  them) was found and fixed in SUN-1222C-1-REMEDIATION (`2b0ab01`/`01600ff`),
  proved via a real-app RED→GREEN regression test, not an isolated-route test.
- A full threat-model security audit (SUN-1222C-R2, evidence commit `81200de`)
  found **zero exploitable defects** across authorization/capability binding,
  object isolation, path safety, content-hash integrity, MIME validation, byte
  limits, IDOR/enumeration resistance, TTL enforcement, concurrency, fail-closed
  behavior, and SSRF — 48 passing tests, zero code changes required.
- Live proof: a real R2 round-trip through the actual deployed candidate app
  (upload → SHA-256 readback match → cleanup) succeeded (SUN-1222C-1, HTTP 201).

`DOCUMENT_EXECUTOR_REAL=YES`,
`DOCUMENT_EXTERNAL_BUYER_INGRESS_CURRENTLY_COMPLETE=YES`. No new buyer-ingress
implementation was performed — re-implementing already-audited,
already-live-proven code would have been wasted, risky work. `document_url`
remains correctly unimplemented and undeclared as a supported input mode
(fail-closed, truthful discovery, unchanged).

Two residual **non-blocking** recommendations carried forward unchanged from
SUN-1222C-R2 (not fixed here, not silently marked resolved): no scheduled
physical R2/D1 cleanup (expiry enforced at read-time only), no rate limit on the
free unauthenticated upload endpoint.

## 3. Document external provisioning — inherited facts

- `DOCUMENT_MODAL_WORKER_LIVE_PROVEN=YES` (real authenticated PDF processing
  proven in SUN-1222C-1: correct extracted text, correct SHA-256, correct page
  classification, valid schema; unauthenticated request correctly 401).
- `DOCUMENT_R2_BUCKET_EXISTS_HISTORICALLY=YES` (`siteborne-artifacts`, private,
  round-trip proven, test object cleaned up).
- The dedicated Modal proxy-auth credential minted for that one-time
  qualification was staged only in a chmod-600 scratch file and securely wiped
  after use, per its own evidence report. This checkpoint did **not** attempt to
  recover or verify that credential's current existence (`wrangler secret list`
  shows secret _names_ only, never values, and was not re-run here since no live
  deployment is being qualified this checkpoint) — carrying forward:
  `DOCUMENT_MODAL_PROXY_CREDENTIAL_ACCOUNT_OBJECT_EXISTS=UNPROVEN`,
  `DOCUMENT_MODAL_PROXY_SECRET_RECOVERABLE_FROM_APPROVED_SOURCE=UNPROVEN`,
  `DOCUMENT_LIVE_SECRET_PROVISIONING_REQUIRED=YES`. No credential was created
  this checkpoint.

## 4. Fresh market research (light-touch, given checkpoint scope)

Live-fetched Google Cloud Document AI's current public pricing page
(cloud.google.com/document-ai/pricing): Enterprise OCR runs **$0.0015/page** at
volume, Layout Parser **~$0.01/page**, Form Parser **$0.03/page** (commodity
raw-extraction tiers). SITEBORNE's document service performs materially more
than raw OCR — structured evidence JSON, SHA-256 content binding, PCC/receipt
issuance, x402 settlement — so pricing was deliberately kept well above raw-OCR
commodity rates rather than racing to match them, consistent with the runbook's
own instruction (§22).

For `web_context_verified.v2` and `verify_agent_output.v2`, this checkpoint used
the runbook's own stated hypotheses (0.008 and 0.017 respectively) as the frozen
prices — both comfortably inside the 20% governance cap (11.1% and 10.5%
reductions respectively) rather than the maximum allowed 20%, which is itself a
conservative, margin-protective choice consistent with the company precedent's
explicit 20%-cap discipline.

## 5. Variable cost / margin estimate

No dedicated per-request cost-instrumentation module exists in the repo yet, so
this checkpoint used conservative, provider-pricing-grounded estimates
(Cloudflare Browser Rendering / safe-egress bandwidth for web-context; Modal
CPU/GPU compute-time for document tiers; a bounded LLM verification call for
verify-agent-output) rather than fabricated precision:

| Service                            | Frozen price | Est. variable cost | Est. margin |
| ---------------------------------- | ------------ | ------------------ | ----------- |
| `web_context_verified.v2`          | $0.008       | ~$0.002            | ~75%        |
| `document_evidence_json.v2` native | $0.0098      | ~$0.0015           | ~85%        |
| `document_evidence_json.v2` ocr    | $0.0156      | ~$0.005            | ~68%        |
| `document_evidence_json.v2` table  | $0.0238      | ~$0.006            | ~75%        |
| `verify_agent_output.v2`           | $0.017       | ~$0.005            | ~71%        |

All comfortably clear `governance/RISK_LIMITS.yaml`'s
`minimum_accepted_margin: 0.60` floor (the repo's actual policy — stricter than
the runbook's suggested 55%, and the one honored here). These are estimates, not
audited actuals; a dedicated cost-instrumentation pass is recommended as future
work, not fabricated here.

## 6. Final frozen price card (this checkpoint)

| Pricing key                        | USD    | Atomic | Change from v1      | Within 20% cap |
| ---------------------------------- | ------ | ------ | ------------------- | -------------- |
| `web_context_verified_direct_v2`   | 0.008  | 8000   | -11.1%              | YES            |
| `document_evidence_json_native_v2` | 0.0098 | 9800   | -18.3%              | YES            |
| `document_evidence_json_ocr_v2`    | 0.0156 | 15600  | -17.9%              | YES            |
| `document_evidence_json_table_v2`  | 0.0238 | 23800  | -17.9%              | YES            |
| `document_evidence_json_max_job`   | 0.19   | 190000 | unchanged (ceiling) | n/a            |
| `verify_agent_output_standard_v2`  | 0.017  | 17000  | -10.5%              | YES            |

`COMPANY_V1_PRICE_UNCHANGED=YES`, `DOCUMENT_V1_PRICE_UNCHANGED=YES`,
`WEBCTX_V1_PRICE_UNCHANGED=YES`, `VERIFY_V1_PRICE_UNCHANGED=YES` — independently
re-confirmed against the Nevermined `declarations.test.ts` suite, which now
explicitly gates document's `actual_tiers_atomic` on `.v2` (a genuine RED was
caught and fixed mid-implementation: the original shared, non-version-gated tier
resolver silently changed v1's declared tier prices too).

## 7. Propagation / single source of truth

Traced and updated every cross-cutting surface for the three services (company
already done in 36e6cae):

- `governance/RISK_LIMITS.yaml` / `packages/pricing/src/service-prices.ts` — the
  one canonical source, both files agree (validated by
  `scripts/validate-governance.ts`-style embedded-sync test).
- Real v2-only production composition files
  (`web-context-v2-cdp-composition.ts`,
  `verify-agent-output-v2-cdp-composition.ts`,
  `packages/pricing/src/document-usage.ts`'s tier resolver) — confirmed these
  are the **sole** real production paths for all three services (no v1
  production composition file exists for any of them under
  `apps/edge-api/src/control-plane/production/`), so no risk of a shared-key
  regression the way company's first attempt hit.
- `packages/protocol-mcp/src/server.ts` (`EXACT_PRICING_KEYS`) — MCP tool quote
  metadata.
- `packages/protocol-x402/src/bazaar/discovery.ts` (`BAZAAR_PAYMENT_POLICY`) and
  `registry-source.ts` (new `withGovernedRegistryPrice` runtime projections,
  mirroring company's established non-mutating pattern rather than editing the
  frozen registry contract JSON directly).
- `packages/protocol-nevermined/src/declarations.ts` (new
  `V2_PRICING_KEY_OVERRIDES` map; version-gated `actual_tiers_atomic`).

`ALL_FOUR_PRICE_SINGLE_SOURCE_OF_TRUTH=YES`.

## 8. Price-governance regression

`packages/pricing/src/index.ts`'s `validateAtomicPriceChange` (introduced in
36e6cae) is generic — reused, not reimplemented, for these three services'
verification. All four v2 price changes verified within the 20% cap: company
-20.0% (exact boundary), web-context -11.1%, document native -18.3% (largest of
the three, still under cap), document ocr/table -17.9%, verify -10.5%.
`ALL_PRICE_CHANGES_GOVERNANCE_VALID=YES`.

## 9. MCP packaged-install regression — protected

Re-ran `pnpm mcp:check`, including `pack:verify`'s offline packaged-install
proof (the ENOENT-on-missing-`governance/`-directory regression found and fixed
during the company checkpoint). Still PASS: `MCP_OFFLINE_PACKAGED_INSTALL=PASS`.

## 10. Full repository gate

| Gate                            | Result                                                                      |
| ------------------------------- | --------------------------------------------------------------------------- |
| typecheck                       | PASS (23/23 tasks)                                                          |
| build                           | PASS (12/12 tasks)                                                          |
| lint                            | PASS (16/16 tasks)                                                          |
| tests                           | **2785 passed**, 77 skipped, 0 failed (249 files)                           |
| protocol-x402 (`x402:check`)    | PASS — all 22 spec-baseline scenarios present                               |
| protocol-mcp (`mcp:check`)      | PASS — 6 tools, offline packaged install verified                           |
| protocol-a2a (`a2a:check`)      | PASS — 2/2                                                                  |
| Nevermined (package test suite) | PASS — 243/243 (all 21 files)                                               |
| secrets scan                    | clean — 676 commits, working tree (1335 files) clean                        |
| production:preflight            | PASS — bindings/vars/secret-names/preview-URL/12-route-fail-closed all PASS |
| wrangler dry-run                | PASS — 6423.06 KiB / 1054.85 KiB gzip, no upload                            |
| format (touched files)          | PASS — 3 files needed `prettier --write`, now clean                         |

11 pre-existing test failures were found and fixed during this checkpoint —
every one was a hardcoded literal expecting the _old_ shared v1/v2 price,
exactly the genuine "old price fails, new price passes" mutation-proof pattern
this checkpoint was required to produce, not a regression:

- `packages/pricing/src/document-usage.test.ts` (4 tests: 3 single-page fixtures
  - the ten-OCR-page cap test, restructured to 13 pages since 10×15600 no longer
    lands exactly on the unchanged 190000 ceiling).
- `packages/protocol-x402/src/pricing/document-usage.test.ts` (3 tests, same
  re-export module).
- `apps/edge-api/.../verify-agent-output-v2-cdp-composition.domain-metadata.test.ts`
  (1), `.../verify-agent-output-v2-cdp-composition.test.ts` (1),
  `.../web-context-v2-cdp-composition.test.ts` (1) — hardcoded amount/pricingKey
  literals in real-production-pipeline tests.
- `packages/protocol-nevermined/src/document-dynamic-plan-validator.test.ts` (1)
  and `fixtures/declarations-baseline.json` (fixture regenerated) — the two
  Nevermined surfaces exercising the new prices.

Crypto/JWS and OSV supply-chain gates were **not** re-run in full this
checkpoint — this checkpoint touched only pricing/governance surfaces (no
crypto, signing, MCP transport, or dependency changes), and both were
independently, comprehensively verified in the immediately preceding
SUN-1222B-S3-CONTINUE checkpoint (OSV-Scanner clean per the SUN-1000 criterion;
Trivy environment-blocked by a DB-download timeout, not a repo defect —
unresolved, documented, not a new finding here). `CRYPTO_JWS_RELEASE_GATE` and
`SUPPLY_CHAIN_RELEASE_GATE` are therefore carried forward as **PASS (unchanged,
not re-verified this checkpoint)** rather than re-stated as freshly PASS.

## 11. Four-service matrix (post-freeze)

| Service                     | Price key                                                                                    | USD                  | Atomic              | Real executor | Fixture reachable in prod | Discovery coherent |
| --------------------------- | -------------------------------------------------------------------------------------------- | -------------------- | ------------------- | ------------- | ------------------------- | ------------------ |
| `company_evidence_graph.v2` | `company_evidence_graph_v2`                                                                  | 0.0312               | 31200               | YES           | NO                        | YES                |
| `web_context_verified.v2`   | `web_context_verified_direct_v2`                                                             | 0.008                | 8000                | YES           | NO                        | YES                |
| `document_evidence_json.v2` | `document_evidence_json_native_v2` (settlement) / `document_evidence_json_max_job` (ceiling) | 0.0098–0.0238 / 0.19 | 9800–23800 / 190000 | YES           | NO                        | YES                |
| `verify_agent_output.v2`    | `verify_agent_output_standard_v2`                                                            | 0.017                | 17000               | YES           | NO                        | YES                |

`SERVICE_TOOL_MATRIX_V2_EXACT=PASS` (unchanged from prior checkpoints — no MCP
tool-name/service-ID mapping was touched this checkpoint).
`ALL_FOUR_X402_FAIL_CLOSED=YES` (unchanged mechanism, only the amounts moved).

## 12. Settlement ownership / post-settlement safety

Unchanged this checkpoint (no settlement-path source was touched):
`PUBLIC_API_SETTLE_CALLSITES=0`, `DEDICATED_WORKFLOW_SETTLE_CALLSITES=1`,
`TOTAL_PRODUCTION_SETTLE_CALLSITES=1`, `NO_BLIND_SETTLEMENT_RETRY=YES`,
`ALREADY_SETTLED_RESETTLEMENT_PATHS=0`, `POST_SETTLEMENT_FAIL_CLOSED=PASS`.

## 13. Fresh buyer balance & funding

Fresh dual-RPC read (mainnet.base.org + base.publicnode.com, agreeing):
`QUALIFICATION_BUYER_BALANCE_ATOMIC=79727` (unchanged since first observed).

| Service                                                      | Qualification amount (atomic) |
| ------------------------------------------------------------ | ----------------------------- |
| `company_evidence_graph.v2`                                  | 31200                         |
| `web_context_verified.v2`                                    | 8000                          |
| `document_evidence_json.v2` (smallest valid: native, 1 page) | 9800                          |
| `verify_agent_output.v2`                                     | 17000                         |
| **Total**                                                    | **66000**                     |

`FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=66000`,
`QUALIFICATION_HEADROOM_ATOMIC=13727`, `ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0`.
(Document's separate 190000-atomic Permit2 _allowance_ approval is a one-time
on-chain authorization action, not an additional balance requirement — the
buyer's USDC balance only needs to cover what's actually pulled at settlement.)

## 14. Immutable candidate manifest (frozen, not deployed)

- `CANDIDATE_SOURCE_HEAD` = `c81b737` (this checkpoint's price-freeze commit).
- `CANDIDATE_COMMITS` (since the last uploaded candidate, `3a74686d` @
  `01600ff`): `82de4de`, `21b2c74`, `c9672ac`, `36e6cae`, `c81b737` — R3B's
  mainnet client (dead code, unreachable from the Worker bundle, per
  SUN-1222C-EQ's proof), the company E2E harness (dead code, same reason), and
  the four services' price freezes (release-relevant).
- `CANDIDATE_PUBLIC_BEHAVIOR_CHANGES`: none beyond the four services' displayed/
  charged prices.
- `CANDIDATE_ECONOMIC_CHANGES`: `company_evidence_graph.v2` 39000→31200 (already
  live in the existing 0%-traffic candidate `3a74686d`);
  `web_context_verified.v2` 9000→8000; `document_evidence_json.v2`
  native/ocr/table 12000/19000/29000→ 9800/15600/23800 (max_job ceiling 190000
  unchanged); `verify_agent_output.v2` 19000→17000. v1 prices unchanged for all
  four services.
- `CANDIDATE_NEW_ROUTES`: none (buyer-ingress route already existed
  pre-checkpoint).
- `CANDIDATE_SECRET_NAMES_REQUIRED`: `MODAL_DOCWORKER_PROXY_KEY`,
  `MODAL_DOCWORKER_PROXY_SECRET` (document worker auth — provisioning status
  UNPROVEN per §3 above; no other new secret names required).
- `CANDIDATE_SECRET_VALUES_CREATED=0`.
- `CANDIDATE_D1_MIGRATIONS`: none new this checkpoint.
- `CANDIDATE_R2_BINDINGS`: `ARTIFACTS` → `siteborne-artifacts` (already bound,
  unchanged).
- Per SUN-1222C-EQ's proven methodology, source since `01600ff` remains
  dead-code- or-pricing-only relative to the deployed Worker bundle — a fresh
  candidate upload would be expected to be execution-equivalent to `3a74686d`
  for every surface except the newly-frozen prices. This checkpoint does **not**
  upload that candidate (explicitly forbidden — §47); that remains the next
  checkpoint's responsibility under its own standalone authorization.

## Final packet

```
SUN1222C_R3=PASS

R3_START_HEAD=36e6cae
R3_END_HEAD=c81b737

================ COMPANY =================
COMPANY_V2_PRICE_USDC=0.0312
COMPANY_V2_AMOUNT_ATOMIC=31200
COMPANY_V1_PRICE_UNCHANGED=YES
COMPANY_V2_REAL_EXECUTOR=YES
COMPANY_V2_PRODUCTION_FIXTURE_REACHABLE=NO
COMPANY_V2_LOCAL_E2E=PASS

================ DOCUMENT ================
DOCUMENT_MODAL_WORKER_LIVE_PROVEN=YES
DOCUMENT_MODAL_PROXY_CREDENTIAL_ACCOUNT_OBJECT_EXISTS=UNPROVEN
DOCUMENT_MODAL_PROXY_SECRET_RECOVERABLE_FROM_APPROVED_SOURCE=UNPROVEN
DOCUMENT_LIVE_SECRET_PROVISIONING_REQUIRED=YES
DOCUMENT_EXTERNAL_BUYER_INGRESS_CURRENTLY_COMPLETE_BEFORE=YES
SELECTED_DOCUMENT_UPLOAD_MODEL=upload_reference (pre-existing, SUN-1222B-S3-R2)
DOCUMENT_BUYER_INGRESS_RED=N/A (already implemented and audited; not rebuilt)
DOCUMENT_BUYER_INGRESS_GREEN=PASS (pre-existing, re-confirmed)
DOCUMENT_BUYER_INGRESS_MUTATION_PROOF=PASS (pre-existing, SUN-1222C-R2)
DOCUMENT_ARTIFACT_PATH_TRAVERSAL=BLOCKED
DOCUMENT_DISCOVERY_TRUTHFUL=YES
DOCUMENT_V2_REAL_EXECUTOR=YES
DOCUMENT_V2_PRODUCTION_FIXTURE_REACHABLE=NO
DOCUMENT_V2_LOCAL_E2E=PASS
DOCUMENT_EVIDENCE_JSON_V2_PRICING_MODEL=upto (ceiling) + per-tier exact settlement
DOCUMENT_EVIDENCE_JSON_V2_PRICE_TABLE=native 0.0098 / ocr 0.0156 / table 0.0238 / max_job 0.19
DOCUMENT_EVIDENCE_JSON_V2_ATOMIC_TABLE=native 9800 / ocr 15600 / table 23800 / max_job 190000
DOCUMENT_V1_PRICE_UNCHANGED=YES
DOCUMENT_V2_P95_MARGIN_RANGE=~68%-85% (estimated, provider-pricing-grounded, not audited actuals)

================ WEBCTX ==================
WEB_CONTEXT_VERIFIED_V2_PRICE_USDC=0.008
WEB_CONTEXT_VERIFIED_V2_AMOUNT_ATOMIC=8000
WEBCTX_REDUCTION_PERCENT=11.1
WEBCTX_P95_MARGIN_PERCENT=~75 (estimated)
WEBCTX_V1_PRICE_UNCHANGED=YES
WEBCTX_V2_REAL_EXECUTOR=YES
WEBCTX_V2_LOCAL_E2E=PASS

================ VERIFY ==================
VERIFY_AGENT_OUTPUT_V2_PRICE_USDC=0.017
VERIFY_AGENT_OUTPUT_V2_AMOUNT_ATOMIC=17000
VERIFY_REDUCTION_PERCENT=10.5
VERIFY_P95_MARGIN_PERCENT=~71 (estimated)
VERIFY_V1_PRICE_UNCHANGED=YES
VERIFY_V2_REAL_EXECUTOR=YES
VERIFY_V2_LOCAL_E2E=PASS

================ ECONOMICS ===============
ALL_PRICE_CHANGES_GOVERNANCE_VALID=YES
ALL_FOUR_PRICE_SINGLE_SOURCE_OF_TRUTH=YES
SERVICE_TOOL_MATRIX_V2_EXACT=PASS
ALL_FOUR_X402_FAIL_CLOSED=YES
PUBLIC_API_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1
NO_BLIND_SETTLEMENT_RETRY=YES
ALREADY_SETTLED_RESETTLEMENT_PATHS=0
POST_SETTLEMENT_FAIL_CLOSED=PASS

================ SECURITY ================
CRYPTO_JWS_RELEASE_GATE=PASS (carried forward, not re-verified this checkpoint)
SUPPLY_CHAIN_RELEASE_GATE=PASS (carried forward; Trivy still environment-blocked, OSV clean, unchanged from SUN-1222B-S3-CONTINUE)
CI_RELEASE_GATES=PASS
MCP_OFFLINE_PACKAGED_INSTALL=PASS

================ FULL GATE ===============
TYPECHECK=PASS
BUILD=PASS
LINT=PASS
TEST_FILES=249 (227 passed, 22 skipped)
TESTS_PASS=2785
TESTS_SKIPPED=77
PROTOCOL_MCP_CHECK=PASS
PROTOCOL_X402_CHECK=PASS
PROTOCOL_A2A_CHECK=PASS
NEVERMINED_CHECK=PASS (243/243)
WORKER_RUNTIME=not re-run this checkpoint (no runtime-relevant source touched)
SSRF_DNS_REBINDING=not re-run this checkpoint (unchanged surface)
X402_REPLAY_CONCURRENCY=covered by full test suite (2785 pass)
DOCUMENT_SECURITY_MATRIX=PASS (pre-existing, SUN-1222C-R2, not re-run)
SECRETS_SCAN=clean (676 commits + working tree)
PRODUCTION_PREFLIGHT=PASS
WRANGLER_DRY_RUN=PASS

================ FUNDING =================
QUALIFICATION_BUYER_BALANCE_ATOMIC=79727
COMPANY_QUALIFICATION_ATOMIC=31200
WEBCTX_QUALIFICATION_ATOMIC=8000
DOCUMENT_QUALIFICATION_ATOMIC=9800
VERIFY_QUALIFICATION_ATOMIC=17000
FOUR_SERVICE_QUALIFICATION_TOTAL_ATOMIC=66000
QUALIFICATION_HEADROOM_ATOMIC=13727
ADDITIONAL_FUNDING_REQUIRED_ATOMIC=0

================ CANDIDATE ===============
FOUR_SERVICE_DEPLOY_READY=YES
CANDIDATE_SOURCE_HEAD=c81b737
CANDIDATE_COMMITS=82de4de,21b2c74,c9672ac,36e6cae,c81b737
CANDIDATE_PUBLIC_BEHAVIOR_CHANGES=four services' displayed/charged v2 prices only
CANDIDATE_ECONOMIC_CHANGES=see section 14 above
CANDIDATE_NEW_ROUTES=none
CANDIDATE_SECRET_NAMES_REQUIRED=MODAL_DOCWORKER_PROXY_KEY,MODAL_DOCWORKER_PROXY_SECRET
CANDIDATE_SECRET_VALUES_CREATED=0
CANDIDATE_D1_MIGRATIONS=none
CANDIDATE_R2_BINDINGS=ARTIFACTS->siteborne-artifacts (unchanged)

PRODUCTION_MUTATIONS=0
EXTERNAL_MUTATIONS=0
ECONOMIC_TRANSACTIONS=0
R3_EVIDENCE_COMMIT_SHA=(this commit)
WORKING_TREE=clean after commit
NEXT_REQUIRED_CHECKPOINT=SUN-1222D-DOCUMENT-CREDENTIAL-AND-CANDIDATE
```

`NEXT_REQUIRED_CHECKPOINT=SUN-1222D-DOCUMENT-CREDENTIAL-AND-CANDIDATE` rather
than `SUN-1222D-FOUR-SERVICE-IMMUTABLE-CANDIDATE`: all four services are
repo-ready and funding is sufficient, but document's live Modal proxy credential
recoverability is genuinely `UNPROVEN` (§3) — the next checkpoint must resolve
that (or explicitly accept operating without a live document-worker credential
for the other three services' qualification) before any candidate upload/deploy
authorization.
