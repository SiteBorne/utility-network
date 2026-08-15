# SUN-0900B Checkpoint 2I — Positive-But-Insufficient Document Balance

Date: 2026-08-15
Starting commit: `4309cc067cdab703477473d107ad65e16c2e613f`
Classification: `controlled_sandbox_self_test`
Checkpoint result: **INCOMPLETE / FAIL-CLOSED BEFORE SETTLEMENT**

This report records the single authorized Checkpoint 2I invocation. It is not an
acceptance report. No second payment was attempted after the invocation failed
locally. Checkpoint 2H remains accepted and unchanged; the partial
positive-but-insufficient balance behavior remains unproven.

## Frozen external preconditions

- Network: Base Sepolia, `eip155:84532`.
- Frozen document agent:
  `109760621961288696094411057321700210583752765344624386042713081041578011828571`.
- Frozen document plan:
  `64977106381472769302826211192910538031161833107493020584806963732279386695975`.
- Registration validator: `valid=true`.
- Registration reconciliation: `EXACT_EXISTING`.
- Registration mutations: `0`.
- Subscriber smart account: `0xCa7DD940B5071Bbcb238901794B900CF9db376E7`.
- Authoritative starting document balance: `178000` credits.
- Pre-live payer balance: `19756000` atomic Base Sepolia USDC (`19.756` USDC);
  native balance `0` wei.
- Frozen maximum/required burn for this test: `190000` credits.
- Positive-but-insufficient deficit: `12000` credits.

## Deterministic maximum-cost fixture

The new tracked fixture is
`services/modal-worker/fixtures/pdf/scanned_ten_page.pdf`:

- PDF version 1.3;
- 10 pages;
- file SHA-256:
  `d0b09ad4ccceb8dbaad8647fe0eb19f13793a11fcb5ca91a047b0b8576d3750f`;
- real local Python document worker result: 10 processed pages, all OCR, no
  tables;
- canonical pricing subtotal: `190000`;
- canonical pricing maximum: `190000`;
- canonical actual amount: `190000` atomic;
- capped: `false`.

This is a normal `document_evidence_json.v1` OCR case. There is no caller-
supplied amount and no test-only price override.

## One authorized invocation

Exactly one guarded live command was invoked with `RUN_LIVE_NEVERMINED=1` and
the Checkpoint 2I scenario flag scoped to that command. It used the dedicated
persistent D1 directory:

`$HOME/.local/share/siteborne/live-d1/sun-0900b-document-partial-balance`

The directory did not exist before the run. The harness created it, applied
migrations, and found no unfinished payment or job before external activity.

Sanitized identifiers created by the one invocation:

- Delegation ID: `fde6e86c-1415-4bac-966f-2228526078bd`.
- Delegation provider/currency: `erc4337` / `usdc`.
- Delegation limit: `19` cents.
- Delegation created: `2026-08-15T21:11:54.037Z`.
- Delegation expiry: `2026-08-15T22:11:53.730Z`.
- Payment-Identifier: `pay_f9cfc34bac0d46bc980d71b286bf39a6`.
- D1 job: `418c712b-542a-42dc-b08c-9f63a5c08d5a`.

The real Nevermined verification succeeded once. D1 durably records the payment
lifecycle at `verified`. The service was entered once, but the job ended
`REJECTED` before a PCC, signed receipt, UsageResult, or settlement draft could
be produced.

## Failure and root cause

The HTTP result was `500 service_execution_failed` with the bounded local
message `document fixture did not produce its signed receipt`.

The failure was traced through the complete input path:

1. The maximum-cost fixture is image-only and requires OCR.
2. The credential-free preflight called the worker directly with
   `ocrPolicy=if_needed`, proving the worker classification and price.
3. The live service input did not include the normal schema field
   `ocr_permission=true` and still declared the prior fixture byte length as
   `size_bytes=1`.
4. `DocumentEvidenceJsonService` selected its safe `ocrPolicy=never` boundary
   value.
5. The subprocess bridge forwarded that TypeScript vocabulary literally, while
   the Python CLI accepts `forbidden` for the same policy. The CLI rejected the
   invalid argument before document processing, the route quarantined/rejected
   the job, and the harness correctly refused settlement.

The initiating defect was the harness's missing explicit OCR authorization; a
separate TypeScript-to-Python policy-vocabulary mismatch made the actual local
failure occur one boundary earlier than the first incident analysis stated.
Neither Nevermined nor pricing caused the failure. Both failures were closed: no
service result, PCC, receipt, usage result, settlement draft, provider
settlement, cash movement, or credit movement was produced.

The Payment-Identifier is immutably bound to the exact OCR-disabled,
`size_bytes=1` input. Adding OCR permission alone changes the canonical input
hash; correcting the byte length changes it again. Either change is a binding
conflict for the old identifier. The run was therefore not retried.

## External reconciliation after failure

A seller-credential GET-only reconciliation established:

- delegation status: `Active`;
- delegation amount spent: `0` cents;
- delegation transactions: `0`;
- Nevermined settlements: `0`;
- public settlement transaction: none;
- document plan balance after the failure: `178000` credits.

D1 established:

- payment lifecycle: `verified`;
- job state: `REJECTED`;
- job attempt count: `1`;
- cached paid result count: `0`;
- settlement-pending timestamp: absent;
- service output hash: absent;
- receipt ID: absent;
- settlement transaction reference: absent;
- consumed state: false.

No credit or monetary equation can be classified because no settlement took
place. In particular, this run proves neither `FULL_BUNDLE_TOPUP` nor
`DEFICIT_ONLY_TOPUP`.

## Local repair and regression

The failed and corrected canonical input hashes are:

- failed (`size_bytes=1`, OCR absent):
  `sha256:b889fc62ece7d0c68e0173fb91d7d075bd880aa595266043ed35b02d7884aba2`;
- OCR-only correction with the old byte declaration:
  `sha256:505bdbb911d1643fa09c9752863b1078d8b9a119b43c9dce2434d005e19d615b`;
- fully corrected (`size_bytes=29001`, `ocr_permission=true`):
  `sha256:f2bf49622791b31d01307cad7daf171908bcc26e94d543975af8222a34c05f82`.

The local repair now:

- binds the real fixture byte length and `ocr_permission=true` before quote,
  Payment-Identifier acquisition, provider verification, or execution;
- maps TypeScript `always` / `if_needed` / `never` onto the Python CLI's
  `required` / `if_needed` / `forbidden` vocabulary;
- rejects OCR-required content without explicit permission before PCC or receipt
  signing, even though the worker can truthfully return partial
  page-classification metadata under the `forbidden` policy;
- requires a reusable delegation to retain at least 45 minutes of lifetime;
- requires the second-attempt persistent D1 store to contain zero payment
  attempts and zero jobs before any external mutation.

The credential-free regression was strengthened in two package-correct layers:
the pricing package proves ten measured OCR pages derive canonical `190000`
usage with no override, while the real-subprocess service-runtime test executes
the same ten-page OCR case through `DocumentEvidenceJsonService`, requires a
successful result and signed receipt, and cryptographically self-verifies that
receipt. Its paired negative proves the same fixture without OCR permission is
rejected with no PCC/receipt. Route-level D1 coverage proves a
verified-but-service-rejected payment has no settlement draft and cannot be
recovered into a settlement. Targeted results after the repair:

- edge-api normal and live-test TypeScript projects: pass;
- focused pricing, Nevermined credit-evidence, route/recovery, and document
  subprocess matrix: 99 passed / 2 live tests skipped;
- ten-page OCR service/receipt regression: pass;
- guarded live/recovery tests with live flags absent: skipped, with zero
  credential reads and zero network mutation.

The final credential-stripped repository regression also passed after being
rerun outside the restricted shell required by Miniflare/tsx local sockets:

- normal repository tests: 1639 passed, 20 skipped;
- Nevermined protocol tests: 199 passed;
- Nevermined compatibility matrix: 155 passed;
- x402 protocol tests: 451 passed, plus 20 property tests and fixture audit;
- MCP and A2A checks: pass;
- document worker: 81 passed;
- service runtime: 90 passed;
- governance, state, tasks, contracts, migrations, D1, control plane, adapters,
  verification, and generated-artifact drift checks: pass;
- `pnpm check`: pass;
- secret-scan scope: 837 tracked files / 5341638 bytes / 8 required risk classes
  / 9 redacted detector probes;
- Gitleaks history scan: 90 commits / approximately 5.81 MB / no leaks;
- Gitleaks working-directory scan: approximately 12.46 MB / no leaks.

The local repair does not retroactively change the immutable failed payment. It
prepares a later, separately authorized checkpoint only.

## State and claims

- `sandbox_capability_verified=true` remains unchanged, scoped to accepted
  Checkpoint 2H.
- `dynamic_live_allowed=true` remains unchanged, scoped to accepted Checkpoint
  2H.
- `PARTIAL_POSITIVE_INSUFFICIENT_BALANCE_UNPROVEN` remains true.
- `production_ready=false`.
- `production_enabled=false`.
- This controlled sandbox attempt is not revenue, customer activity, an
  independent customer, or an open-market purchase.
- No mainnet operation occurred.

## Required next action

Do not reuse or modify `pay_f9cfc34bac0d46bc980d71b286bf39a6`, do not delete its
durable D1 evidence, and do not settle it. Completing Checkpoint 2I now requires
a separately authorized new logical payment using the corrected immutable
OCR-enabled input and a distinct persistent D1 path. Before that authorization,
reconcile the frozen plan balance again and require it to remain exactly
`178000`.
