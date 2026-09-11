# SUN-1222C PCC lifecycle backlog reconciliation

Date: 2026-09-11 (America/Chicago)

## Decision

`SUN1222C_PCC_LIFECYCLE_BACKLOG_RECONCILIATION=LIFECYCLE_MODEL_GAP`.

The 17 rows are genuine historical payment records, not deletable noise. A fresh
production-D1 reconstruction corrected the prior report's join mistake: all 17
have a real `jobs` row through
`jobs.idempotency_key = payment_attempts.payment_identifier`, even though
`payment_attempts.job_id` is null. Fourteen corresponding jobs are terminal
`REJECTED`, one is stranded at `EXECUTING`, one is stranded at `LOCKED`, and the
economically settled row is `DELIVERED` with a stored PCC/result marker.

None of those histories can be represented truthfully by a current terminal
payment-attempt stage. `verification_failed` means payment verification itself
failed and cannot describe a payment that was successfully verified before a
later execution failure. `settled` requires the governed link-verification
sequence, which is not evidenced for the one `settled_external` row. The
all-or-nothing mutation gate therefore failed. No production lifecycle row was
updated or deleted.

This report preserves, and does not rewrite, the earlier ownership audit. It
adds the corrected cross-table join and the deeper economic and lifecycle
classification required by this checkpoint.

## Integrity and unchanged production state

At checkpoint start:

```text
PWD=/Users/meta4ickal/SITEBORNE Utility Network
BRANCH=main
HEAD=02eb757b45549cbf7ffaad6fc6024c5099b6c08e
WORKING_TREE=CLEAN
PRIOR_EVIDENCE_COMMIT_EXISTS=YES
PRIOR_EVIDENCE_COMMIT_REACHABLE=YES
```

Read-only Cloudflare readback found no topology drift:

```text
PUBLIC_NORMAL_VERSION=b6b7477f-94e5-4ee5-9ff3-cc0abb69ecca
PUBLIC_NORMAL_TRAFFIC=100%
QUIESCENCE_VERSION=d28f30c5-b83c-42a8-b0e4-3f3a7c2bc7d1
QUIESCENCE_TRAFFIC=0%
PAID_RUNTIME_VERSION=d62011b9-6219-47e1-8cf9-5006776cfb50
PAID_RUNTIME_TRAFFIC=100%
PUBLIC_TOPOLOGY_DRIFT=NO
PAID_RUNTIME_DRIFT=NO
```

No version, deployment, traffic, configuration, Workflow, provider, payment,
settlement, chain, or lifecycle mutation was performed.

## Authoritative lifecycle semantics

The authority is `packages/protocol-x402/src/lifecycle/stage.ts`, enforced with
a compare-and-set `UPDATE ... WHERE lifecycle_stage = ?` by
`D1PaymentAttemptRepository.transitionLifecycleStage`.

```text
AUTHORITATIVE_LIFECYCLE_STAGES=acquired,verified,verification_failed,executed,settlement_pending,settled_external,link_verified,settled,settlement_failed
AUTHORITATIVE_TERMINAL_STAGES=verification_failed,settled
```

`settlement_failed` is not terminal in the current graph: it retains a narrow,
positive-evidence-only recovery edge to `settled_external` for a historical
false-rejection case.

### Transition matrix

| From                 | To                    | Current source owner                                                                      | Meaning and preconditions                                                                                      | Economic preconditions                                                                                          |
| -------------------- | --------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `acquired`           | `verified`            | `x402-service.ts`, after `canAdvanceToVerified`                                           | The presented payment authorization passed facilitator/evidence verification for the exact stored binding.     | Verification only; no settlement or asset movement is implied.                                                  |
| `acquired`           | `verification_failed` | `x402-service.ts`, only on a failed verification gate                                     | Payment verification was attempted and rejected before paid execution.                                         | No settlement and no useful provider execution.                                                                 |
| `verified`           | `executed`            | `paid-continuation-workflow.ts`, after a successful executor result                       | Provider execution completed successfully and the result may proceed to PCC/settlement.                        | Payment was verified; settlement has not yet begun.                                                             |
| `verified`           | `settled`             | Graph-retained legacy edge; no current production caller found                            | Legacy direct completion path. A caller would still need complete successful settlement semantics.             | Positive settlement evidence and all governed completion evidence are required; the edge alone is not evidence. |
| `verified`           | `settlement_failed`   | Graph-retained legacy edge; no current production caller found                            | Legacy direct explicit settlement failure.                                                                     | A definitive settlement rejection, not mere staleness.                                                          |
| `executed`           | `settlement_pending`  | `recordSettlementPending`, called by the dedicated Workflow                               | Durable pre-settlement claim/CAS before the sole real `settle()` call.                                         | Successful execution; no settlement may be sent unless this write commits.                                      |
| `settlement_pending` | `settled_external`    | `recordSettledExternal`, used after positive direct or reconciled external evidence       | Economic settlement is confirmed outside the database.                                                         | Positive transaction/provider evidence for the exact payment.                                                   |
| `settlement_pending` | `settlement_failed`   | `recordCdpSettlementOutcome`                                                              | Settlement was definitively rejected.                                                                          | Explicit rejection evidence; not a timeout guess.                                                               |
| `settled_external`   | `link_verified`       | `attemptNeverminedRecovery` only; missing from the current CDP Workflow finalization path | The PaymentServiceLink binding payment, request, result, receipt, and settlement was constructed and verified. | Settlement already confirmed; no new economic action.                                                           |
| `link_verified`      | `settled`             | `attemptNeverminedRecovery` only; missing from the current CDP Workflow finalization path | All governed completion/link evidence is complete; payment reaches its terminal summary stage.                 | No new settlement; definitive prior economic evidence remains required.                                         |
| `settlement_failed`  | `settled_external`    | `attemptNeverminedRecovery`, Nevermined-only                                              | Corrects one false historical failure only after an independent read-only provider result says `SETTLED`.      | Exact positive external settlement proof; never a retry.                                                        |

```text
VERIFICATION_FAILED_SEMANTICS=PAYMENT_VERIFICATION_WAS_ATTEMPTED_AND_FAILED_BEFORE_PAID_EXECUTION
CAN_VERIFIED_TRANSITION_TO_VERIFICATION_FAILED=NO
IS_THAT_TRANSITION_PRESENT_IN_CURRENT_SOURCE=NO
WOULD_USING_VERIFICATION_FAILED_FOR_A_STALE_VERIFIED_ORPHAN_FALSIFY_HISTORY=YES

SETTLED_SEMANTICS=SUCCESSFUL_PROVIDER_EXECUTION_PLUS_SUCCESSFUL_SETTLEMENT_PLUS_REQUIRED_LINK_AND_RESULT_OR_PCC_EVIDENCE
REQUIRES_SUCCESSFUL_PROVIDER_EXECUTION=YES
REQUIRES_SETTLEMENT_REFERENCE=YES
REQUIRES_LINK_VERIFICATION=YES
REQUIRES_PCC_OR_RESULT_EVIDENCE=YES
```

## Full 17-row reconstruction

The canonical D1 query was rerun against the exact frozen nonterminal set. It
still returns `verified=16`, `settled_external=1`. Every query in this report
was read-only (`rows_written=0`, `changed_db=false`). `Q`, `V`, `Exec`, `Ext`,
`Fail`, `Set`, `Link`, and `Result` mean quote found, payment-verification
evidence, executor-path outcome, external provider request, downstream failure,
settlement success, durable link-verification evidence, and durable useful
result/PCC evidence respectively.

|   # | Payment attempt / created UTC                                       | Service / stage          | Quote / requirement                                             | Job and job evidence                                                   |   Q |   V | Exec / Ext                          |      Fail | Set | Link | Result |
| --: | ------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- | --: | --: | ----------------------------------- | --------: | --: | ---: | -----: |
|   1 | `57a2bcdb-3d47-4369-b871-2d7befec555c` / `2026-08-29T17:54:27.958Z` | web / `verified`         | `qte_9963cfc676f1f3849db19a3d` / `req_e80d8832ca6cf58c5da80eed` | `33c5387f-4abb-49af-95f6-ef929ba83ad9`, `REJECTED`, 9 state events     |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|   2 | `a5928987-1c4c-4fd0-8e91-5095b955dda6` / `2026-08-29T22:35:32.413Z` | web / `verified`         | `qte_5bddf139a844065020b17867` / `req_6b73affce1aefd29d5f0f8ae` | `c51a822e-c110-43e1-ac6e-cb1a5444315e`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|   3 | `bff2bc21-3b12-417c-ac35-4be05c212936` / `2026-08-29T23:27:39.862Z` | web / `verified`         | `qte_f28581689ea4e57fe16f5bbb` / `req_16082b7e7abeb2213369333d` | `11fde704-fce5-4ef0-b627-c0290e20ead8`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|   4 | `e8d2607b-c3e3-4690-825a-b919bdaa9a48` / `2026-08-30T01:24:30.515Z` | web / `verified`         | `qte_d084ba9d9b1d2c781e157df8` / `req_8243220b7b68e4a44c771170` | `ee04c4bf-1b74-44c6-a1ab-00edc235b4a9`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|   5 | `3a728ffc-5f1b-4b12-8145-c84f25fc9330` / `2026-08-31T04:46:24.078Z` | web / `verified`         | `qte_61fcb444041670ef5a639223` / `req_378dcfd77e2bbac1dd1a0091` | `de147124-c264-452b-b784-86ee4422ecd1`, stranded `EXECUTING`, 7 events |   Y |   Y | started, outcome unknown / possible | N/unknown |   N |    N |      N |
|   6 | `123c4f61-2090-40fb-b918-7b2e1f187af0` / `2026-08-31T20:10:40.909Z` | web / `verified`         | `qte_6eeac9946637f4b1c55aa5e3` / `req_b8ab533c84fde2f4442a43d9` | `8187902a-c3bf-4c3f-89c0-3d84ecd72d05`, stranded `LOCKED`, 5 events    |   Y |   Y | not routed / N                      |         N |   N |    N |      N |
|   7 | `abc98f87-9164-4d97-98d3-c24d4367f0a6` / `2026-09-01T12:40:04.749Z` | web / `verified`         | `qte_b98a3391c88fd8a75b88b1ec` / `req_8884551abdb9e279b057eab9` | `49a43a08-5479-4087-8ada-1afcf8074120`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|   8 | `eddedd77-86c0-47c6-8ec3-11f1354dddc5` / `2026-09-01T13:10:06.014Z` | web / `verified`         | `qte_028659ab4db4740c525c2de8` / `req_04fc6c2c72f8d6b5af8df771` | `3898e160-edd7-4bbf-adcb-80ac4b75f301`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|   9 | `56d84294-eff5-4f92-ae91-d61ceca5339a` / `2026-09-01T13:39:25.906Z` | web / `settled_external` | `qte_9c1cf942bba8dd56340e654e` / `req_03aaccf604de020a18ac2a81` | `64a321cb-f1d2-495d-a405-094b631d4170`, `DELIVERED`, 10 events         |   Y |   Y | success / Y                         |         N |   Y |    N |      Y |
|  10 | `3706d9a9-789e-4e07-bab5-7b3174e11f24` / `2026-09-06T05:06:51.691Z` | company / `verified`     | `qte_a0a61a26031193c90d46bc62` / `req_ca141fdf0870c0f95fce9c73` | `cdc7b707-cb2c-41c5-a503-360bd95621d8`, `REJECTED`, 9 events           |   Y |   Y | completed failure / N (TermsGuard)  |         Y |   N |    N |      N |
|  11 | `f964e050-abd4-4f27-b04e-dc06eaf219ed` / `2026-09-07T16:56:12.319Z` | company / `verified`     | `qte_6bdd01877e37763af6ea7d3d` / `req_6ee6c607a760e86d0ca4c9ce` | `8c3add98-6d41-4d12-8838-7acd3a443ef4`, `REJECTED`, 9 events           |   Y |   Y | completed failure / N (TermsGuard)  |         Y |   N |    N |      N |
|  12 | `7176fb23-7c68-451e-b0a3-1e93f54ef8fe` / `2026-09-07T18:13:20.736Z` | company / `verified`     | `qte_913d3b91b44908164a688a12` / `req_151692a5a538b94712142957` | `63dfe74b-6414-4cfa-9dfa-0fb2b7a83aa0`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|  13 | `0ada4abc-a437-428e-803f-3dfb68f915f9` / `2026-09-07T21:27:10.226Z` | company / `verified`     | `qte_6169923ee199a46eb2f58e05` / `req_9a212f75f55ab6a614ef99d7` | `72efabd1-062b-4fca-9f04-68525b5d1446`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|  14 | `d275356c-f6f8-46f7-8a2a-cabe26d32185` / `2026-09-07T22:30:30.359Z` | company / `verified`     | `qte_b9e8de5731e23c02759c05ce` / `req_19632a2fab604fd3079919f0` | `70434d7b-35d0-4658-ba5c-b324b210bd2a`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|  15 | `ab07fd69-e50c-4abf-ae5b-1fb8476230b8` / `2026-09-07T23:38:33.935Z` | company / `verified`     | `qte_8824c0fee46cd1199a7c00ef` / `req_afb954d457ae1a4b8697051a` | `d6563fbb-71ba-4509-8c01-a9e674cba52d`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|  16 | `5be6b110-62fb-40a4-8bda-cf4698645d71` / `2026-09-08T05:40:30.686Z` | company / `verified`     | `qte_2bc0d29dea87e036164edb2d` / `req_fb132b2f537544f7ab2f73a2` | `5a87c9c5-995f-4173-8015-596257a41ea2`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |
|  17 | `22d6df47-41db-49a6-8eff-3750bd5539c9` / `2026-09-08T13:05:49.043Z` | company / `verified`     | `qte_543981bc1ac7e3f588a724bb` / `req_bd83d25441ce334e80ce9921` | `07b7655b-3731-40e2-b376-30302333497c`, `REJECTED`, 9 events           |   Y |   Y | completed failure / Y               |         Y |   N |    N |      N |

For all rows, `JOB_FOUND=YES`, `JOB_STATE_EVENT_FOUND=YES`,
`STATE_EVENT_FOUND=NO_TABLE_IN_CURRENT_SCHEMA`, `QUEUE_DISPATCHES=0`, and the
exact payment identifier remains uniquely reserved by
`idx_payment_attempts_identifier`. The route's early `service_execution_started`
audit marker is not by itself provider proof: row 6 has that marker but never
advanced past `LOCKED`.

### Exact audit-event IDs

The following are sanitized identifiers only; no signatures, payment material,
customer payloads, or credentials are reproduced.

|   # | `AUDIT_EVENT_IDS` (`id:type`)                                                                                                                                                                                                                                                                                             |
| --: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | `897bf13a-f305-484d-b8ef-ed9b12c3c655:job_created`; `25986b7a-fe3d-4b67-a46e-cb28339c6067:payment_verification_requested`; `905440a5-4144-46b5-9741-9d2f3d01d20b:payment_verified`; `850c6e62-a5f1-4fdc-863a-28533a09ca53:service_execution_started`                                                                      |
|   2 | `8bb850c4-cead-4c1b-9fa7-9dcd6a8667b3:job_created`; `7db447b4-7c31-4ac2-a76e-725e62ce8ef1:payment_verification_requested`; `b6eee835-b082-4f3a-9300-9222edc1ce44:payment_verified`; `c77a6f79-7d33-4771-9bc0-46bfe35114fd:service_execution_started`; `d3eacb89-0199-4401-8b57-d9eeb72c915a:service_execution_diagnostic` |
|   3 | `3ff7945f-1548-4e84-91b9-db9ac72996c1:job_created`; `6406ba4e-9c88-4f1a-b962-3ede2e6ca249:payment_verification_requested`; `c9ee508e-dd82-410b-b474-2053dd38839d:payment_verified`; `1e1033d9-8efc-43a0-b203-d5e1dc394889:service_execution_started`; `f16d769d-74b6-4785-92ba-9ed30f097e4e:service_execution_diagnostic` |
|   4 | `c4f9aba8-0d84-47a9-ad9f-9451cb52678b:job_created`; `6b99aacb-6e93-40cc-8a40-e9a72277d9c4:payment_verification_requested`; `0f7e9770-c121-42b1-a592-04507669dad4:payment_verified`; `2e83fb13-e290-46df-ba1a-2d76f7c23bde:service_execution_started`; `e13ecdc4-2b73-4509-ad85-d4436f0347bc:service_execution_diagnostic` |
|   5 | `06d0b486-1c52-4bed-a5df-e3948b96c9ae:job_created`; `f8a48a51-4628-4610-b2a1-32f1a152610c:payment_verification_requested`; `5f85e6cf-6b41-4254-a94d-ee69887c2f7f:payment_verified`; `c5134565-9c37-4e88-8a19-c5c65952d875:service_execution_started`                                                                      |
|   6 | `5d75bd67-eea9-41ec-8d15-0b14006e03e9:job_created`; `730ec9f7-4a72-4b3e-9a90-ae32ab2ec10e:payment_verification_requested`; `53622765-54cf-483a-862b-1dca8054f96b:payment_verified`; `21d4ade5-7179-4d53-a80e-bac0908328c6:service_execution_started`                                                                      |
|   7 | `5902e951-3878-4116-bccb-7e577769760a:job_created`; `0e13cc6c-4703-4691-add7-61b6b9a77490:payment_verification_requested`; `5a483e48-bd1a-4dce-a901-3db47144de7a:payment_verified`; `204fc500-975c-4a27-8c8e-f3527b6c0ceb:service_execution_started`                                                                      |
|   8 | `82b1d657-7cd7-4aa0-bf13-2992a01bb67d:job_created`; `4f15a4a4-ce06-4bf3-a31d-7ee46bad3c24:payment_verification_requested`; `78a2c8ec-b858-48aa-a64b-a12a39429749:payment_verified`; `8ca3c436-ca2a-42a4-9c4d-a793b878f1f9:service_execution_started`                                                                      |
|   9 | `838c3cbd-e436-4e90-acba-72b7a07be1b6:job_created`; `06be7ce7-8793-46a7-bd2d-dac8294a75cd:payment_verification_requested`; `e918dc2c-4711-4e1f-8e32-b0dac765eb90:payment_verified`; `8cb563c5-9e21-4df3-8d7b-39bfcbe8b333:service_execution_started`                                                                      |
|  10 | `e917b0e1-7592-41fa-97d3-ddc2d85e2043:job_created`; `e73d5072-ceb9-442b-86d2-f8775b3cee68:payment_verification_requested`; `3efea049-e454-41ab-9f65-4fe5a768ca12:payment_verified`; `8c3fff26-9243-4329-a1e9-64cdc293bc55:service_execution_started`                                                                      |
|  11 | `5283a391-fa08-4889-8d90-0176dd7ae30e:job_created`; `4e0a977b-007f-4cca-9845-881fd5a88914:payment_verification_requested`; `627a64ec-79d1-4346-8dfe-e470572e5ee9:payment_verified`; `d7ef4622-68a6-4b1f-b161-74f40136e2b1:service_execution_started`                                                                      |
|  12 | `ad87c46e-6d4c-4552-a75a-6b4cdc0e0910:job_created`; `8e3d4ac5-6aa9-4a64-ba4a-5822ed31b3cd:payment_verification_requested`; `746a83db-6f82-4b21-bb0f-b30b16304adb:payment_verified`; `153e177d-948a-4794-aaf8-eb19e6360897:service_execution_started`                                                                      |
|  13 | `a2eb1fdc-ea70-4f64-82c1-31fb633d7718:job_created`; `6f633fca-e81d-456d-978d-799fb621683a:payment_verification_requested`; `61b48b79-650e-401b-acb8-5e35b2539ea0:payment_verified`; `57bf59e9-27b7-4bd0-8443-98598e6685ec:service_execution_started`                                                                      |
|  14 | `81dddf34-ef8c-40ee-a515-5437a270d13b:job_created`; `058056f4-c26c-4d6c-b919-5f229c5186bf:payment_verification_requested`; `1c387f63-f84f-4612-90a1-e903fa3a689f:payment_verified`; `eccbff1d-676f-4937-8153-19fdcf0b5aa8:service_execution_started`                                                                      |
|  15 | `4c2cdb0d-bc7b-4296-9fbb-ed2fe5bd6e36:job_created`; `b49f7f56-96de-4f1a-838d-8e7782792849:payment_verification_requested`; `f4abfcb6-52a6-43c1-b29e-229c5b980a6a:payment_verified`; `bd56d926-b8c0-4083-8200-807189ebd26a:service_execution_started`                                                                      |
|  16 | `c275688c-ec58-4676-a976-18666bdc404d:job_created`; `8be7d88b-0853-4028-9b73-134cbebdf903:payment_verification_requested`; `7873cd28-5f53-4336-9c45-4e109e583199:payment_verified`; `edf494f8-2b87-4855-a9d0-1e193736dd80:service_execution_started`                                                                      |
|  17 | `d37a3403-5f26-4d4b-a9b6-2d9d91090309:job_created`; `59583753-7c81-4cb8-b394-b0994fcfe5b8:payment_verification_requested`; `b392addd-2acd-464a-9bba-fb2e27b0d1d9:payment_verified`; `891d0f1a-c799-455f-87f2-57e1d70d7816:service_execution_started`                                                                      |

Rows 2-4 additionally retain sanitized execution diagnostics. Rows 2 and 3
record `WEBCTX_UPSTREAM_PROTOCOL_ERROR`; row 4 records
`WEBCTX_HTTP_PREMATURE_EOF`. Later durable-Workflow failure detail lives in the
historical Workflow/report record rather than an `x402_service_results` row,
because that table is only persisted after successful settlement.

## Historical architecture and origin

Exact source commits were not retroactively invented where an upload message did
not carry one. In those cells the immutable Worker version and retained report
are the strongest available lineage evidence.

| Rows | Public source/version evidence                                                                                 | Paid-runtime source/version evidence                                                                      | Generation and expected writes                                                                                        | Known historical gap                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `915be949-b46f-464b-a4d6-17b74539ce55` (version 34, E1 upload)                                                 | none; paid work was in the public Worker                                                                  | Pre-Workflow synchronous public-worker execution; Workflow creation not expected; job-state writes expected           | Downstream execution failure remained `payment_attempts.verified`.                                                                                                              |
| 2    | `54d87b77-e3fd-44da-a012-a817c23f1953` (version 37), implementation `dd9943e4d6e38a54a4906ca41288342502425a81` | none                                                                                                      | Same synchronous generation                                                                                           | Application-level executor failure; no payment terminal for post-verification failure.                                                                                          |
| 3    | `a088632e-b93c-4953-b0fc-411a2005e57c` (version 38)                                                            | none                                                                                                      | Same synchronous generation                                                                                           | Response-read diagnostic generation; no post-verification terminal.                                                                                                             |
| 4    | `090a4bc4-64e4-4152-8ce9-d41977238162` (version 39)                                                            | none                                                                                                      | Same synchronous generation                                                                                           | Proven premature-EOF execution failure; no post-verification terminal.                                                                                                          |
| 5    | `30ab6b71-fb3f-463f-9bae-46f090c5cdb4` (H1, high-confidence report attribution)                                | none                                                                                                      | Pre-durable synchronous request; Workflow not expected; state events expected                                         | Client/process termination after `EXECUTING`; no `waitUntil`, queue, or recovery owner.                                                                                         |
| 6    | Exact public version/source not recoverable from retained evidence                                             | no Workflow instance or host association                                                                  | Transition-era historical record; state writes occurred through `LOCKED`; Workflow creation cannot be proven expected | Previously misclassified after an incorrect `payment_attempts.job_id` query; exact origin remains unknown.                                                                      |
| 7    | `db7054c9-76ee-4830-aabe-8a4542261b6a`, H2BF5-FINAL lineage `8f25a29`                                          | Workflow version `85dc348b-4fe9-41be-b880-cb83a0875bda`                                                   | First cross-script durable generation; Workflow creation and job-state writes expected                                | Workflow ran; AJV runtime compilation failed in the dedicated host.                                                                                                             |
| 8    | `db7054c9-76ee-4830-aabe-8a4542261b6a`                                                                         | Workflow version `caa7b4b7-4fe3-434d-9839-2e6e5f864286`                                                   | Cross-script durable generation                                                                                       | Workflow ran; executor request/schema validation failure.                                                                                                                       |
| 9    | `db7054c9-76ee-4830-aabe-8a4542261b6a`                                                                         | paid host `67ae702c-f8d0-4a56-afd4-55b135784871`, Workflow version `7f9ab8d1-a45a-4ee1-95a8-283deea6facd` | Cross-script durable generation                                                                                       | Provider/PCC/settlement succeeded; missing production migration crashed post-settlement bookkeeping. Later governed recovery delivered the job but did not prove a signed link. |
| 10   | company candidate `efc5a287-d807-4b07-957f-ebbdf471e439`                                                       | host `f17acb0c`                                                                                           | Cross-script durable company generation                                                                               | TermsGuard blocked before the SEC provider call.                                                                                                                                |
| 11   | exact public candidate commit not retained in the row; Q1R2 report lineage                                     | host `f17acb0c`                                                                                           | Cross-script durable company generation                                                                               | Stale host still lacked TermsReview; provider blocked preflight.                                                                                                                |
| 12   | Q1R4 report lineage                                                                                            | host `917c1c49`                                                                                           | Cross-script durable company generation                                                                               | Real provider attempt returned a clean partial/permanent failure; no settlement.                                                                                                |
| 13   | R8 report lineage                                                                                              | host `e11304df`                                                                                           | Cross-script durable company generation                                                                               | Real provider attempt returned partial/permanent failure; deployment-lineage diagnostic followed.                                                                               |
| 14   | R10 report lineage                                                                                             | host/Workflow version `ca8da8cd-89d9-4998-8a00-cdd48f604ebd`                                              | Cross-script durable company generation                                                                               | Real SEC attempt; structured partial result; pre-result observability gap.                                                                                                      |
| 15   | R3 report lineage, public API `db7054c9`                                                                       | host `453dd8f7-2fa0-44d6-9541-6a79c7fbc80a`                                                               | Cross-script durable company generation                                                                               | Real provider attempt; clean Workflow rejection and client 502 response-path gap.                                                                                               |
| 16   | Q1 safe-egress parse report lineage                                                                            | exact host source commit not stored in D1; retained Workflow/report evidence                              | Cross-script durable company generation                                                                               | Real SEC response reached an HTTP parser lacking chunked de-framing; structured failure.                                                                                        |
| 17   | R4-D4 report lineage                                                                                           | exact host source commit not stored in D1; retained Workflow/report evidence                              | Cross-script durable company generation                                                                               | Provider result reached verification mesh; deterministic rejection detail was truncated/not durably stored.                                                                     |

The authoritative origin classification is:

| Rows  | Origin                    | Evidence                                                                                                                                                                               |
| ----- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-5   | `AUTHORIZED_RELEASE_TEST` | Exact timestamps, identifiers, immutable candidates, economics, and named E2/E3/E4/E5/H1 reports.                                                                                      |
| 6     | `UNKNOWN`                 | The row and job are genuine, but no retained operator report or correlation identifier proves which historical action created it. Age and `production_enabled=0` are not origin proof. |
| 7-9   | `AUTHORIZED_RELEASE_TEST` | Exact H2B2 identifiers and retained Workflow/reconciliation reports.                                                                                                                   |
| 10-17 | `AUTHORIZED_RELEASE_TEST` | Exact Q1/R-series payment identifiers, jobs, Workflow traces, and reports. The checkpoint premise said seven company rows; live D1 has eight, and this report uses the live count.     |

## Economic reality and replay decision

For the 16 `verified` rows, the D1 stage plus payment verification audit/job
transition proves that the service accepted verification. It does not prove
economic settlement. All 16 have zero settlement-attempt count, zero successful
settlement count, no settlement reference, no result/PCC row, and no useful
delivered result. Historical reports independently reconciled the authorized
attempts as no-settlement. Row 6's exact real facilitator provenance is not
recoverable, so its verification is `YES` at the stored system boundary and
`UNKNOWN` as an independently observed external facilitator call.

```text
VERIFIED_ROWS_COUNT=16
VERIFIED_ROWS_WITH_REAL_ASSET_MOVEMENT=0
VERIFIED_ROWS_WITH_PROVIDER_EXECUTION=14_CONFIRMED_EXECUTOR_COMPLETIONS_(12_WITH_EXTERNAL_PROVIDER_ATTEMPTS_AND_2_FAIL_CLOSED_PRE_PROVIDER);_1_STARTED_WITH_OUTCOME_UNKNOWN;_1_NOT_ROUTED
VERIFIED_ROWS_WITH_USEFUL_RESULT=0
CUSTOMER_OR_TEST_CALLER_RECEIVED_USEFUL_RESULT=NO_FOR_15;_UNKNOWN_BUT_NO_DURABLE_RESULT_FOR_ROW_5
PAYMENT_AUTHORIZATION_STILL_REPLAYABLE=NO_FOR_EXPIRED_REPORTED_AUTHORIZATIONS;_UNKNOWN_FOR_ROWS_WITHOUT_RETAINED_RAW_WINDOW;_NO_RAW_PAYMENT_MATERIAL_RETAINED_BY_THIS_RECONCILIATION
CURRENTLY_SAFE_TO_REPLAY=NO_FOR_ALL_16
REPLAY_RECOMMENDED_COUNT=0
```

Rehydration is neither semantically legitimate nor economically safe: provider
versions and feature state have changed; company execution is intentionally
blocked; callers expected results days ago; original authorization material is
expired or unavailable; and recreating a Workflow risks duplicate external side
effects without restoring the caller's original request context. A technically
writable recovery tool would not make replay governed or truthful.

```text
COMPANY_ORPHAN_REPLAY_ALLOWED_IN_THIS_CHECKPOINT=NO
WEB_ORPHAN_REPLAY_EXECUTED=NO
AGE_ONLY_USED_AS_STALENESS_SIGNAL=YES
```

### `settled_external` special analysis

Attempt `56d84294-eff5-4f92-ae91-d61ceca5339a` is economically and functionally
different from the 16 verified rows:

- the real executor returned success and a PCC with `decision=pass`;
- the job was later governed to `DELIVERED` and one `x402_service_results` row
  exists (`kind=workflow_receipt`, `receipt_persisted=true`);
- `consumed_at` and the service output hash are present;
- one successful economic settlement is stored; and
- a single bounded, no-retry, read-only Base-mainnet `eth_getTransactionReceipt`
  lookup confirmed transaction success and the exact USDC Transfer from the
  authorized buyer to the governed seller.

The public transaction reference is intentionally not repeated here. The receipt
proved Base USDC asset `0x833589fCD6EDb6E08f4c7C32D4f71b54bdA02913`, amount
`9000` atomic, and the exact governed payee. This lookup used the standard
read-only JSON-RPC method documented by Base; it did not sign or broadcast a
transaction.

```text
METHOD_IS_READ_ONLY=YES
RETRY_POLICY_BOUNDED=ONE_REQUEST_NO_RETRY
ANALYTICS_SIDE_EFFECT=UNKNOWN_PROVIDER_ACCESS_LOGGING_POSSIBLE;_NO_PROTOCOL_OR_ECONOMIC_MUTATION
READ_ONLY_EXTERNAL_EVIDENCE_LOOKUPS=1
EXTERNAL_SETTLEMENT_CRYPTOGRAPHICALLY_OR_PROVIDER_VERIFIED=YES
SETTLEMENT_FINAL=YES
SETTLEMENT_ASSET=USDC_ON_EIP155:8453
SETTLEMENT_AMOUNT=9000_ATOMIC
SETTLEMENT_RECIPIENT=GOVERNED_SELLER_PAYTO
EXPECTED_ASSET_MATCH=YES
EXPECTED_AMOUNT_MATCH=YES
EXPECTED_PAYTO_MATCH=YES
PROVIDER_EXECUTION_EVIDENCE_EXISTS=YES
PROVIDER_SUCCESS_EVIDENCE_EXISTS=YES
USEFUL_RESULT_EVIDENCE_EXISTS=YES
LINK_VERIFICATION_MISSING_ONLY=NO
OTHER_MISSING_FINALIZATION_EVIDENCE=BUYER_FACING_RECEIPT_SIGNATURE_KEY_ECONOMICS_SETTLEMENT_AND_PCC_CORRELATION_REMAIN_UNPROVEN
```

The stored `workflow_receipt` marker is not a durable PaymentServiceLink or a
cryptographic link-verification result. It also is not the signed receipt
object. The R3A record classified receipt signature, signing-key, economics,
settlement-transaction, and PCC-correlation validity as unproven after platform
output truncation. Link verification is therefore not the only missing proof,
and economic settlement alone does not authorize
`settled_external -> link_verified -> settled`.

## Payment identifier ownership

Every exact payment identifier remains in `payment_attempts` and is protected by
unique index `idx_payment_attempts_identifier`. Current duplicate handling can
join only an already-existing deterministic Workflow ID; the
`joinExistingPaidContinuation` path is deliberately `get()`-only and cannot
create a missing owner.

```text
PAYMENT_IDENTIFIER_OWNERSHIP_EXISTS=YES_FOR_ALL_17
DUPLICATE_PAYMENT_REUSE_CURRENTLY_BLOCKED=YES_FOR_ALL_17
SAME_PAYMENT_RETRY_CAN_CREATE_MISSING_WORKFLOW=NO
RECONCILIATION_MUST_PRESERVE_PAYMENT_IDENTIFIER_OWNERSHIP=YES
```

## Disposition and terminal-state matrix

| Rows  | Evidence-backed disposition                                                                 | Current truthful terminal stage | Replay recommended |
| ----- | ------------------------------------------------------------------------------------------- | ------------------------------- | ------------------ |
| 1-4   | E — verified with execution failure and unsettled                                           | `NONE`                          | NO                 |
| 5     | H — insufficient evidence after execution started; no settlement/result                     | `NONE`                          | NO                 |
| 6     | C — verified but not routed/executed and never settled                                      | `NONE`                          | NO                 |
| 7-8   | E — verified with durable-Workflow execution failure and unsettled                          | `NONE`                          | NO                 |
| 9     | B — economically settled and useful result present, but governed link verification unproven | `NONE`                          | NO                 |
| 10-17 | E — verified with durable-Workflow execution failure and unsettled                          | `NONE`                          | NO                 |

Class G also describes the governance treatment of these historical test
records, but each row is assigned exactly one primary class above; “test” does
not erase the more precise economic/execution disposition.

```text
ROWS_WITH_EXISTING_TRUTHFUL_TERMINAL_STATE=0
ROWS_WITH_NO_EXISTING_TRUTHFUL_TERMINAL_STATE=17
CURRENT_LIFECYCLE_MODEL_SUFFICIENT_FOR_RECONCILIATION=NO
```

## Existing reconciliation capability

The codebase has:

- `reconcileAmbiguousSettlement`, a bounded read-only chain receipt checker for
  `settlement_pending` records with a transaction reference;
- `runSettlementStep` defensive re-entry for an existing CDP `settled_external`
  record, but only while its original Workflow continues;
- `attemptNeverminedRecovery`, a Nevermined-specific route recovery that may
  advance link stages only after positive external settlement evidence; and
- a scheduled alert sweep that only reports old `settlement_pending` rows.

There is no operator-safe general procedure for stale `verified` or CDP
`settled_external` orphans, and no procedure that can manufacture missing link
evidence.

```text
EXISTING_RECONCILIATION_FUNCTION=reconcileAmbiguousSettlement_PLUS_Workflow_reentry_PLUS_Nevermined_specific_route_recovery
EXISTING_RECONCILIATION_SUPPORTS_VERIFIED_ORPHAN=NO
EXISTING_RECONCILIATION_SUPPORTS_SETTLED_EXTERNAL=PARTIAL_ONLY_INSIDE_AN_EXISTING_CDP_WORKFLOW;_NO_OPERATOR_SAFE_TERMINALIZATION
EXISTING_RECONCILIATION_IS_IDEMPOTENT=YES_FOR_ITS_SUPPORTED_SETTLEMENT_READ_AND_UPSERT_PATHS
EXISTING_RECONCILIATION_CAN_CREATE_ECONOMIC_EFFECT=NO_ON_READ_ONLY_RECONCILIATION;_THE_FULL_WORKFLOW_OWNS_ONE_SETTLEMENT_IF_NOT_ALREADY_SETTLED
EXISTING_RECONCILIATION_CAN_CREATE_PROVIDER_EFFECT=YES_IF_A_NEW_FULL_WORKFLOW_WERE_IMPROPERLY_REPLAYED;_NO_FOR_THE_READ_ONLY_RECONCILER_ITSELF
```

## Why the orphans exist and whether current production can recur

| Rows       | Root cause                                                                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-4        | Pre-Workflow payment lifecycle recorded verification but had no terminal payment state for downstream execution failure.                                                                                                                 |
| 5          | Pre-Workflow synchronous execution depended on the HTTP request; process/client termination left `verified`/`EXECUTING` without a recovery owner.                                                                                        |
| 6          | Creation lineage is not proven; the record stopped after lock and before routing with no Workflow owner. The earlier “zero payment attempt” conclusion was a bad join.                                                                   |
| 7-8, 10-17 | Durable Workflows completed downstream failure handling at the job layer but never terminalized the payment-attempt layer; the lifecycle has no truthful execution-failed-after-verification terminal.                                   |
| 9          | Real settlement occurred; a missing D1 migration crashed original post-settlement bookkeeping. Later recovery delivered result/receipt markers but did not create/verify a governed PaymentServiceLink or advance the payment lifecycle. |

Current production has two independent recurrence defects:

1. The public route transitions `payment_attempts` to `verified` before it
   creates the deterministic Workflow. There is a crash window between those
   operations. The duplicate path is `get()`-only, so if creation never happened
   no scheduled/outbox owner can create it later. Even the explicit
   `create_failed` branch rejects the job but leaves the payment attempt at
   `verified`.
2. The current CDP Workflow constructs and verifies a PaymentServiceLink in
   memory and persists result/receipt/job completion, but contains no
   `settled_external -> link_verified -> settled` lifecycle transition. Normal
   successful CDP execution therefore remains `settled_external`; an exhausted
   post-settlement persistence failure also has no independent scheduled
   finalization owner.

```text
CURRENT_VERIFIED_TO_WORKFLOW_ATOMICITY=NONATOMIC_D1_VERIFIED_WRITE_PRECEDES_EXTERNAL_WORKFLOW_CREATE
CRASH_WINDOW_EXISTS=YES
RECOVERY_OWNER_EXISTS_IF_CRASH_OCCURS=NO
CAN_CURRENT_PRODUCTION_CREATE_A_NEW_OWNERLESS_VERIFIED_ATTEMPT=YES
CAN_CURRENT_RUNTIME_LEAVE_SETTLED_EXTERNAL_PERMANENTLY_OWNERLESS=YES
WHAT_COMPONENT_OWNS_LINK_VERIFICATION=THE_ORIGINAL_PAID_CONTINUATION_WORKFLOW_IN_MEMORY_ONLY_FOR_CDP;_NO_INDEPENDENT_DURABLE_FINALIZER
WHAT_RETRY_POLICY_EXISTS=CLOUDFLARE_STEP_RETRIES_WITHIN_THE_ORIGINAL_WORKFLOW;_NO_SCHEDULED_OR_OPERATOR_SAFE_CDP_FINALIZER_AFTER_OWNER_LOSS
CAN_CURRENT_PRODUCTION_CREATE_A_NEW_OWNERLESS_SETTLED_EXTERNAL_ATTEMPT=YES
CURRENT_ORPHAN_RECURRENCE_DEFECT=YES
```

## Lifecycle-model options

Scores are 1 (worst) to 5 (best). Lower change-scope and rollback-complexity
scores mean less risk, so 5 is smallest/safest.

| Model                                                                                                 | Truth | Audit | Economic safety | Source scope | D1 scope | Public impact | Paid-runtime impact | Rollback | Operability | Future value | Assessment                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ----: | ----: | --------------: | -----------: | -------: | ------------: | ------------------: | -------: | ----------: | -----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — terminal `expired`/`abandoned`                                                                    |     3 |     3 |               4 |            3 |        3 |             3 |                   3 |        3 |           3 |            3 | One label cannot distinguish execution failure, owner loss, and an economically settled/link-incomplete row without proliferating stages. “Expired” can falsely imply verification did not happen. |
| B — terminal `reconciled_legacy`                                                                      |     4 |     4 |               5 |            3 |        3 |             3 |                   3 |        3 |           3 |            4 | Safer than A only if paired with structured reason/evidence; a single stage still collapses materially different truths.                                                                           |
| C — preserve lifecycle, add durable reconciliation/quarantine classification and ownership-aware gate |     5 |     5 |               5 |            3 |        3 |             3 |                   3 |        4 |           5 |            5 | Preserves every original stage and economic fact while allowing the drain gate to distinguish reviewed inert history from active-owned work. Supports nuanced classes and future reconciliation.   |
| D — archive out of active relation                                                                    |     4 |     5 |               4 |            2 |        1 |             2 |                   2 |        1 |           3 |            3 | Moving rows risks breaking identifier ownership/foreign relations and makes rollback difficult.                                                                                                    |
| E — replay/rehydrate                                                                                  |     1 |     2 |               1 |            2 |        2 |             2 |                   2 |        1 |           1 |            1 | Expired/unavailable authorizations, provider drift, blocked company feature, duplicate-side-effect risk, and lost caller context make replay illegitimate.                                         |

### Selected model

`MODEL C` is selected for the next separately authorized checkpoint. The
recommended design is an append-only reconciliation relation keyed by the
original `payment_attempts.id`, with a governed disposition enum, evidence-ID
set/digest, `active_owner` status, operator/checkpoint identity, and timestamp.
The original payment row, verified history, quote/requirement, payment
identifier ownership, settlement reference, and creation timestamp remain
unchanged. The drain gate may exclude only rows that have an approved inert
classification and no active owner; it must never infer inertness from age.

Model C must be shipped together with recurrence remediation:

- a durable owner-intent/outbox or equivalent recovery mechanism spanning the
  non-atomic verification-to-Workflow-create boundary;
- an operator/scheduled owner that can safely create or reconcile only from a
  durably sealed original continuation envelope, never reconstructed payment
  material;
- explicit terminal reconciliation for post-verification execution rejection,
  without renaming it verification failure; and
- CDP PaymentServiceLink persistence and
  `settled_external -> link_verified -> settled` transitions after positive link
  verification, with idempotent recovery after post-settlement crashes.

```text
SELECTED_LIFECYCLE_MODEL_REMEDIATION=MODEL_C_DURABLE_RECONCILIATION_CLASSIFICATION_AND_OWNERSHIP_AWARE_DRAIN_GATE
WHY_SELECTED=IT_PRESERVES_ORIGINAL_PAYMENT_AND_ECONOMIC_HISTORY_WHILE_EXPLICITLY_SEPARATING_REVIEWED_INERT_LEGACY_ROWS_FROM_ACTIVE_OWNED_WORK_AND_SUPPORTING_DISTINCT_EVIDENCE_CLASSES
SOURCE_CHANGES_REQUIRED=YES
D1_SCHEMA_CHANGES_REQUIRED=YES_ADD_APPEND_ONLY_RECONCILIATION_CLASSIFICATION_AND_OWNER_INTENT_OR_OUTBOX_SCHEMA
PUBLIC_WORKER_CHANGES_REQUIRED=YES_CLOSE_VERIFIED_TO_WORKFLOW_OWNER_GAP_AND_WRITE_DURABLE_OWNER_INTENT
PAID_RUNTIME_CHANGES_REQUIRED=YES_PERSIST_AND_TRANSITION_LINK_VERIFICATION_AND_SUPPORT_IDEMPOTENT_RECOVERY
CUTOVER_GATE_CHANGES_REQUIRED=YES_QUERY_ACTIVE_OWNED_OR_UNRECONCILED_WORK_RATHER_THAN_RAW_STAGE_ALONE
```

## Conditional mutation gate

All 17 would need a definitive existing terminal target, a legal current
transition, preserved identifier ownership, and no model gap. The first, second,
third, and eleventh requirements fail. The checkpoint's all-or-nothing rule
therefore forbids even the tempting single-row `settled_external` advance.

```text
ALL_OR_NOTHING_RECONCILIATION_PLAN=YES
PRODUCTION_LIFECYCLE_MUTATION_AUTHORIZED_BY_THIS_CHECKPOINT=NO
PAYMENT_ATTEMPTS_UPDATED=0
PAYMENT_ATTEMPTS_DELETED=0
RECONCILIATION_EVENTS_CREATED=0
ORIGINAL_ROWS_PRESERVED=YES
PAYMENT_IDENTIFIER_OWNERSHIP_PRESERVED=YES
SETTLEMENT_REFERENCES_PRESERVED=YES
INFLIGHT_PAID_JOBS_TOTAL_POST=17
```

## Settlement ownership and accounting

Fresh source inspection found the one real settlement call only inside the
dedicated paid-continuation Workflow. The public route and MCP adapter do not
own settlement.

The focused lifecycle/ownership regression set was rerun from this exact source:
`d1-payment-attempts.test.ts`, `continuation-handoff.test.ts`, and
`paid-continuation-workflow.test.ts` all passed (3 files, 87 tests). The two
`settlement_ambiguous_unresolved` stderr records are expected assertions from
the ambiguity tests, not live calls or test failures. Wrangler readback used the
pinned project version `4.119.0`.

```text
FOCUSED_LIFECYCLE_TESTS=PASS_3_FILES_87_TESTS
PINNED_WRANGLER_VERSION=4.119.0
PUBLIC_API_SETTLE_CALLSITES=0
MCP_ADAPTER_SETTLE_CALLSITES=0
DEDICATED_WORKFLOW_SETTLE_CALLSITES=1
TOTAL_PRODUCTION_SETTLE_CALLSITES=1

QUIESCENCE_PROMOTION_EXECUTED=NO
PAID_RUNTIME_DEPLOYMENTS=0
PUBLIC_DEPLOYMENT_MUTATIONS=0
TRAFFIC_PERCENTAGE_MUTATIONS=0
VERSION_UPLOADS=0
VAR_MUTATIONS=0
SECRET_MUTATIONS=0
ROUTE_MUTATIONS=0
DNS_MUTATIONS=0
PREVIEW_URL_MUTATIONS=0
PAYMENT_ATTEMPT_MUTATIONS=0

REAL_TEST_PAYMENTS=0
PAYMENT_AUTHORIZATIONS_SUBMITTED=0
FACILITATOR_VERIFY_CALLS=0
FACILITATOR_SETTLE_CALLS=0
USEFUL_PROVIDER_EXECUTIONS=0
WORKFLOW_CREATIONS=0
NEW_SETTLEMENTS=0
CHAIN_TRANSACTIONS=0
ECONOMIC_EFFECT_USDC=0
```

The one public RPC lookup verified an existing historical settlement and is not
a new settlement or economic mutation.

## Final checkpoint result

```text
SUN1222C_PCC_LIFECYCLE_BACKLOG_RECONCILIATION=LIFECYCLE_MODEL_GAP
CURRENT_NONTERMINAL_TOTAL_PRE=17
CURRENT_NONTERMINAL_TOTAL_POST=17
VERIFIED_ROWS_COUNT=16
ROWS_WITH_EXISTING_TRUTHFUL_TERMINAL_STATE=0
ROWS_WITH_NO_EXISTING_TRUTHFUL_TERMINAL_STATE=17
CURRENT_LIFECYCLE_MODEL_SUFFICIENT_FOR_RECONCILIATION=NO
CURRENT_ORPHAN_RECURRENCE_DEFECT=YES
NEXT_REQUIRED_CHECKPOINT=SUN-1222C-PCC-LIFECYCLE-MODEL-GAP-REMEDIATION
```
