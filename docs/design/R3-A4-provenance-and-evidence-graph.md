# R3-A4 — Deployment Provenance and the Constitutional Evidence Graph

Mission: R3-A4-PROVENANCE-CONSTITUTIONAL-EVIDENCE-GRAPH-54 (2026-09-28).
Baseline: A3 `CLOSED_WITH_NONBLOCKING_DEBT`; not reopened.

Implementation: `packages/evidence-graph` (not wired into any runtime or
authority path) and `scripts/release/capture-deployment-provenance.mts`
(read-only capture). No production mutation, migration, or deploy.

## 1. Current provenance inventory (Phase 1)

| Artifact                                                     | Source of truth            | Authoritative                | Crypto-bound          | Operator-asserted | Runtime-observable | Mutable                   |
| ------------------------------------------------------------ | -------------------------- | ---------------------------- | --------------------- | ----------------- | ------------------ | ------------------------- |
| Git commit SHA                                               | git object store / GitHub  | YES (for source)             | YES                   | NO                | NO                 | NO                        |
| Branch / tag names                                           | git refs                   | NO                           | NO                    | YES               | NO                 | YES                       |
| `verify-source-reachable.mjs`                                | git ancestry               | PARTIAL                      | YES (ancestry)        | NO                | NO                 | NO                        |
| `generate-build-manifest.mjs` output                         | local build                | PARTIAL (never wired/stored) | YES (bundle sha)      | NO                | NO                 | n/a (ephemeral)           |
| Cloudflare version ID                                        | Cloudflare                 | YES                          | NO                    | NO                | NO                 | NO                        |
| Version module bytes (`GET …/versions/{id}?include=modules`) | Cloudflare                 | YES                          | NO (platform custody) | NO                | NO                 | NO                        |
| `workers/message`, `workers/tag` annotations                 | operator via wrangler      | NO                           | NO                    | YES               | NO                 | NO (per version)          |
| Deployment ID + traffic split                                | Cloudflare deployments API | YES                          | NO                    | NO                | NO                 | new deployments supersede |
| Deployment `workers/message`                                 | operator                   | NO                           | NO                    | YES               | NO                 | NO                        |
| Release reports (`docs/reports/*`)                           | repo                       | NO                           | NO                    | YES               | NO                 | YES                       |
| PCC                                                          | signed per-job receipt     | YES (per job output)         | YES (signed)          | NO                | YES                | NO                        |
| Contract releases (`contracts/releases/*/SHA256SUMS`)        | repo                       | YES (contract bytes)         | YES                   | NO                | NO                 | NO                        |
| VCM digests / `EvidenceRef` (`packages/vcm`)                 | repo (shadow)              | PARTIAL (metadata only)      | YES                   | NO                | NO                 | NO                        |
| Provider-adapter `ProvenanceRoute`                           | per-fetch                  | PARTIAL (source data only)   | YES (content hash)    | NO                | YES                | NO                        |
| D1 `d1_migrations`                                           | D1                         | YES (schema state)           | NO                    | NO                | YES                | append                    |
| Audit events (`control-plane/audit`)                         | D1/logs                    | PARTIAL                      | NO                    | NO                | YES                | append                    |
| Runtime version self-report (`CF_VERSION_METADATA`)          | —                          | **absent**                   | —                     | —                 | —                  | —                         |
| MCP / A2A metadata versions                                  | served metadata            | NO (for deployment)          | NO                    | YES               | YES                | YES                       |
| Evidence tables                                              | —                          | **absent**                   | —                     | —                 | —                  | —                         |

## 2. Provenance gap (Phase 2)

Before this mission nothing linked the links: the build manifest script existed
but was never run into a stored record, and "what commit is running" was
answered by the operator-entered `workers/message`.

With the new capture path, measured 2026-09-28T16:07:09Z (read-only):

| Link                 | Result | Classification                           | How                                                                                               |
| -------------------- | ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| SOURCE → ARTIFACT    | PROVEN | CRYPTOGRAPHIC (method REPRODUCED)        | clean checkout of the commit, `wrangler deploy --dry-run`, sha256 equality                        |
| ARTIFACT → VERSION   | PROVEN | PLATFORM_ATTESTED                        | sha256 of module bytes _returned by Cloudflare_ for the version id equals the reproduced artifact |
| VERSION → DEPLOYMENT | PROVEN | PLATFORM_ATTESTED                        | deployments API: latest deployment routes 100% to the version                                     |
| DEPLOYMENT → RUNTIME | PROVEN | PLATFORM_ATTESTED (not OBSERVED_RUNTIME) | platform reports the deployment active; no runtime self-report exists for these versions          |

Operator annotations were not used for any link. A release message naming the
right commit cannot substitute for a digest match (tested).

## 3. Canonical provenance records (Phase 3)

Exact TypeScript schemas: `packages/evidence-graph/src/records.ts`. Common base
on every record:

```
record_type, record_id ("ev:" + sha256(JCS(record \ record_id))), schema_version=1,
environment, deployment_unit, captured_at, actor, evidence_source,
proof {binding, methods[]}, parent_ids[]
```

| Record                   | Specific fields                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SourceRecord             | source_repository, source_commit, source_ref, reachable_from_protected_ref                                                                                                      |
| BuildRecord              | source_commit, source_dirty, toolchain{node, wrangler, package_manager, lockfile_sha256}, build_command, config_path, main_module, artifact_sha256, module_set_digest           |
| ArtifactRecord           | main_module, artifact_sha256, module_set_digest, modules[{name, sha256, size}]                                                                                                  |
| PlatformVersionRecord    | platform, platform_version_id, platform_version_number, platform_created_on, main_module, platform_modules[], platform_module_set_digest, operator_annotations                  |
| DeploymentRecord         | platform, platform_deployment_id, platform_created_on, strategy, traffic[{version_id, percentage}], operator_annotations                                                        |
| RuntimeObservationRecord | observation_kind (PLATFORM_ACTIVE_DEPLOYMENT \| RUNTIME_SELF_REPORT \| CONTROLLED_PROBE), observed_at, observed_deployment_id, observed_version_id, observed_traffic_percentage |

`module_set_digest` = sha256(JCS(sorted [{name, sha256}] of executable
modules)); `.map` and README are excluded because the platform does not return
them.

## 4. Evidence Graph constitution (Phase 4)

Node types: Contract, Source, Build, Artifact, Version, Deployment,
RuntimeObservation, Execution, Provider, ProviderAttempt, Assurance, PCC,
ResultAuthorization, Settlement, EconomicOutcome, Failure, Reconciliation,
PolicyDecision.

Every edge: `AUTHORITATIVE=NO`, `CAN_GRANT_EXECUTION_AUTHORITY=NO`,
`CAN_GRANT_RESULT_AUTHORITY=NO`, `CAN_GRANT_SETTLEMENT_AUTHORITY=NO`. The graph
is a projection; canonical records stay in D1 control-plane tables and
Cloudflare.

| Edge                 | From → To                                                                | Semantics                                            |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| BUILT_FROM           | Build → Source                                                           | build ran on exactly this commit                     |
| PRODUCED             | Build → Artifact                                                         | build output hashes to this artifact                 |
| UPLOADED_AS          | Artifact → Version                                                       | platform-returned module bytes hash to this artifact |
| DEPLOYED_AS          | Version → Deployment                                                     | deployment routes traffic to this version            |
| OBSERVED_RUNNING     | RuntimeObservation → Deployment                                          | deployment observed active at observed_at            |
| EXECUTED_UNDER       | Execution → Deployment                                                   | execution ran on this deployment's code              |
| SATISFIES_CONTRACT   | Execution, Assurance → Contract                                          | claims conformance                                   |
| ATTEMPT_OF           | ProviderAttempt → Execution                                              | attempt made for this execution                      |
| PROVIDED_BY          | ProviderAttempt → Provider                                               | served by provider                                   |
| EVIDENCED_BY         | Execution, ProviderAttempt, Settlement → PCC, Assurance                  | supported by evidence                                |
| AUTHORIZED_BY        | Execution → PolicyDecision                                               | mirrors an existing decision; never grants           |
| RESULT_AUTHORIZED_BY | Execution → ResultAuthorization                                          | mirrors canonical row; never grants                  |
| SETTLED_BY           | Execution → Settlement                                                   | mirrors canonical outcome; never grants              |
| RECONCILES           | Reconciliation → Execution, Settlement, Failure                          | classified/resolved                                  |
| SUPERSEDES           | X → X (same type)                                                        | newer evidence replaces older; old kept              |
| FAILED_WITH          | Execution, ProviderAttempt, Settlement, Deployment → Failure             | failure class                                        |
| DERIVED_FROM         | PCC, EconomicOutcome, Assurance → ProviderAttempt, Execution, Settlement | computed from                                        |

## 5. Proof model (Phase 5)

Two dimensions, not one total order:

- **binding** (ordered): CRYPTOGRAPHICALLY_BOUND > PLATFORM_ATTESTED >
  OPERATOR_ATTESTED > INFERRED > UNVERIFIED > UNKNOWN. A chain is as strong as
  its weakest link.
- **method** (unordered set): OBSERVED_RUNTIME, CONTROLLED_TEST, REPRODUCED,
  PLATFORM_API_READ, ASSERTED.

Current examples: source→artifact for 19477db/d939f3b = CRYPTOGRAPHICALLY_BOUND
/ REPRODUCED; module bytes for 5705e934/639db8bc = PLATFORM_ATTESTED /
PLATFORM_API_READ; 52D Workflow activation = PLATFORM_ATTESTED /
{CONTROLLED_TEST, OBSERVED_RUNTIME} (for 5a23a367, not the canonical version);
`workers/message` = OPERATOR_ATTESTED.

## 6. Authority firewall (Phase 6)

`packages/evidence-graph/src/firewall.ts`, enforced by tests:

- F1 every edge rule is authority-neutral (mutation-tested per flag per edge);
- F2 nodes carry `authority: 'NONE'`; anything else is rejected;
- F3 grant- or secret-shaped payload fields (permit, grant, token, secret,
  password, api_key, private_key, bearer, credential) are rejected;
- F4 the 12 canonical authority modules (provider dispatch, payment attempts,
  owner intents, result authorization, handoff, owner recovery, settlement
  reconciliation, production payment config, x402 route, artifact reclaim, both
  Worker entrypoints) do not import the graph (mutation-tested by injecting four
  import forms into each);
- F5 the graph imports no control-plane, payment, protocol, or runtime code;
- the public API exports nothing named dispatch/settle/release/grant/authorize/…

Evidence may inform AVUF qualification, routing, risk scoring, provider ranking,
assurance requirements, manual review, and policy inputs. Final authority stays
with the control plane.

## 7. Production chains (Phase 8)

Fixture: `packages/evidence-graph/fixtures/production-2026-09-28.json` (12
sealed records, re-derivable deterministically by the capture script).

| Unit                                | Source    | Artifact sha256 | Version          | Deployment      | Status                     |
| ----------------------------------- | --------- | --------------- | ---------------- | --------------- | -------------------------- |
| siteborne-utility-edge              | 19477db8… | a7159424…e81f   | 5705e934… (#113) | 23507e3d… @100% | COMPLETE_PLATFORM_ATTESTED |
| siteborne-paid-continuation-runtime | d939f3b2… | 6562d5f9…949d   | 639db8bc… (#21)  | 9b08ccc2… @100% | COMPLETE_PLATFORM_ATTESTED |

The toolchain in each BuildRecord is the _reproduction_ toolchain (node
v26.10.0, wrangler 4.119.0). The release-time toolchain was not recorded; the
byte-identical output shows it was equivalent for these bundles.

## 8. Storage (Phase 9) — materialized as migration 0015 by R3-A4-55

`migrations/0015_evidence_graph.sql` (not applied to production). Two
append-only, content-addressed tables, `evidence_nodes` and `evidence_edges`.
Projected columns are CHECKed against the canonical body (`json_extract`),
`authority` is pinned to `'NONE'`, UPDATE/DELETE raise, a different body under
an existing id raises (`evidence_*_conflict` triggers), and edges must reference
existing nodes (trigger plus foreign key). Identical re-inserts are no-ops via
`INSERT ... ON CONFLICT(id) DO NOTHING`. Writer/reader: `d1-store.ts`. See
`docs/reports/R3-A4-55-provenance-evidence-production-qualification.md`.

## 9. Query contract (Phase 10)

`EvidenceGraphReader` (`graph.ts`): `runningProvenance(unit, env)`,
`deployedArtifactSha256(unit, env)`,
`deploymentsExecutingContract(contractKey)`, `providerAttemptForPcc(pccKey)`,
`resultAuthorizationsFor(executionKey)`, `settlementsFollowing(executionKey)`,
`failuresFor(providerKey, contractClass)`,
`qualificationEvidence(providerKey, contractClass)`. All return frozen, advisory
nodes. The in-memory implementation is tested; a D1-backed one waits on the
schema above.

## 10. AVUF / RAVI-P readiness (Phase 11)

`RAVI_P_REQUIRED_EVIDENCE_FIELDS` (`ravi-p.ts`): provider_id, contract_key,
contract_class, environment, platform_version_id, latency_ms, quality_outcome,
failure_class, policy_fit, assurance_result, pcc_available,
economic_cost_atomic, normalized_cogs, cash_cogs, credit_benefit,
settlement_outcome, reconciliation_outcome, provenance_chain_status. No scoring
is implemented.

## 11. Remaining gaps (Phase 14)

- **A. Historical releases.** No release before 2026-09-28 had a stored, linked
  build record. Some release reports recorded bundle digests, but only as
  operator text. The edge and host are proven only because their source commits
  still rebuild byte-identically _today_. Versions whose source or toolchain can
  no longer be reproduced stay OPERATOR_ATTESTED (message/tag). History is not
  rewritten.
- **B. Future releases.** These can be bound at release time: run the capture
  script before `versions upload`/`versions deploy`, and store the sealed
  records. Recommended hardening: add a `version_metadata` binding so the
  runtime can self-report its version id, which would upgrade DEPLOYMENT→RUNTIME
  to OBSERVED_RUNTIME.
- **C. Platform vs operator attribution.** Version bytes, deployments, and
  traffic are platform-attributed. Tags, messages, and release reports are
  operator-attributed and never raise a link above OPERATOR_ATTESTED.
- **D. Runtime observation vs source assertion.** DEPLOYMENT→RUNTIME is
  currently platform-reported (active deployment), not observed from inside the
  running code. The 52D controlled probe observed runtime for the diagnostic
  version only.
- Toolchain at release time not captured (reproduction toolchain recorded
  instead).
- Graph not wired into any live path; no production evidence writes.
